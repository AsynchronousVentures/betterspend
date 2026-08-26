import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import ipaddr from 'ipaddr.js';
import { and, eq, sql, inArray } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db } from '@betterspend/db';
import {
  auditLog,
  sanctionsEntries,
  sanctionsRegistryState,
  sanctionsScreenings,
  vendors,
} from '@betterspend/db';
import { sanctionsImportRowSchema } from '@betterspend/shared';
import { SettingsService } from '../settings/settings.service';
import type { AccessPolicy } from '../auth/access-policy';
import { operationalScope } from '../auth/operational-access';

export interface SanctionMatch {
  entryId: string;
  source: string;
  entityName: string;
  country: string | null;
  matchedOn: string;
  score: number;
}

type RiskScreeningTransaction = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Match threshold: token-overlap (jaccard) or levenshtein similarity must exceed this. */
const MATCH_THRESHOLD = 0.82;
const MAX_LEVENSHTEIN_CELLS_PER_SCREENING = 10_000_000;

@Injectable()
export class RiskScreeningService {
  private readonly logger = new Logger(RiskScreeningService.name);

  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * Download a public sanctions list and replace the local copy for that
   * source. URLs are server-controlled (per-source allowlist, optional
   * operator env override), never caller-supplied, so ingest cannot be turned
   * into an SSRF primitive or a tenant-controlled data swap.
   */
  private static readonly INGEST_SOURCES: Record<string, string> = {
    ofac_sdn: 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV',
  };
  private static readonly INGEST_TIMEOUT_MS = 30_000;
  private static readonly MAX_INGEST_BYTES = 25 * 1024 * 1024;
  private static readonly MAX_INGEST_ENTRIES = 100_000;
  private static readonly MIN_INGEST_ENTRIES = 100;

  async ingest(
    organizationId: string,
    userId: string,
    source = 'ofac_sdn',
    access?: AccessPolicy,
  ): Promise<{ count: number; source: string }> {
    if (
      access &&
      operationalScope(access, 'supplier_risk', 'supplier_risk:manage')?.unrestricted !== true
    ) {
      throw new ForbiddenException('Sanctions registry ingestion requires a global grant');
    }
    const listUrl =
      process.env['SANCTIONS_LIST_URL'] ?? RiskScreeningService.INGEST_SOURCES[source] ?? '';
    if (!listUrl) {
      throw new BadRequestException(`Unsupported sanctions source "${source}"`);
    }

    let csv: string;
    try {
      csv = await downloadSanctionsSource(
        listUrl,
        RiskScreeningService.INGEST_TIMEOUT_MS,
        RiskScreeningService.MAX_INGEST_BYTES,
      );
    } catch (error) {
      throw new Error(
        `Failed to download sanctions list from ${listUrl}: ${error instanceof Error ? error.message : error}`,
      );
    }
    const { entries: rows, skipped } = parseSdnCsv(csv);
    if (
      rows.length < RiskScreeningService.MIN_INGEST_ENTRIES ||
      rows.length > RiskScreeningService.MAX_INGEST_ENTRIES ||
      skipped > 0
    ) {
      throw new Error(
        `Sanctions list validation failed (${rows.length} valid, ${skipped} malformed); refusing to replace data`,
      );
    }

    await this.db.transaction(async (tx) => {
      await tx
        .insert(sanctionsRegistryState)
        .values({ source, version: 1 })
        .onConflictDoUpdate({
          target: sanctionsRegistryState.source,
          set: {
            version: sql`${sanctionsRegistryState.version} + 1`,
            updatedAt: new Date(),
          },
        });
      await tx.delete(sanctionsEntries).where(eq(sanctionsEntries.source, source));
      for (let i = 0; i < rows.length; i += 500) {
        await tx.insert(sanctionsEntries).values(
          rows.slice(i, i + 500).map((row) => ({
            source,
            externalId: row.externalId,
            entityName: row.entityName,
            aliases: [],
            country: null,
            entryType: row.entryType,
            raw: row.raw,
          })),
        );
      }
      await tx.insert(auditLog).values({
        organizationId,
        userId,
        entityType: 'sanctions_registry',
        entityId: organizationId,
        action: 'ingest',
        changes: { source, url: listUrl, count: rows.length },
      });
    });
    this.logger.log(`Ingested ${rows.length} ${source} entries from ${listUrl}`);
    return { count: rows.length, source };
  }

  /** Fuzzy-match one vendor against local sanctions entries and persist the outcome. */
  async screenVendor(
    organizationId: string,
    vendorId: string,
    screenedBy?: string,
    access?: AccessPolicy,
  ) {
    await this.assertVendorScope(organizationId, vendorId, access, 'supplier_risk:manage');
    return this.screenVendorWithEntries(organizationId, vendorId, screenedBy);
  }

  async screenAllVendors(organizationId: string, screenedBy?: string, access?: AccessPolicy) {
    const scopedVendorIds = await this.scopedVendorIds(
      organizationId,
      access,
      'supplier_risk:manage',
    );
    return this.db.transaction(async (tx) => {
      // Hold a shared registry-version lock for the whole batch. Ingestion's
      // version update waits until every result from this snapshot commits.
      const entries = await this.lockAndLoadEntries(tx);
      const matchBudget = createMatchWorkBudget();
      const orgVendors = await tx
        .select({ id: vendors.id })
        .from(vendors)
        .where(
          and(
            eq(vendors.organizationId, organizationId),
            eq(vendors.status, 'active'),
            scopedVendorIds
              ? scopedVendorIds.length > 0
                ? inArray(vendors.id, scopedVendorIds)
                : sql`false`
              : undefined,
          ),
        );
      let flagged = 0;
      for (const vendor of orgVendors) {
        const result = await this.screenVendorInTransaction(
          tx,
          organizationId,
          vendor.id,
          screenedBy,
          entries,
          matchBudget,
        );
        if (result.status === 'flagged') flagged += 1;
      }
      return { screened: orgVendors.length, flagged };
    });
  }

  private async screenVendorWithEntries(
    organizationId: string,
    vendorId: string,
    screenedBy?: string,
  ) {
    return this.db.transaction(async (tx) => {
      const entries = await this.lockAndLoadEntries(tx);
      return this.screenVendorInTransaction(
        tx,
        organizationId,
        vendorId,
        screenedBy,
        entries,
        createMatchWorkBudget(),
      );
    });
  }

  private async lockAndLoadEntries(tx: RiskScreeningTransaction): Promise<SanctionEntryRow[]> {
    const registry = await tx.select().from(sanctionsRegistryState).for('share');
    if (registry.length === 0) {
      throw new BadRequestException('Sanctions registry has not been ingested');
    }
    return tx
      .select({
        id: sanctionsEntries.id,
        source: sanctionsEntries.source,
        entityName: sanctionsEntries.entityName,
        country: sanctionsEntries.country,
      })
      .from(sanctionsEntries);
  }

  private async screenVendorInTransaction(
    tx: RiskScreeningTransaction,
    organizationId: string,
    vendorId: string,
    screenedBy: string | undefined,
    entries: SanctionEntryRow[],
    matchBudget: MatchWorkBudget,
  ) {
    const [vendor] = await tx
      .select()
      .from(vendors)
      .where(and(eq(vendors.id, vendorId), eq(vendors.organizationId, organizationId)))
      .for('update');
    if (!vendor) throw new NotFoundException(`Vendor ${vendorId} not found`);

    const vendorMatches = await this.matchVendorName(vendor.name, entries, matchBudget);
    const nextStatus =
      vendorMatches.length > 0
        ? 'flagged'
        : vendor.sanctionsStatus === 'manually_reviewed'
          ? 'manually_reviewed'
          : 'clear';

    await tx.insert(sanctionsScreenings).values({
      organizationId,
      vendorId,
      result: nextStatus,
      matchCount: vendorMatches,
      screenedBy: screenedBy ?? null,
    });
    await tx
      .update(vendors)
      .set({
        sanctionsStatus: nextStatus,
        sanctionsCheckedAt: new Date(),
        sanctionsNote: nextStatus === 'manually_reviewed' ? (vendor.sanctionsNote ?? null) : null,
        updatedAt: new Date(),
      })
      .where(eq(vendors.id, vendorId));
    await tx.insert(auditLog).values({
      organizationId,
      userId: screenedBy ?? null,
      entityType: 'vendor',
      entityId: vendorId,
      action: 'sanctions_screening',
      changes: { result: nextStatus, matchCount: vendorMatches.length },
    });
    return { vendorId, status: nextStatus, matches: vendorMatches };
  }

  /** Admin override after human review of a flagged (or clear) vendor. */
  async manualReview(
    organizationId: string,
    vendorId: string,
    userId: string,
    note: string,
    access?: AccessPolicy,
  ) {
    await this.assertVendorScope(organizationId, vendorId, access, 'supplier_risk:manage');
    const trimmedNote = note.trim();
    if (!trimmedNote) {
      throw new BadRequestException('A justification note is required for manual review');
    }
    await this.db.transaction(async (tx) => {
      const [vendor] = await tx
        .select()
        .from(vendors)
        .where(and(eq(vendors.id, vendorId), eq(vendors.organizationId, organizationId)))
        .for('update');
      if (!vendor) throw new NotFoundException(`Vendor ${vendorId} not found`);
      if (vendor.sanctionsStatus === 'untested') {
        throw new BadRequestException('Screen this vendor before recording a manual review');
      }

      await tx
        .update(vendors)
        .set({
          sanctionsStatus: 'manually_reviewed',
          sanctionsNote: trimmedNote,
          sanctionsCheckedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(vendors.id, vendorId), eq(vendors.organizationId, organizationId)));
      await tx.insert(auditLog).values({
        organizationId,
        userId,
        entityType: 'vendor',
        entityId: vendorId,
        action: 'sanctions_manual_review',
        changes: { note: trimmedNote, previousStatus: vendor.sanctionsStatus },
      });
    });

    return this.db.query.vendors.findFirst({
      where: (v, { and, eq }) => and(eq(v.id, vendorId), eq(v.organizationId, organizationId)),
    });
  }

  async listStatus(organizationId: string, access?: AccessPolicy) {
    const scopedVendorIds = await this.scopedVendorIds(
      organizationId,
      access,
      'supplier_risk:view',
    );
    return this.db.query.vendors.findMany({
      where: (v, { and, eq }) =>
        and(
          eq(v.organizationId, organizationId),
          scopedVendorIds
            ? scopedVendorIds.length > 0
              ? inArray(v.id, scopedVendorIds)
              : sql`false`
            : undefined,
        ),
      columns: {
        id: true,
        name: true,
        status: true,
        onboardingStatus: true,
        sanctionsStatus: true,
        sanctionsCheckedAt: true,
        sanctionsNote: true,
        contactInfo: true,
      },
      orderBy: (v, { asc }) => asc(v.name),
    });
  }

  /**
   * PO gate. Re-reads the vendor's current screening status at decision time
   * rather than trusting the caller's snapshot. Throws when the org blocks
   * POs for flagged vendors; returns a warning string when flagged but only
   * warning-level enforcement is set.
   */
  async checkVendorForPo(
    organizationId: string,
    vendor: { id: string; name: string; sanctionsStatus?: string | null },
  ): Promise<string | null> {
    const [current] = await this.db
      .select({ sanctionsStatus: vendors.sanctionsStatus })
      .from(vendors)
      .where(and(eq(vendors.id, vendor.id), eq(vendors.organizationId, organizationId)));
    return this.checkVendorStatusForPo(organizationId, {
      name: vendor.name,
      sanctionsStatus: current?.sanctionsStatus,
    });
  }

  async checkVendorStatusForPo(
    organizationId: string,
    vendor: { name: string; sanctionsStatus?: string | null },
  ): Promise<string | null> {
    if ((vendor.sanctionsStatus ?? 'untested') !== 'flagged') return null;
    const blocking =
      (await this.settingsService.get(organizationId, 'block_pos_for_flagged_vendors')) === 'true';
    if (blocking) {
      throw new BadRequestException(
        `Vendor "${vendor.name}" is flagged by sanctions screening and cannot receive purchase orders`,
      );
    }
    return `Vendor "${vendor.name}" is flagged by sanctions screening; review before issuing this PO`;
  }

  private async scopedVendorIds(
    organizationId: string,
    access: AccessPolicy | undefined,
    permission: string,
  ): Promise<string[] | undefined> {
    const scope = operationalScope(access, 'supplier_risk', permission);
    if (!scope || scope.unrestricted) return undefined;
    if (scope.entityIds.length === 0) return [];

    const rows = await this.db
      .select({ id: vendors.id })
      .from(vendors)
      .where(
        and(eq(vendors.organizationId, organizationId), inArray(vendors.entityId, scope.entityIds)),
      );
    return rows.map((row) => row.id);
  }

  private async assertVendorScope(
    organizationId: string,
    vendorId: string,
    access: AccessPolicy | undefined,
    permission: string,
  ) {
    const scopedVendorIds = await this.scopedVendorIds(organizationId, access, permission);
    if (scopedVendorIds && !scopedVendorIds.includes(vendorId)) {
      throw new ForbiddenException('The vendor is outside your assigned risk scope');
    }
  }

  private async matchVendorName(
    name: string,
    entries: SanctionEntryRow[],
    matchBudget: MatchWorkBudget,
  ): Promise<SanctionMatch[]> {
    const normalizedTarget = normalize(name);
    if (!normalizedTarget) return [];

    const matches: SanctionMatch[] = [];

    for (const entry of entries) {
      const score = similarity(normalizedTarget, normalize(entry.entityName), matchBudget);
      if (score >= MATCH_THRESHOLD) {
        matches.push({
          entryId: entry.id,
          source: entry.source,
          entityName: entry.entityName,
          country: entry.country,
          matchedOn: entry.entityName,
          score: Number(score.toFixed(3)),
        });
      }
    }

    return matches.sort((a, b) => b.score - a.score).slice(0, 25);
  }
}

interface SanctionEntryRow {
  id: string;
  source: string;
  entityName: string;
  country: string | null;
}

interface MatchWorkBudget {
  remainingCells: number;
}

function createMatchWorkBudget(): MatchWorkBudget {
  return { remainingCells: MAX_LEVENSHTEIN_CELLS_PER_SCREENING };
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarity(a: string, b: string, workBudget: MatchWorkBudget): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const tokensA = new Set(a.split(' '));
  const tokensB = new Set(b.split(' '));
  const intersection = [...tokensA].filter((token) => tokensB.has(token)).length;
  const union = new Set([...tokensA, ...tokensB]).size;
  const jaccard = union > 0 ? intersection / union : 0;
  if (jaccard >= MATCH_THRESHOLD) return jaccard;

  const maxLength = Math.max(a.length, b.length);
  const minLength = Math.min(a.length, b.length);
  if (minLength / maxLength < MATCH_THRESHOLD) return jaccard;

  const requiredCells = a.length * b.length;
  if (requiredCells > workBudget.remainingCells) {
    throw new BadRequestException(
      'Sanctions registry exceeds the safe fuzzy-matching work limit; narrow or partition the registry',
    );
  }
  workBudget.remainingCells -= requiredCells;
  const levenshtein = 1 - levenshteinDistance(a, b) / Math.max(a.length, b.length);
  return Math.max(jaccard, levenshtein);
}

function levenshteinDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = temp;
    }
  }
  return previous[b.length];
}

const TRUSTED_SANCTIONS_REDIRECT_HOSTS = new Set([
  'sanctionslistservice.ofac.treas.gov',
  'wc2h-sls-prod-public-published.s3.us-gov-west-1.amazonaws.com',
]);
// ipaddr.js supplies the canonical special-use classifier. Keep only registry
// entries newer than its table here (IANA IPv6 registry, updated 2025-10-09).
const NON_GLOBAL_IP_RANGE_OVERRIDES = [ipaddr.parseCIDR('100:0:0:1::/64')];

async function downloadSanctionsSource(
  sourceUrl: string,
  timeoutMs: number,
  maxBytes: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let currentUrl = new URL(sourceUrl);
  for (let redirectCount = 0; redirectCount <= 2; redirectCount++) {
    assertSafeHttpsUrl(currentUrl);
    const addresses = await lookup(currentUrl.hostname, { all: true, verbatim: true });
    if (addresses.length === 0 || addresses.some(({ address }) => !isGlobalIp(address))) {
      throw new Error(`Sanctions source ${currentUrl.hostname} resolved to a non-global address`);
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error('Sanctions source download timed out');
    const pinnedAddress = addresses.find(({ family }) => family === 4) ?? addresses[0];
    const response = await requestPinned(
      currentUrl,
      pinnedAddress as { address: string; family: 4 | 6 },
      remainingMs,
      maxBytes,
    );
    if (response.statusCode >= 200 && response.statusCode < 300) return response.body;
    if (response.statusCode < 300 || response.statusCode >= 400) {
      throw new Error(`Sanctions list download failed with HTTP ${response.statusCode}`);
    }

    const location = response.location;
    if (!location) throw new Error('Sanctions source returned a redirect without a location');
    const nextUrl = new URL(location, currentUrl);
    if (
      nextUrl.protocol !== 'https:' ||
      !TRUSTED_SANCTIONS_REDIRECT_HOSTS.has(nextUrl.hostname.toLowerCase())
    ) {
      throw new Error(`Sanctions source redirected to untrusted host ${nextUrl.hostname}`);
    }
    currentUrl = nextUrl;
  }
  throw new Error('Sanctions source exceeded the redirect limit');
}

function assertSafeHttpsUrl(url: URL): void {
  if (url.protocol !== 'https:' || (url.port !== '' && url.port !== '443')) {
    throw new Error('Sanctions sources must use HTTPS on port 443');
  }
  if (url.username || url.password) {
    throw new Error('Sanctions source URLs cannot contain credentials');
  }
}

function isGlobalIp(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.parse(address);
  return (
    parsed.range() === 'unicast' &&
    !NON_GLOBAL_IP_RANGE_OVERRIDES.some(
      (range) => range[0].kind() === parsed.kind() && parsed.match(range),
    )
  );
}

function requestPinned(
  url: URL,
  pinned: { address: string; family: 4 | 6 },
  timeoutMs: number,
  maxBytes: number,
): Promise<{ statusCode: number; location?: string; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        servername: url.hostname,
        lookup: (_hostname, _options, callback) => {
          callback(null, pinned.address, pinned.family);
        },
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const location = response.headers.location;
        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          resolve({ statusCode, location, body: '' });
          return;
        }
        const contentLength = Number(response.headers['content-length']);
        if (Number.isFinite(contentLength) && contentLength > maxBytes) {
          response.destroy();
          reject(new Error(`Sanctions list exceeds the ${maxBytes}-byte limit`));
          return;
        }
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        response.on('data', (chunk: Buffer) => {
          totalBytes += chunk.byteLength;
          if (totalBytes > maxBytes) {
            response.destroy(new Error(`Sanctions list exceeds the ${maxBytes}-byte limit`));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          resolve({ statusCode, location, body: Buffer.concat(chunks).toString('utf8') });
        });
        response.on('error', reject);
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Sanctions source download timed out')));
    req.on('error', reject);
    req.end();
  });
}

/**
 * Tolerant parser for OFAC's SDN CSV (ent_num, SDN_Name, SDN_Type, Program,
 * ...). Structural validation instead of a name character class: a row is an
 * entry when it has at least two cells and cell[1] looks like a name. Rows
 * that fail are counted and reported so silent data loss is visible.
 */
function parseSdnCsv(csv: string): {
  entries: Array<{
    externalId: string | null;
    entityName: string;
    entryType: string | null;
    raw: Record<string, unknown>;
  }>;
  skipped: number;
} {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const entries: Array<{
    externalId: string | null;
    entityName: string;
    entryType: string | null;
    raw: Record<string, unknown>;
  }> = [];
  let skipped = 0;
  for (const line of lines) {
    const cells = splitCsvLine(line);
    const candidate = cells[1]?.trim() ?? '';
    const isHeader = /^ent_num$/i.test(cells[0]?.trim() ?? '') && /^sdn_name$/i.test(candidate);
    if (isHeader) continue;
    // Malformed data rows are counted so ingestion cannot silently discard them.
    const looksLikeName =
      candidate.length > 1 &&
      /[A-Za-z\u00C0-\u024F]/.test(candidate) &&
      !/^sdn_name$/i.test(candidate);
    const hasNumericEntityId = /^\d+$/.test(cells[0] ?? '');
    const parsed = sanctionsImportRowSchema.safeParse({
      externalId: cells[0] || null,
      entityName: candidate.slice(0, 500),
      entryType: cells[2] ?? null,
      raw: { cells },
    });
    if (hasNumericEntityId && looksLikeName && parsed.success) {
      entries.push(parsed.data);
    } else {
      skipped += 1;
    }
  }
  return { entries, skipped };
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (inQuotes) {
    throw new Error('Malformed CSV: unterminated quoted field');
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}
