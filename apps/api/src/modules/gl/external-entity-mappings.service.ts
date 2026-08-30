import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  appendAuditLog,
  departments,
  externalEntityMappings,
  projects,
  taxCodes,
  type Db,
  type DbTransaction,
  vendors,
} from '@betterspend/db';
import { DB_TOKEN } from '../../database/database.module';
import { qboSyncEntitySchema } from '@betterspend/shared';

const UUID_LOCAL_ENTITIES = new Set(['vendor', 'department', 'project', 'tax_code']);
const UUID_SCHEMA = z.string().uuid();
const MAX_LOCAL_ID_LENGTH = 255;
const MAX_GL_ACCOUNT_LENGTH = 100;

type ExternalMappingRow = typeof externalEntityMappings.$inferSelect;
type MappingRealm = { connectionId: string; realmId: string };
export type ExternalMappingRecord = Omit<ExternalMappingRow, 'localId' | 'localKey'> & {
  localId: string | null;
};
export type ExternalMappingAuditAction = 'linked' | 'unlinked' | 'default_set' | 'default_cleared';

export function serializeExternalMapping(mapping: ExternalMappingRow): ExternalMappingRecord {
  const { localId, localKey, ...rest } = mapping;
  return { ...rest, localId: localKey ?? localId };
}

function serializedLocalId(
  mapping: Pick<ExternalMappingRow, 'localId' | 'localKey'>,
): string | null {
  return mapping.localKey ?? mapping.localId;
}

function advisoryLockParts(parts: readonly string[]): readonly [number, number] {
  const digest = createHash('sha256').update(JSON.stringify(parts)).digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

export type ExternalMappingLockScope = Readonly<{
  organizationId: string;
  provider: string;
  direction: 'inbound' | 'outbound';
  externalEntity: string;
  localEntity: string;
}>;

function externalMappingLockParts(scope: ExternalMappingLockScope): readonly string[] {
  return [scope.organizationId, scope.provider, scope.direction, scope.localEntity];
}

async function acquireAdvisoryLock(
  transaction: DbTransaction,
  parts: readonly string[],
): Promise<void> {
  const [first, second] = advisoryLockParts(parts);
  await transaction.execute(sql`select pg_advisory_xact_lock(${first}, ${second})`);
}

/**
 * Serializes all link reads and writes for one organization/provider mapping
 * domain. Callers must acquire this transaction-scoped lock before inspecting
 * rows that may be changed by another mapping workflow.
 */
export async function lockExternalMappingScope(
  transaction: DbTransaction,
  scope: ExternalMappingLockScope,
): Promise<void> {
  await acquireAdvisoryLock(transaction, [...externalMappingLockParts(scope), '<scope>']);
}

export interface ExternalMappingResolutionInput {
  organizationId: string;
  provider: string;
  direction: 'inbound' | 'outbound';
  externalEntity: string;
  localEntity: string;
  localId: string;
  /** Resolve the provider default when no explicit local link exists. */
  fallbackToDefault?: boolean;
}

export interface ExternalMappingBatchResolutionInput {
  organizationId: string;
  provider: string;
  direction: 'inbound' | 'outbound';
  externalEntity: string;
  localEntity: string;
  localIds: readonly string[];
}

export interface ExternalMappingResolution {
  id: string;
  externalId: string;
  displayName: string | null;
  connectionId: string | null;
  realmId: string;
  source: 'linked' | 'default';
}

export interface ExternalMappingResolver {
  resolve(input: ExternalMappingResolutionInput): Promise<ExternalMappingResolution | null>;
  resolveMany(
    input: ExternalMappingBatchResolutionInput,
  ): Promise<ReadonlyMap<string, ExternalMappingResolution>>;
}

export interface ReplaceExternalMappingLinkInput {
  mappingId: string;
  organizationId: string;
  provider: string;
  direction: 'inbound' | 'outbound';
  localId: string | null;
  autoCreated?: boolean;
  isDefault?: boolean;
  userId?: string;
}

export interface ExternalMappingGateway extends ExternalMappingResolver {
  /** Replaces a local link in one transaction and preserves an audit trail. */
  replaceLink(input: ReplaceExternalMappingLinkInput): Promise<ExternalMappingRecord>;
}

/**
 * Deep mapping seam for provider-neutral catalog lookup and atomic link changes.
 * Provider adapters keep catalog identity and local-record validation behind
 * this interface, so export callers only receive a usable external identity.
 */
@Injectable()
export class ExternalEntityMappingsService implements ExternalMappingGateway {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  async resolve(input: ExternalMappingResolutionInput): Promise<ExternalMappingResolution | null> {
    if (
      input.localEntity !== 'gl_account' &&
      (!UUID_LOCAL_ENTITIES.has(input.localEntity) || !UUID_SCHEMA.safeParse(input.localId).success)
    ) {
      return null;
    }
    const realm = await this.activeQboRealm(input.organizationId, input.provider);
    if (input.provider === 'qbo' && !realm) return null;

    const linked = await this.db.query.externalEntityMappings.findFirst({
      where: (mapping, { and, eq, isNotNull }) =>
        and(
          eq(mapping.organizationId, input.organizationId),
          eq(mapping.provider, input.provider),
          eq(mapping.direction, input.direction),
          eq(mapping.externalEntity, input.externalEntity),
          eq(mapping.localEntity, input.localEntity),
          realm ? eq(mapping.connectionId, realm.connectionId) : undefined,
          realm ? eq(mapping.realmId, realm.realmId) : undefined,
          input.localEntity === 'gl_account'
            ? eq(mapping.localKey, input.localId)
            : eq(mapping.localId, input.localId),
          eq(mapping.isActive, true),
          eq(mapping.isDeleted, false),
          isNotNull(mapping.externalId),
        ),
      columns: { id: true, externalId: true, displayName: true, connectionId: true, realmId: true },
      orderBy: (mapping, { desc, asc }) => [desc(mapping.updatedAt), asc(mapping.id)],
    });
    if (linked?.externalId) {
      return { ...linked, externalId: linked.externalId, source: 'linked' };
    }
    if (!input.fallbackToDefault) return null;

    const defaultMapping = await this.db.query.externalEntityMappings.findFirst({
      where: (mapping, { and, eq, isNotNull }) =>
        and(
          eq(mapping.organizationId, input.organizationId),
          eq(mapping.provider, input.provider),
          eq(mapping.direction, input.direction),
          eq(mapping.externalEntity, input.externalEntity),
          eq(mapping.localEntity, input.localEntity),
          realm ? eq(mapping.connectionId, realm.connectionId) : undefined,
          realm ? eq(mapping.realmId, realm.realmId) : undefined,
          eq(mapping.isDefault, true),
          eq(mapping.isActive, true),
          eq(mapping.isDeleted, false),
          isNotNull(mapping.externalId),
        ),
      columns: { id: true, externalId: true, displayName: true, connectionId: true, realmId: true },
      orderBy: (mapping, { desc, asc }) => [desc(mapping.updatedAt), asc(mapping.id)],
    });
    if (!defaultMapping?.externalId) return null;
    return { ...defaultMapping, externalId: defaultMapping.externalId, source: 'default' };
  }

  async resolveMany(
    input: ExternalMappingBatchResolutionInput,
  ): Promise<ReadonlyMap<string, ExternalMappingResolution>> {
    const localIds = [...new Set(input.localIds)];
    if (localIds.length === 0) return new Map();
    if (
      input.localEntity !== 'gl_account' &&
      (!UUID_LOCAL_ENTITIES.has(input.localEntity) ||
        localIds.some((localId) => !UUID_SCHEMA.safeParse(localId).success))
    ) {
      return new Map();
    }
    const realm = await this.activeQboRealm(input.organizationId, input.provider);
    if (input.provider === 'qbo' && !realm) return new Map();

    const rows = await this.db.query.externalEntityMappings.findMany({
      where: (mapping, { and, eq, inArray, isNotNull }) =>
        and(
          eq(mapping.organizationId, input.organizationId),
          eq(mapping.provider, input.provider),
          eq(mapping.direction, input.direction),
          eq(mapping.externalEntity, input.externalEntity),
          eq(mapping.localEntity, input.localEntity),
          realm ? eq(mapping.connectionId, realm.connectionId) : undefined,
          realm ? eq(mapping.realmId, realm.realmId) : undefined,
          input.localEntity === 'gl_account'
            ? inArray(mapping.localKey, localIds)
            : inArray(mapping.localId, localIds),
          eq(mapping.isActive, true),
          eq(mapping.isDeleted, false),
          isNotNull(mapping.externalId),
        ),
      columns: {
        id: true,
        externalId: true,
        displayName: true,
        connectionId: true,
        realmId: true,
        localId: true,
        localKey: true,
      },
      orderBy: (mapping, { desc, asc }) => [desc(mapping.updatedAt), asc(mapping.id)],
    });

    const resolved = new Map<string, ExternalMappingResolution>();
    for (const row of rows) {
      const localId = input.localEntity === 'gl_account' ? row.localKey : row.localId;
      if (!localId || !row.externalId || resolved.has(localId)) continue;
      resolved.set(localId, {
        id: row.id,
        externalId: row.externalId,
        displayName: row.displayName,
        connectionId: row.connectionId,
        realmId: row.realmId,
        source: 'linked',
      });
    }
    return resolved;
  }

  async replaceLink(input: ReplaceExternalMappingLinkInput): Promise<ExternalMappingRecord> {
    try {
      const updated = await this.db.transaction((transaction) =>
        this.replaceLinkInTransaction(transaction, input),
      );
      return serializeExternalMapping(updated);
    } catch (error: unknown) {
      if (isLinkedLocalUniqueViolation(error)) {
        throw new ConflictException('Local record is already linked to another active mapping');
      }
      throw error;
    }
  }

  private async replaceLinkInTransaction(
    transaction: DbTransaction,
    input: ReplaceExternalMappingLinkInput,
  ): Promise<ExternalMappingRow> {
    const realm = await this.activeQboRealm(input.organizationId, input.provider, transaction);
    if (input.provider === 'qbo' && !realm) {
      throw new NotFoundException(`External mapping ${input.mappingId} not found`);
    }
    const initialMapping = await this.findMapping(transaction, input, realm);
    if (!initialMapping)
      throw new NotFoundException(`External mapping ${input.mappingId} not found`);
    if (
      input.provider === 'qbo' &&
      !qboSyncEntitySchema.safeParse(initialMapping.externalEntity).success
    )
      throw new NotFoundException(`External mapping ${input.mappingId} not found`);
    if (initialMapping.isActive === false || initialMapping.isDeleted === true) {
      throw new NotFoundException(`External mapping ${input.mappingId} not found`);
    }
    if (!initialMapping.externalId) {
      throw new BadRequestException('Mappings without an external provider ID cannot be linked');
    }

    const localId = input.localId?.trim() || null;
    if (input.localId !== null && !localId) {
      throw new BadRequestException('Local mapping identifiers cannot be blank');
    }

    // The first lookup only supplies the lock scope. Re-read after the
    // transaction lock so concurrent link changes cannot replace stale data.
    await this.lockReplacement(transaction, input, initialMapping, localId);
    const mapping = await this.findMapping(transaction, input, realm);
    if (!mapping) throw new NotFoundException(`External mapping ${input.mappingId} not found`);
    if (mapping.isActive === false || mapping.isDeleted === true) {
      throw new NotFoundException(`External mapping ${input.mappingId} not found`);
    }
    if (!mapping.externalId) {
      throw new BadRequestException('Mappings without an external provider ID cannot be linked');
    }

    if (input.isDefault === true && localId !== null) {
      throw new BadRequestException('Default mappings cannot be linked to a local record');
    }
    const isDefault = input.isDefault ?? false;
    if (isDefault) {
      if (
        input.provider !== 'qbo' ||
        input.direction !== 'inbound' ||
        mapping.localEntity !== 'department' ||
        mapping.externalEntity !== 'Class' ||
        !mapping.externalId
      ) {
        throw new BadRequestException(
          'Only an active QBO Class can be the default department mapping',
        );
      }
    }
    if (localId)
      await this.assertLocalRecord(transaction, mapping.localEntity, localId, input.organizationId);

    const nextLocalId = mapping.localEntity === 'gl_account' ? null : localId;
    const nextLocalKey = mapping.localEntity === 'gl_account' ? localId : null;

    if (localId) {
      const previous = await transaction.query.externalEntityMappings.findMany({
        where: (row, { and, eq, ne }) =>
          and(
            eq(row.organizationId, input.organizationId),
            eq(row.provider, input.provider),
            eq(row.direction, input.direction),
            eq(row.localEntity, mapping.localEntity),
            realm ? eq(row.connectionId, realm.connectionId) : undefined,
            realm ? eq(row.realmId, realm.realmId) : undefined,
            mapping.localEntity === 'gl_account'
              ? eq(row.localKey, localId)
              : eq(row.localId, localId),
            eq(row.isActive, true),
            eq(row.isDeleted, false),
            ne(row.id, mapping.id),
          ),
        orderBy: (row, { desc, asc }) => [desc(row.updatedAt), asc(row.id)],
      });
      for (const previousLink of previous) {
        const [unlinked] = await transaction
          .update(externalEntityMappings)
          .set({ localId: null, localKey: null, isDefault: false, updatedAt: new Date() })
          .where(
            and(
              eq(externalEntityMappings.id, previousLink.id),
              eq(externalEntityMappings.organizationId, input.organizationId),
              eq(externalEntityMappings.provider, input.provider),
              eq(externalEntityMappings.direction, input.direction),
              eq(externalEntityMappings.localEntity, mapping.localEntity),
              realm ? eq(externalEntityMappings.connectionId, realm.connectionId) : undefined,
              realm ? eq(externalEntityMappings.realmId, realm.realmId) : undefined,
              eq(externalEntityMappings.isActive, true),
              eq(externalEntityMappings.isDeleted, false),
            ),
          )
          .returning();
        if (unlinked) {
          await this.auditMutation(transaction, {
            organizationId: input.organizationId,
            userId: input.userId ?? null,
            mappingId: previousLink.id,
            action: 'unlinked',
            changes: { localId: { from: serializedLocalId(previousLink), to: null } },
            reason: 'replaced',
          });
        }
      }
    }

    if (isDefault) {
      const previousDefaults = await transaction.query.externalEntityMappings.findMany({
        where: (row, { and, eq, ne }) =>
          and(
            eq(row.organizationId, input.organizationId),
            eq(row.provider, input.provider),
            eq(row.direction, input.direction),
            eq(row.externalEntity, mapping.externalEntity),
            eq(row.localEntity, mapping.localEntity),
            realm ? eq(row.connectionId, realm.connectionId) : undefined,
            realm ? eq(row.realmId, realm.realmId) : undefined,
            eq(row.isDefault, true),
            eq(row.isActive, true),
            eq(row.isDeleted, false),
            ne(row.id, mapping.id),
          ),
        orderBy: (row, { desc, asc }) => [desc(row.updatedAt), asc(row.id)],
      });
      for (const previousDefault of previousDefaults) {
        const [cleared] = await transaction
          .update(externalEntityMappings)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(
            and(
              eq(externalEntityMappings.id, previousDefault.id),
              eq(externalEntityMappings.organizationId, input.organizationId),
              eq(externalEntityMappings.provider, input.provider),
              eq(externalEntityMappings.direction, previousDefault.direction),
              realm ? eq(externalEntityMappings.connectionId, realm.connectionId) : undefined,
              realm ? eq(externalEntityMappings.realmId, realm.realmId) : undefined,
              eq(externalEntityMappings.isActive, true),
              eq(externalEntityMappings.isDeleted, false),
            ),
          )
          .returning();
        if (cleared) {
          await this.auditMutation(transaction, {
            organizationId: input.organizationId,
            userId: input.userId ?? null,
            mappingId: previousDefault.id,
            action: 'default_cleared',
            changes: { isDefault: { from: true, to: false } },
            reason: 'replaced',
          });
        }
      }
    }

    const nextAutoCreated = input.autoCreated ?? mapping.autoCreated ?? false;
    const changed =
      mapping.localId !== nextLocalId ||
      mapping.localKey !== nextLocalKey ||
      mapping.autoCreated !== nextAutoCreated ||
      (mapping.isDefault ?? false) !== isDefault;
    if (!changed) return mapping;

    const [updated] = await transaction
      .update(externalEntityMappings)
      .set({
        localId: nextLocalId,
        localKey: nextLocalKey,
        autoCreated: nextAutoCreated,
        isDefault,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(externalEntityMappings.id, input.mappingId),
          eq(externalEntityMappings.organizationId, input.organizationId),
          eq(externalEntityMappings.provider, input.provider),
          eq(externalEntityMappings.direction, input.direction),
          realm ? eq(externalEntityMappings.connectionId, realm.connectionId) : undefined,
          realm ? eq(externalEntityMappings.realmId, realm.realmId) : undefined,
          eq(externalEntityMappings.isActive, true),
          eq(externalEntityMappings.isDeleted, false),
        ),
      )
      .returning();
    if (!updated) throw new NotFoundException(`External mapping ${input.mappingId} not found`);

    await this.auditMutation(transaction, {
      organizationId: input.organizationId,
      userId: input.userId ?? null,
      mappingId: input.mappingId,
      action: isDefault ? 'default_set' : localId === null ? 'unlinked' : 'linked',
      changes: {
        localId: { from: serializedLocalId(mapping), to: localId },
        autoCreated: { from: mapping.autoCreated, to: nextAutoCreated },
        isDefault: { from: mapping.isDefault ?? false, to: isDefault },
      },
      reason: undefined,
    });
    return updated;
  }

  private async findMapping(
    transaction: DbTransaction,
    input: ReplaceExternalMappingLinkInput,
    realm: MappingRealm | null,
  ): Promise<ExternalMappingRow | undefined> {
    return transaction.query.externalEntityMappings.findFirst({
      where: (row, { and, eq }) =>
        and(
          eq(row.id, input.mappingId),
          eq(row.organizationId, input.organizationId),
          eq(row.provider, input.provider),
          eq(row.direction, input.direction),
          realm ? eq(row.connectionId, realm.connectionId) : undefined,
          realm ? eq(row.realmId, realm.realmId) : undefined,
        ),
    });
  }

  private async activeQboRealm(
    organizationId: string,
    provider: string,
    database: Pick<Db, 'query'> | Pick<DbTransaction, 'query'> = this.db,
  ): Promise<MappingRealm | null> {
    if (provider !== 'qbo') return null;
    const connection = await database.query.integrationConnections.findFirst({
      where: (row, { and, eq }) =>
        and(
          eq(row.organizationId, organizationId),
          eq(row.provider, 'qbo'),
          eq(row.status, 'active'),
        ),
      columns: { id: true, realmId: true },
    });
    return connection?.realmId
      ? { connectionId: connection.id, realmId: connection.realmId }
      : null;
  }

  private async lockReplacement(
    transaction: DbTransaction,
    input: ReplaceExternalMappingLinkInput,
    mapping: ExternalMappingRow,
    requestedLocalId: string | null,
  ): Promise<void> {
    const scope: ExternalMappingLockScope = {
      organizationId: input.organizationId,
      provider: input.provider,
      direction: input.direction,
      externalEntity: mapping.externalEntity,
      localEntity: mapping.localEntity,
    };
    await lockExternalMappingScope(transaction, scope);
    const scopeParts = externalMappingLockParts(scope);

    const identities = [
      serializedLocalId(mapping) ?? '<unlinked>',
      requestedLocalId ?? '<unlinked>',
    ];
    for (const identity of [...new Set(identities)].sort()) {
      await acquireAdvisoryLock(transaction, [...scopeParts, identity]);
    }
  }

  private async assertLocalRecord(
    transaction: DbTransaction,
    localEntity: string,
    localId: string,
    organizationId: string,
  ): Promise<void> {
    if (localId.length > MAX_LOCAL_ID_LENGTH) {
      throw new BadRequestException('Local mapping identifiers are too long');
    }
    if (localEntity === 'gl_account') {
      if (localId.length > MAX_GL_ACCOUNT_LENGTH) {
        throw new BadRequestException('GL account identifiers are too long');
      }
      return;
    }
    if (!UUID_LOCAL_ENTITIES.has(localEntity) || !UUID_SCHEMA.safeParse(localId).success) {
      throw new BadRequestException(`QBO ${localEntity} links require a valid local record`);
    }

    const exists =
      localEntity === 'vendor'
        ? await transaction
            .select({ id: vendors.id })
            .from(vendors)
            .where(and(eq(vendors.id, localId), eq(vendors.organizationId, organizationId)))
            .for('key share')
            .limit(1)
        : localEntity === 'department'
          ? await transaction
              .select({ id: departments.id })
              .from(departments)
              .where(
                and(eq(departments.id, localId), eq(departments.organizationId, organizationId)),
              )
              .for('key share')
              .limit(1)
          : localEntity === 'project'
            ? await transaction
                .select({ id: projects.id })
                .from(projects)
                .where(and(eq(projects.id, localId), eq(projects.organizationId, organizationId)))
                .for('key share')
                .limit(1)
            : await transaction
                .select({ id: taxCodes.id })
                .from(taxCodes)
                .where(and(eq(taxCodes.id, localId), eq(taxCodes.orgId, organizationId)))
                .for('key share')
                .limit(1);
    if (exists.length === 0)
      throw new BadRequestException(`QBO mappings require a valid ${localEntity} record`);
  }

  private async auditMutation(
    transaction: DbTransaction,
    input: {
      organizationId: string;
      userId: string | null;
      mappingId: string;
      action: ExternalMappingAuditAction;
      changes: Record<string, unknown>;
      reason?: string;
    },
  ): Promise<void> {
    await appendAuditLog(transaction, {
      organizationId: input.organizationId,
      userId: input.userId,
      entityType: 'external_entity_mapping',
      entityId: input.mappingId,
      action: input.action,
      changes: input.changes,
      metadata: {
        actor: input.userId ? 'user' : 'system',
        source: input.userId ? 'user' : 'mapping',
        ...(input.reason ? { reason: input.reason } : {}),
      },
    });
  }
}

function isLinkedLocalUniqueViolation(error: unknown): boolean {
  let current = error;
  const seen = new Set<object>();
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current);
    const candidate = current as Record<string, unknown>;
    if (
      candidate.code === '23505' &&
      candidate.constraint_name === 'external_entity_mappings_linked_local_identity_unique'
    )
      return true;
    current = candidate.cause;
  }
  return false;
}
