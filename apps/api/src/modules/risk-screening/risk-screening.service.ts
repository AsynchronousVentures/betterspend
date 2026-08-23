import { BadRequestException, Inject, Injectable, NotFoundException, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db } from '@betterspend/db';
import { sanctionsEntries, sanctionsScreenings, vendors } from '@betterspend/db';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';

export interface SanctionMatch {
  entryId: string;
  source: string;
  entityName: string;
  country: string | null;
  matchedOn: string;
  score: number;
}

/** Match threshold: token-overlap (jaccard) or levenshtein similarity must exceed this. */
const MATCH_THRESHOLD = 0.82;

@Injectable()
export class RiskScreeningService {
  private readonly logger = new Logger(RiskScreeningService.name);

  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * Download a public sanctions list and replace the local copy for that
   * source. URLs are server-controlled (per-source allowlist, optional
   * operator env override), never caller-supplied, so ingest cannot be turned
   * into an SSRF primitive or a tenant-controlled data swap.
   */
  private static readonly INGEST_SOURCES: Record<string, string> = {
    ofac_sdn: 'https://www.treasury.gov/ofac/downloads/sdn.csv',
  };
  private static readonly INGEST_TIMEOUT_MS = 30_000;

  async ingest(
    organizationId: string,
    userId: string,
    source = 'ofac_sdn',
  ): Promise<{ count: number; source: string }> {
    const listUrl =
      RiskScreeningService.INGEST_SOURCES[source] ?? process.env['SANCTIONS_LIST_URL'] ?? '';
    if (!listUrl) {
      throw new BadRequestException(`Unsupported sanctions source "${source}"`);
    }

    let response: Response;
    try {
      response = await fetch(listUrl, {
        redirect: 'follow',
        signal: AbortSignal.timeout(RiskScreeningService.INGEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(
        `Failed to download sanctions list from ${listUrl}: ${error instanceof Error ? error.message : error}`,
      );
    }
    if (!response.ok) {
      throw new Error(`Sanctions list download failed with HTTP ${response.status}`);
    }
    const csv = await response.text();
    const rows = parseSdnCsv(csv);
    if (rows.length === 0) {
      throw new Error('Sanctions list parse produced no entries; refusing to replace data');
    }

    await this.db.transaction(async (tx) => {
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
    });

    await this.audit.log(organizationId, userId, 'sanctions_registry', source, 'ingest', {
      url: listUrl,
      count: rows.length,
    });

    this.logger.log(`Ingested ${rows.length} ${source} entries from ${listUrl}`);
    return { count: rows.length, source };
  }

  /** Fuzzy-match one vendor against local sanctions entries and persist the outcome. */
  async screenVendor(organizationId: string, vendorId: string, screenedBy?: string) {
    return this.screenVendorWithEntries(organizationId, vendorId, screenedBy);
  }

  async screenAllVendors(organizationId: string, screenedBy?: string) {
    const orgVendors = await this.db.query.vendors.findMany({
      where: (v, { and, eq }) => and(eq(v.organizationId, organizationId), eq(v.status, 'active')),
      columns: { id: true },
    });
    // One pass over the registry shared by every vendor instead of a full
    // table scan per vendor.
    const entries = await this.loadEntries();
    let flagged = 0;
    for (const vendor of orgVendors) {
      const result = await this.screenVendorWithEntries(organizationId, vendor.id, screenedBy, entries);
      if (result.status === 'flagged') flagged += 1;
    }
    return { screened: orgVendors.length, flagged };
  }

  private async screenVendorWithEntries(
    organizationId: string,
    vendorId: string,
    screenedBy?: string,
    entries?: SanctionEntryRow[],
  ) {
    const vendor = await this.db.query.vendors.findFirst({
      where: (v, { and, eq }) => and(eq(v.id, vendorId), eq(v.organizationId, organizationId)),
    });
    if (!vendor) throw new NotFoundException(`Vendor ${vendorId} not found`);

    const matches = await this.matchVendorName(vendor.name, entries);

    // Fresh automated hits re-flag an unreviewed vendor. A manual review
    // decision stands either way; the screening row records what the new run
    // saw so auditors can revisit the override if data changed.
    const previousStatus = vendor.sanctionsStatus;
    const nextStatus =
      previousStatus === 'manually_reviewed'
        ? 'manually_reviewed'
        : matches.length > 0
          ? 'flagged'
          : 'clear';

    await this.db.transaction(async (tx) => {
      await tx.insert(sanctionsScreenings).values({
        organizationId,
        vendorId,
        result: matches.length > 0 ? 'flagged' : 'clear',
        matchCount: matches,
        screenedBy: screenedBy ?? null,
      });

      await tx
        .update(vendors)
        .set({
          sanctionsStatus: nextStatus,
          sanctionsCheckedAt: new Date(),
          sanctionsNote:
            nextStatus === 'manually_reviewed' ? (vendor.sanctionsNote ?? null) : null,
          updatedAt: new Date(),
        })
        .where(eq(vendors.id, vendorId));
    });

    await this.audit
      .log(organizationId, screenedBy ?? null, 'vendor', vendorId, 'sanctions_screening', {
        result: nextStatus,
        matchCount: matches.length,
      })
      .catch((error) =>
        this.logger.warn(`Audit log failed for ${vendorId} screening: ${error instanceof Error ? error.message : error}`),
      );

    return { vendorId, status: nextStatus, matches };
  }

  /** Admin override after human review of a flagged (or clear) vendor. */
  async manualReview(organizationId: string, vendorId: string, userId: string, note: string) {
    const trimmedNote = note.trim();
    if (!trimmedNote) {
      throw new BadRequestException('A justification note is required for manual review');
    }
    const vendor = await this.db.query.vendors.findFirst({
      where: (v, { and, eq }) => and(eq(v.id, vendorId), eq(v.organizationId, organizationId)),
    });
    if (!vendor) throw new NotFoundException(`Vendor ${vendorId} not found`);

    await this.db
      .update(vendors)
      .set({
        sanctionsStatus: 'manually_reviewed',
        sanctionsNote: trimmedNote,
        sanctionsCheckedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(vendors.id, vendorId));

    await this.audit.log(organizationId, userId, 'vendor', vendorId, 'sanctions_manual_review', {
      note: trimmedNote,
      previousStatus: vendor.sanctionsStatus,
    });

    return this.db.query.vendors.findFirst({ where: (v, { eq }) => eq(v.id, vendorId) });
  }

  async listStatus(organizationId: string) {
    return this.db.query.vendors.findMany({
      where: (v, { eq }) => eq(v.organizationId, organizationId),
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
   * PO gate. Throws when the org blocks POs for flagged vendors; returns a
   * warning string when flagged but only warning-level enforcement is set.
   */
  async checkVendorForPo(organizationId: string, vendor: { id: string; name: string; sanctionsStatus?: string | null }): Promise<string | null> {
    if (vendor.sanctionsStatus !== 'flagged') return null;
    const blocking =
      (await this.settingsService.get(organizationId, 'block_pos_for_flagged_vendors')) === 'true';
    if (blocking) {
      throw new BadRequestException(
        `Vendor "${vendor.name}" is flagged by sanctions screening and cannot receive purchase orders`,
      );
    }
    return `Vendor "${vendor.name}" is flagged by sanctions screening; review before issuing this PO`;
  }

  private async loadEntries(): Promise<SanctionEntryRow[]> {
    return this.db
      .select({
        id: sanctionsEntries.id,
        source: sanctionsEntries.source,
        entityName: sanctionsEntries.entityName,
        country: sanctionsEntries.country,
      })
      .from(sanctionsEntries);
  }

  private async matchVendorName(
    name: string,
    entries?: SanctionEntryRow[],
  ): Promise<SanctionMatch[]> {
    const normalizedTarget = normalize(name);
    if (!normalizedTarget) return [];

    const rows = entries ?? (await this.loadEntries());
    const matches: SanctionMatch[] = [];

    for (const entry of rows) {
      const score = similarity(normalizedTarget, normalize(entry.entityName));
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

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const tokensA = new Set(a.split(' '));
  const tokensB = new Set(b.split(' '));
  const intersection = [...tokensA].filter((token) => tokensB.has(token)).length;
  const union = new Set([...tokensA, ...tokensB]).size;
  const jaccard = union > 0 ? intersection / union : 0;
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

/**
 * Tolerant parser for OFAC's SDN CSV (ent_num, SDN_Name, SDN_Type, Program,
 * ...). Other lists with a leading-name layout usually parse acceptably; rows
 * that do not look like entries are skipped rather than fatal.
 */
function parseSdnCsv(csv: string): Array<{ externalId: string | null; entityName: string; entryType: string | null; raw: Record<string, unknown> }> {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const results: Array<{ externalId: string | null; entityName: string; entryType: string | null; raw: Record<string, unknown> }> = [];
  for (const line of lines) {
    const cells = splitCsvLine(line);
    if (cells.length < 2) continue;
    const [first, second] = cells;
    // Header row or non-entry line: names are alphabetic-ish.
    if (/^[A-Za-z ,.'\-\u00C0-\u024F]+$/.test(second ?? '')) {
      results.push({
        externalId: first || null,
        entityName: second.trim().slice(0, 500),
        entryType: cells[2] ?? null,
        raw: { cells },
      });
    }
  }
  return results;
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
  cells.push(current);
  return cells.map((cell) => cell.trim());
}
