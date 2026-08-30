import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { and, eq, isNull } from 'drizzle-orm';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import {
  appendAuditLog,
  appendAuditLogIfAbsent,
  departments,
  externalEntityMappings,
  integrationConnections,
  projects,
  taxCodes,
  type Db,
  type DbTransaction,
  vendors,
} from '@betterspend/db';
import {
  QBO_CATALOG_ENTITY_TYPES,
  QBO_TAX_ENTITY_TYPES,
  QBO_TRANSACTION_ENTITY_TYPES,
  qboSyncEntitySchema,
  type QboMappingLinkInput,
  type QboSyncEntity,
} from '@betterspend/shared';
import { DB_TOKEN } from '../../../database/database.module';
import {
  findReusableQboInitialSyncJob,
  QBO_INITIAL_SYNC_JOB_NAME,
  qboInitialSyncJobOptions,
  QBO_SYNC_QUEUE_NAME,
} from '../../../common/qbo-sync-queue';
import { NotificationsService } from '../../notifications/notifications.service';
import { resolveOrganizationAdminId } from '../../../common/demo-identity';
import { QboClientService, QboResourceNotFoundError } from '../../gl/qbo-client.service';
import { OAuthRedisService, type OAuthLockGuard } from '../../gl/oauth-redis.service';

export type QboCatalogEntity = (typeof QBO_CATALOG_ENTITY_TYPES)[number];
export type QboTaxEntity = (typeof QBO_TAX_ENTITY_TYPES)[number];

const CDC_ENTITY_TYPES = [...QBO_CATALOG_ENTITY_TYPES, ...QBO_TRANSACTION_ENTITY_TYPES] as const;

const QBO_WEBHOOK_ENTITY_TYPES = [
  ...QBO_CATALOG_ENTITY_TYPES,
  ...QBO_TAX_ENTITY_TYPES,
  ...QBO_TRANSACTION_ENTITY_TYPES,
] as const;

const QBO_WEBHOOK_OPERATIONS = ['create', 'update', 'delete', 'merge'] as const;
const qboOrganizationIdSchema = z.string().min(1).max(255);
const qboConnectionIdSchema = z.string().min(1).max(255);
const qboRealmIdSchema = z.string().min(1).max(255);
const qboExternalIdSchema = z.string().min(1).max(255);
const qboSyncEntityTypesSchema = z.array(qboSyncEntitySchema).min(1).optional();

const QBO_ACCOUNT_TYPES = new Set([
  'Accounts Payable',
  'Cost of Goods Sold',
  'Expense',
  'Other Expense',
]);

const CDC_RESPONSE_LIMIT = 1_000;
const QUERY_PAGE_SIZE = 1000;
const DEFAULT_SYNC_INTERVAL_MS = 60 * 60 * 1000;
const MAX_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_LOOKBACK_DAYS = 30;
const QBO_RECOVERY_ATTEMPTS = 5;
const QBO_RECOVERY_BACKOFF_DELAY_MS = 5_000;
const QBO_RECONCILIATION_JOB_NAME = 'webhook-reconciliation';
const QBO_CDC_RECOVERY_JOB_NAME = 'cdc-recovery';
const QBO_VENDOR_MERGE_RECOVERY_JOB_NAME = 'vendor-merge-recovery';
const PENDING_INITIAL_SYNC_RECOVERY_INTERVAL_MS = 30_000;
const QBO_ACTIVE_ENTITY_TYPES = new Set<QboSyncEntity>(QBO_CATALOG_ENTITY_TYPES);

export const qboWebhookEventSchema = z
  .object({
    realmId: z.string().min(1).max(255),
    entityName: z.enum(QBO_WEBHOOK_ENTITY_TYPES),
    entityId: z.string().min(1).max(255),
    operation: z.enum(QBO_WEBHOOK_OPERATIONS),
    lastUpdated: z.string().min(1).max(100).optional(),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

export const qboCdcJobDataSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('webhook'),
      event: qboWebhookEventSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('cdc-sweep'),
      organizationId: qboOrganizationIdSchema,
      lookbackDays: z.number().int().min(1).max(MAX_LOOKBACK_DAYS).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('cdc-recovery'),
      organizationId: qboOrganizationIdSchema,
      connectionId: qboConnectionIdSchema,
      realmId: qboRealmIdSchema,
      lookbackDays: z.number().int().min(1).max(MAX_LOOKBACK_DAYS).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('vendor-merge-recovery'),
      organizationId: qboOrganizationIdSchema,
      connectionId: qboConnectionIdSchema,
      realmId: qboRealmIdSchema,
      sourceId: qboExternalIdSchema,
      targetId: qboExternalIdSchema,
    })
    .strict(),
]);

export const qboSyncJobDataSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('initial'),
      organizationId: qboOrganizationIdSchema,
      entityTypes: qboSyncEntityTypesSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('scheduled'),
      organizationId: qboOrganizationIdSchema,
      entityTypes: qboSyncEntityTypesSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('reconcile'),
      organizationId: qboOrganizationIdSchema,
      connectionId: qboConnectionIdSchema,
      realmId: qboRealmIdSchema,
      entityName: qboSyncEntitySchema,
    })
    .strict(),
]);

type QboObject = Record<string, unknown>;

type QboEntityDefinition = {
  readonly localEntity: string;
  readonly displayName: (entity: QboObject) => string | null;
  readonly shouldStore?: (entity: QboObject) => boolean;
};

const ENTITY_DEFINITIONS: Readonly<Record<QboSyncEntity, QboEntityDefinition>> = {
  Account: {
    localEntity: 'gl_account',
    displayName: displayNameFromQbo,
    shouldStore: (entity) => QBO_ACCOUNT_TYPES.has(stringValue(entity.AccountType) ?? ''),
  },
  Vendor: { localEntity: 'vendor', displayName: displayNameFromQbo },
  Class: { localEntity: 'department', displayName: displayNameFromQbo },
  Department: { localEntity: 'department', displayName: displayNameFromQbo },
  Customer: { localEntity: 'project', displayName: displayNameFromQbo },
  Term: { localEntity: 'payment_term', displayName: displayNameFromQbo },
  TaxCode: { localEntity: 'tax_code', displayName: displayNameFromQbo },
  TaxRate: { localEntity: 'tax_rate', displayName: displayNameFromQbo },
};

export type QboSyncJobData =
  | {
      kind: 'initial' | 'scheduled';
      organizationId: string;
      entityTypes?: readonly QboSyncEntity[];
    }
  | {
      kind: 'reconcile';
      organizationId: string;
      connectionId: string;
      realmId: string;
      entityName: QboSyncEntity;
    };

export type QboWebhookEvent = {
  realmId: string;
  entityName: QboWebhookEntity;
  entityId: string;
  operation: QboWebhookOperation;
  lastUpdated?: string;
  payload: QboObject;
};

export type QboWebhookEntity = (typeof QBO_WEBHOOK_ENTITY_TYPES)[number];
export type QboWebhookOperation = (typeof QBO_WEBHOOK_OPERATIONS)[number];

export type QboCdcJobData =
  | { kind: 'webhook'; event: QboWebhookEvent }
  | { kind: 'cdc-sweep'; organizationId: string; lookbackDays?: number }
  | {
      kind: 'cdc-recovery';
      organizationId: string;
      connectionId: string;
      realmId: string;
      lookbackDays?: number;
    }
  | {
      kind: 'vendor-merge-recovery';
      organizationId: string;
      connectionId: string;
      realmId: string;
      sourceId: string;
      targetId: string;
    };

export type QboSyncResult = {
  organizationId: string;
  imported: number;
  tombstones: number;
  completedAt: string;
};

type CdcEntry = {
  entityName: string;
  entity: QboObject;
  deleted: boolean;
};

type MappingUpsert = {
  organizationId: string;
  connectionId: string;
  realmId: string;
  entityName: string;
  entity: QboObject;
  providerUpdatedAt?: Date;
  deleted: boolean;
  mergedIntoExternalId?: string | null;
  localId?: string | null;
  autoCreated?: boolean;
  /** Merge events must not mutate a mapping that belongs to an older QBO realm. */
  connectionScoped?: boolean;
  auditSource?: 'snapshot' | 'cdc' | 'webhook' | 'merge';
  auditReason?: string;
};

/**
 * Provider-facing QBO import module. Callers only enqueue a sync, list the
 * cached catalog, or link one row. Query paging, CDC envelopes, tombstones,
 * and provider-specific entity names stay behind this interface.
 */
@Injectable()
export class QboInboundService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QboInboundService.name);
  private qboScheduleRecoveryTimer?: ReturnType<typeof setInterval>;
  private qboScheduleRecoveryRunning = false;

  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly qboClient: QboClientService,
    private readonly notifications: NotificationsService,
    @InjectQueue(QBO_SYNC_QUEUE_NAME) private readonly syncQueue: Queue<QboSyncJobData>,
    @InjectQueue('qbo-cdc') private readonly cdcQueue: Queue<QboCdcJobData>,
    private readonly oauthRedis: OAuthRedisService,
  ) {}

  async onModuleInit(): Promise<void> {
    const connections = await this.db.query.integrationConnections.findMany({
      where: (connection, { and, eq }) =>
        and(eq(connection.provider, 'qbo'), eq(connection.status, 'active')),
      columns: { organizationId: true, lastSyncAt: true },
    });

    await Promise.all(
      connections.map(async ({ organizationId, lastSyncAt }) => {
        try {
          if (lastSyncAt) {
            await this.scheduleOrganization(organizationId);
            return;
          }

          await this.enqueueInitialSync(organizationId);
        } catch (error: unknown) {
          this.logger.error(
            `Unable to recover pending initial QBO sync for ${organizationId}: ${String(error)}`,
          );
        }
      }),
    );

    this.qboScheduleRecoveryTimer = setInterval(() => {
      void this.recoverQboSchedules();
    }, PENDING_INITIAL_SYNC_RECOVERY_INTERVAL_MS);
    this.qboScheduleRecoveryTimer.unref();
  }

  onModuleDestroy(): void {
    if (!this.qboScheduleRecoveryTimer) return;
    clearInterval(this.qboScheduleRecoveryTimer);
    this.qboScheduleRecoveryTimer = undefined;
  }

  private async recoverQboSchedules(): Promise<void> {
    if (this.qboScheduleRecoveryRunning) return;
    this.qboScheduleRecoveryRunning = true;

    try {
      const connections = await this.db.query.integrationConnections.findMany({
        where: (connection, { and, eq }) =>
          and(eq(connection.provider, 'qbo'), eq(connection.status, 'active')),
        columns: { organizationId: true, lastSyncAt: true },
      });

      await Promise.all(
        connections.map(async ({ organizationId, lastSyncAt }) => {
          try {
            if (lastSyncAt) {
              await this.scheduleOrganization(organizationId);
            } else {
              await this.enqueueInitialSync(organizationId);
            }
          } catch (error: unknown) {
            this.logger.error(
              `Unable to recover QBO schedules for ${organizationId}: ${String(error)}`,
            );
          }
        }),
      );
    } catch (error: unknown) {
      this.logger.error(`Unable to inspect QBO schedules: ${String(error)}`);
    } finally {
      this.qboScheduleRecoveryRunning = false;
    }
  }

  async enqueueInitialSync(
    organizationId: string,
    entityTypes: readonly QboSyncEntity[] = [...QBO_CATALOG_ENTITY_TYPES, ...QBO_TAX_ENTITY_TYPES],
  ): Promise<{ queued: true; jobId: string | undefined }> {
    const options = qboInitialSyncJobOptions(organizationId);
    const existing = await findReusableQboInitialSyncJob(this.syncQueue, organizationId);
    if (existing) return { queued: true, jobId: existing.id };

    const job = await this.syncQueue.add(
      QBO_INITIAL_SYNC_JOB_NAME,
      { kind: 'initial', organizationId, entityTypes },
      options,
    );
    return { queued: true, jobId: job.id };
  }

  /**
   * Creates the repeatable jobs for a connected organization after its initial
   * import succeeds, so a newly connected organization does not wait for an
   * application restart to receive its hourly import and daily CDC sweep.
   */
  async ensureScheduledSync(organizationId: string): Promise<void> {
    await this.scheduleOrganization(organizationId);
  }

  async enqueueCdcSweep(
    organizationId: string,
    lookbackDays = MAX_LOOKBACK_DAYS,
  ): Promise<{ queued: true; jobId: string | undefined }> {
    const jobId = `qbo-cdc-sweep-${organizationId}-${new Date().toISOString().slice(0, 10)}`;
    const existing = await this.existingQueueJob(this.cdcQueue, jobId);
    if (existing) return { queued: true, jobId: existing.id };

    const job = await this.cdcQueue.add(
      'cdc-sweep',
      { kind: 'cdc-sweep', organizationId, lookbackDays },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
        jobId,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    return { queued: true, jobId: job.id };
  }

  async enqueueCatalogReconciliation(
    connection: { id: string; organizationId: string; realmId: string },
    entityName: QboSyncEntity,
  ): Promise<{ queued: true; jobId: string | undefined }> {
    const data: QboSyncJobData = {
      kind: 'reconcile',
      organizationId: connection.organizationId,
      connectionId: connection.id,
      realmId: connection.realmId,
      entityName,
    };
    qboSyncJobDataSchema.parse(data);
    const jobId = qboRecoveryJobId('catalog', [
      connection.organizationId,
      connection.id,
      connection.realmId,
      entityName,
    ]);
    const existing = await this.existingDurableQueueJob(this.syncQueue, jobId);
    if (existing) return { queued: true, jobId: existing.id };

    const job = await this.syncQueue.add(QBO_RECONCILIATION_JOB_NAME, data, {
      attempts: QBO_RECOVERY_ATTEMPTS,
      backoff: { type: 'exponential', delay: QBO_RECOVERY_BACKOFF_DELAY_MS },
      jobId,
      removeOnComplete: true,
      // Keep the failed recovery job available for operator inspection/retry.
      removeOnFail: false,
    });
    return { queued: true, jobId: job.id };
  }

  async enqueueCdcRecovery(
    connection: { id: string; organizationId: string; realmId: string },
    lookbackDays = MAX_LOOKBACK_DAYS,
  ): Promise<{ queued: true; jobId: string | undefined }> {
    const data: QboCdcJobData = {
      kind: 'cdc-recovery',
      organizationId: connection.organizationId,
      connectionId: connection.id,
      realmId: connection.realmId,
      lookbackDays,
    };
    qboCdcJobDataSchema.parse(data);
    const jobId = qboRecoveryJobId('cdc', [
      connection.organizationId,
      connection.id,
      connection.realmId,
    ]);
    const existing = await this.existingDurableQueueJob(this.cdcQueue, jobId);
    if (existing) return { queued: true, jobId: existing.id };

    const job = await this.cdcQueue.add(QBO_CDC_RECOVERY_JOB_NAME, data, {
      attempts: QBO_RECOVERY_ATTEMPTS,
      backoff: { type: 'exponential', delay: QBO_RECOVERY_BACKOFF_DELAY_MS },
      jobId,
      removeOnComplete: true,
      // A failed reconciliation is evidence that the webhook stream needs attention.
      removeOnFail: false,
    });
    return { queued: true, jobId: job.id };
  }

  async enqueueVendorMergeRecovery(
    connection: { id: string; organizationId: string; realmId: string },
    event: QboWebhookEvent,
  ): Promise<{ queued: true; jobId: string | undefined }> {
    const { sourceId, targetId } = vendorMergeIds(event);
    if (!sourceId || !targetId || sourceId === targetId) {
      throw new ServiceUnavailableException(
        'QBO Vendor Merge cannot be recovered without distinct source and target IDs',
      );
    }

    const data: QboCdcJobData = {
      kind: 'vendor-merge-recovery',
      organizationId: connection.organizationId,
      connectionId: connection.id,
      realmId: connection.realmId,
      sourceId,
      targetId,
    };
    qboCdcJobDataSchema.parse(data);
    const jobId = qboRecoveryJobId('vendor-merge', [
      connection.organizationId,
      connection.id,
      connection.realmId,
      sourceId,
      targetId,
    ]);
    const existing = await this.existingDurableQueueJob(this.cdcQueue, jobId);
    if (existing) return { queued: true, jobId: existing.id };

    const job = await this.cdcQueue.add(QBO_VENDOR_MERGE_RECOVERY_JOB_NAME, data, {
      attempts: QBO_RECOVERY_ATTEMPTS,
      backoff: { type: 'exponential', delay: QBO_RECOVERY_BACKOFF_DELAY_MS },
      jobId,
      removeOnComplete: true,
      // Preserve permanent merge failures instead of losing the remapping evidence.
      removeOnFail: false,
    });
    return { queued: true, jobId: job.id };
  }

  private async recordUnrecoverableVendorMerge(
    connection: { id: string; organizationId: string; realmId: string },
    event: QboWebhookEvent,
    assertLock: OAuthLockGuard,
  ): Promise<void> {
    const { sourceId, targetId } = vendorMergeIds(event);
    const auditId = qboStableUuid(
      'qbo-vendor-merge-recovery-failed',
      connection.organizationId,
      connection.id,
      connection.realmId,
      event.entityName,
      event.operation,
      event.entityId,
      sourceId ?? '',
      targetId ?? '',
    );
    let recorded = false;

    await assertLock();
    await this.db.transaction(async (transaction) => {
      await assertLock();
      if (
        !(await this.lockCurrentQboConnection(
          transaction,
          connection.id,
          connection.organizationId,
          connection.realmId,
        ))
      ) {
        return;
      }

      await appendAuditLogIfAbsent(transaction, {
        id: auditId,
        organizationId: connection.organizationId,
        userId: null,
        entityType: 'integration_connection',
        entityId: connection.id,
        action: 'vendor_merge_recovery_failed',
        changes: {
          reason: 'missing_or_invalid_merge_ids',
          sourceIdPresent: sourceId !== null,
          targetIdPresent: targetId !== null,
          distinctIds: sourceId !== null && targetId !== null && sourceId !== targetId,
        },
        metadata: {
          actor: 'system',
          provider: 'qbo',
          source: 'webhook',
          connectionId: connection.id,
          realmId: connection.realmId,
          event: {
            entityName: event.entityName,
            operation: event.operation,
            entityId: event.entityId,
            payloadKeys: Object.keys(event.payload)
              .filter((key) => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key))
              .sort()
              .slice(0, 32),
          },
        },
      });
      recorded = true;
    });

    if (!recorded) return;

    await assertLock();
    try {
      const adminId = await resolveOrganizationAdminId(this.db, connection.organizationId);
      if (!adminId) return;
      await assertLock();
      await this.notifications.createIdempotent(
        `qbo-vendor-merge-recovery-failed:${auditId}`,
        connection.organizationId,
        adminId,
        'qbo_vendor_merge_recovery_failed',
        'QuickBooks vendor merge needs attention',
        'QuickBooks sent a vendor merge event without distinct source and target IDs. The event was retained for manual reconciliation.',
        'integration_connection',
        connection.id,
      );
    } catch (error: unknown) {
      this.logger.error(
        `Unable to notify the QBO administrator about a retained merge failure: ${String(error)}`,
      );
    }
  }

  async listMappings(organizationId: string, externalEntity?: string) {
    const connection = await this.activeConnection(organizationId);
    if (!connection) return [];

    return this.db.query.externalEntityMappings.findMany({
      where: (mapping, { and, eq }) =>
        and(
          eq(mapping.organizationId, organizationId),
          eq(mapping.connectionId, connection.id),
          eq(mapping.realmId, connection.realmId),
          eq(mapping.provider, 'qbo'),
          eq(mapping.direction, 'inbound'),
          externalEntity ? eq(mapping.externalEntity, externalEntity) : undefined,
        ),
      orderBy: (mapping, { asc }) => asc(mapping.displayName),
    });
  }

  async linkMapping(
    mappingId: string,
    organizationId: string,
    input: QboMappingLinkInput,
    userId?: string,
  ) {
    return this.db.transaction(async (transaction) => {
      const [connection] = await transaction
        .select({ id: integrationConnections.id, realmId: integrationConnections.realmId })
        .from(integrationConnections)
        .where(
          and(
            eq(integrationConnections.organizationId, organizationId),
            eq(integrationConnections.provider, 'qbo'),
            eq(integrationConnections.status, 'active'),
          ),
        )
        .for('update')
        .limit(1);
      if (!connection) throw new ServiceUnavailableException('QBO is not connected');

      const [mapping] = await transaction
        .select()
        .from(externalEntityMappings)
        .where(
          and(
            eq(externalEntityMappings.id, mappingId),
            eq(externalEntityMappings.organizationId, organizationId),
            eq(externalEntityMappings.connectionId, connection.id),
            eq(externalEntityMappings.realmId, connection.realmId),
            eq(externalEntityMappings.provider, 'qbo'),
            eq(externalEntityMappings.direction, 'inbound'),
          ),
        )
        .for('update')
        .limit(1);
      if (!mapping) throw new NotFoundException(`QBO mapping ${mappingId} not found`);

      if (
        input.localId !== null &&
        !(await this.localRecordExists(
          transaction,
          mapping.localEntity,
          input.localId,
          organizationId,
        ))
      ) {
        throw new BadRequestException(
          `QBO ${mapping.externalEntity} mappings require a valid ${mapping.localEntity} record in this organization`,
        );
      }

      const [updated] = await transaction
        .update(externalEntityMappings)
        .set({
          localId: input.localId,
          autoCreated: input.autoCreated ?? mapping.autoCreated,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(externalEntityMappings.id, mappingId),
            eq(externalEntityMappings.organizationId, organizationId),
            eq(externalEntityMappings.connectionId, connection.id),
            eq(externalEntityMappings.realmId, connection.realmId),
            eq(externalEntityMappings.provider, 'qbo'),
            eq(externalEntityMappings.direction, 'inbound'),
          ),
        )
        .returning();
      if (!updated) throw new NotFoundException(`QBO mapping ${mappingId} not found`);

      await this.auditMappingMutation(transaction, {
        organizationId,
        userId: userId ?? null,
        mappingId,
        action: input.localId === null ? 'unlinked' : 'linked',
        changes: {
          localId: { from: mapping.localId, to: input.localId },
          autoCreated: {
            from: mapping.autoCreated,
            to: input.autoCreated ?? mapping.autoCreated,
          },
        },
        source: 'user',
      });

      return updated;
    });
  }

  async syncNow(
    organizationId: string,
    entityTypes: readonly QboSyncEntity[] = [...QBO_CATALOG_ENTITY_TYPES, ...QBO_TAX_ENTITY_TYPES],
  ): Promise<QboSyncResult> {
    return this.withOrganizationLock(organizationId, async (assertLock) => {
      await assertLock();
      const connection = await this.activeConnection(organizationId);
      if (!connection) throw new ServiceUnavailableException('QBO is not connected');

      const requested = new Set(entityTypes);
      let imported = 0;
      let tombstones = 0;
      for (const entityName of QBO_CATALOG_ENTITY_TYPES) {
        if (!requested.has(entityName)) continue;
        const result = await this.syncCatalogEntity(
          organizationId,
          connection.id,
          connection.realmId,
          entityName,
          assertLock,
        );
        imported += result.imported;
        tombstones += result.tombstones;
      }

      // TaxCode and TaxRate are deliberately polled through the normal query
      // endpoint. Intuit excludes them from CDC notifications.
      for (const entityName of QBO_TAX_ENTITY_TYPES) {
        if (!requested.has(entityName)) continue;
        const result = await this.syncCatalogEntity(
          organizationId,
          connection.id,
          connection.realmId,
          entityName,
          assertLock,
        );
        imported += result.imported;
        tombstones += result.tombstones;
      }

      await assertLock();
      const completedAt = await this.completeConnectionSync(
        connection.id,
        organizationId,
        connection.realmId,
        assertLock,
      );

      return {
        organizationId,
        imported,
        tombstones,
        completedAt: completedAt.toISOString(),
      };
    });
  }

  async runCdcSweep(
    organizationId: string,
    lookbackDays = MAX_LOOKBACK_DAYS,
    expectedConnection?: { id: string; realmId: string },
  ): Promise<QboSyncResult> {
    return this.withOrganizationLock(organizationId, async (assertLock) => {
      await assertLock();
      const connection = await this.activeConnection(organizationId);
      if (!connection) throw new ServiceUnavailableException('QBO is not connected');
      if (
        expectedConnection &&
        (connection.id !== expectedConnection.id ||
          connection.realmId !== expectedConnection.realmId)
      ) {
        return {
          organizationId,
          imported: 0,
          tombstones: 0,
          completedAt: new Date().toISOString(),
        };
      }

      const boundedLookback = Math.min(Math.max(1, Math.floor(lookbackDays)), MAX_LOOKBACK_DAYS);
      const changedSince = new Date(Date.now() - boundedLookback * 24 * 60 * 60 * 1000);
      let imported = 0;
      let tombstones = 0;
      const incompleteTransactionEntities: string[] = [];

      for (const entityName of CDC_ENTITY_TYPES) {
        await assertLock();
        const response = await this.qboClient.request<QboObject>({
          organizationId,
          method: 'GET',
          path: 'cdc',
          query: {
            entities: entityName,
            changedSince: changedSince.toISOString(),
          },
        });
        const entries = extractCdcEntries(response.data);
        if (entries.length >= CDC_RESPONSE_LIMIT && isCatalogEntity(entityName)) {
          const result = await this.syncCatalogEntity(
            organizationId,
            connection.id,
            connection.realmId,
            entityName,
            assertLock,
          );
          imported += result.imported;
          tombstones += result.tombstones;
          continue;
        }
        if (entries.length >= CDC_RESPONSE_LIMIT) {
          incompleteTransactionEntities.push(entityName);
        }

        for (const entry of entries) {
          if (isTaxEntity(entry.entityName)) continue;

          if (entry.deleted) {
            if (isSupportedCdcEntity(entry.entityName) && entry.entity.Id) {
              await this.upsertMapping(
                {
                  organizationId,
                  connectionId: connection.id,
                  realmId: connection.realmId,
                  entityName: entry.entityName,
                  entity: entry.entity,
                  providerUpdatedAt: qboEntityUpdatedAt(entry.entity),
                  deleted: true,
                  auditSource: 'cdc',
                },
                assertLock,
              );
              tombstones += 1;
            }
            continue;
          }

          if (isCatalogEntity(entry.entityName)) {
            const definition = ENTITY_DEFINITIONS[entry.entityName];
            if (definition.shouldStore?.(entry.entity) === false) {
              await this.deactivateFilteredCatalogMapping(
                organizationId,
                connection.id,
                connection.realmId,
                entry.entityName,
                entry.entity,
                qboEntityUpdatedAt(entry.entity),
                'cdc',
                assertLock,
              );
              continue;
            }
            if (entry.entity.Id) {
              await this.upsertMapping(
                {
                  organizationId,
                  connectionId: connection.id,
                  realmId: connection.realmId,
                  entityName: entry.entityName,
                  entity: entry.entity,
                  providerUpdatedAt: qboEntityUpdatedAt(entry.entity),
                  deleted: false,
                  auditSource: 'cdc',
                },
                assertLock,
              );
              imported += 1;
            }
          }
        }
      }

      if (incompleteTransactionEntities.length > 0) {
        throw new ServiceUnavailableException(
          `QBO CDC response reached ${CDC_RESPONSE_LIMIT} objects for ${incompleteTransactionEntities.join(', ')}; sync state was not advanced`,
        );
      }

      await assertLock();
      const completedAt = await this.completeConnectionSync(
        connection.id,
        organizationId,
        connection.realmId,
        assertLock,
      );

      return {
        organizationId,
        imported,
        tombstones,
        completedAt: completedAt.toISOString(),
      };
    });
  }

  async reconcileCatalogWebhook(
    organizationId: string,
    connectionId: string,
    realmId: string,
    entityName: QboSyncEntity,
  ): Promise<void> {
    await this.withOrganizationLock(organizationId, async (assertLock) => {
      await assertLock();
      const connection = await this.activeConnection(organizationId);
      if (!connection || connection.id !== connectionId || connection.realmId !== realmId) {
        return;
      }
      await this.syncCatalogEntity(organizationId, connectionId, realmId, entityName, assertLock);
    });
  }

  async runCdcRecovery(
    organizationId: string,
    connectionId: string,
    realmId: string,
    lookbackDays = MAX_LOOKBACK_DAYS,
  ): Promise<QboSyncResult> {
    return this.runCdcSweep(organizationId, lookbackDays, { id: connectionId, realmId });
  }

  async processVendorMergeRecovery(input: {
    organizationId: string;
    connectionId: string;
    realmId: string;
    sourceId: string;
    targetId: string;
  }): Promise<void> {
    if (input.sourceId === input.targetId) {
      throw new BadRequestException(
        'QBO Vendor Merge recovery requires distinct source and target IDs',
      );
    }

    await this.withOrganizationLock(input.organizationId, async (assertLock) => {
      await assertLock();
      const connection = await this.activeConnection(input.organizationId);
      if (
        !connection ||
        connection.id !== input.connectionId ||
        connection.realmId !== input.realmId
      ) {
        return;
      }

      const event: QboWebhookEvent = {
        realmId: input.realmId,
        entityName: 'Vendor',
        entityId: input.targetId,
        operation: 'merge',
        payload: { deletedId: input.sourceId },
      };
      const providerUpdatedAt = await this.fetchVendorMergeTimestamp(
        input.organizationId,
        event,
        assertLock,
      );
      if (!providerUpdatedAt) {
        throw new ServiceUnavailableException(
          `QBO Vendor Merge recovery for ${input.sourceId} -> ${input.targetId} has no authoritative target timestamp`,
        );
      }
      await this.handleVendorMerge(
        input.organizationId,
        input.connectionId,
        input.realmId,
        event,
        providerUpdatedAt,
        assertLock,
      );
    });
  }

  async receiveWebhook(rawBody: Buffer, signature: string | undefined) {
    const verifierToken = process.env.QBO_WEBHOOK_VERIFIER_TOKEN ?? process.env.QBO_WEBHOOK_SECRET;
    if (!verifierToken) {
      throw new ServiceUnavailableException('QBO webhook verification is not configured');
    }
    if (!signature || !verifyQboWebhookSignature(rawBody, signature, verifierToken)) {
      throw new UnauthorizedException('Invalid QBO webhook signature');
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as unknown;
    } catch {
      throw new BadRequestException('QBO webhook body must be valid JSON');
    }

    const events = parseQboWebhookEvents(payload);
    const fingerprint = createHash('sha256').update(rawBody).digest('hex');
    await Promise.all(
      events.map((event, index) =>
        this.cdcQueue.add(
          'webhook',
          { kind: 'webhook', event },
          {
            attempts: 5,
            backoff: { type: 'exponential', delay: 1_000 },
            jobId: `qbo-webhook-${fingerprint}-${index}`,
            removeOnComplete: true,
            removeOnFail: 100,
          },
        ),
      ),
    );

    return { accepted: true, queued: events.length } as const;
  }

  async processWebhookEvent(event: QboWebhookEvent): Promise<void> {
    const connections = await this.connectionsForRealm(event.realmId);
    await Promise.all(
      connections.map((connection) =>
        this.withOrganizationLock(connection.organizationId, async (assertLock) => {
          await this.processWebhookEventForConnection(connection, event, assertLock);
        }),
      ),
    );
  }

  private async processWebhookEventForConnection(
    connection: { id: string; organizationId: string; realmId: string },
    event: QboWebhookEvent,
    assertLock: OAuthLockGuard,
  ): Promise<void> {
    await assertLock();
    // The webhook envelope is not the only place QBO puts its version. CloudEvents
    // and delete notifications can carry the provider timestamp in their payload,
    // while a fetched resource can provide MetaData.LastUpdatedTime below.
    const envelopeProviderUpdatedAt = latestQboTimestamp(
      parseQboTimestamp(event.lastUpdated),
      qboEntityUpdatedAt(event.payload),
    );
    if (event.operation === 'merge' && event.entityName === 'Vendor') {
      const { sourceId, targetId } = vendorMergeIds(event);
      if (!isValidVendorMergeIds(sourceId, targetId)) {
        await this.recordUnrecoverableVendorMerge(connection, event, assertLock);
        return;
      }
      const providerUpdatedAt =
        envelopeProviderUpdatedAt ??
        (await this.fetchVendorMergeTimestamp(connection.organizationId, event, assertLock));
      if (!providerUpdatedAt) {
        await this.enqueueVendorMergeRecovery(connection, event);
        return;
      }
      await this.handleVendorMerge(
        connection.organizationId,
        connection.id,
        connection.realmId,
        event,
        providerUpdatedAt,
        assertLock,
      );
      return;
    }

    let providerUpdatedAt = envelopeProviderUpdatedAt;

    if (!isSupportedWebhookEntity(event.entityName)) return;

    if (event.operation === 'delete') {
      if (!providerUpdatedAt) {
        await this.reconcileUnversionedWebhook(connection, event);
        return;
      }
      await this.upsertMapping(
        {
          organizationId: connection.organizationId,
          connectionId: connection.id,
          realmId: connection.realmId,
          entityName: event.entityName,
          entity: { ...event.payload, Id: event.entityId },
          providerUpdatedAt,
          deleted: true,
          auditSource: 'webhook',
        },
        assertLock,
      );
      return;
    }

    await assertLock();
    let response: { data: QboObject };
    try {
      response = await this.qboClient.request<QboObject>({
        organizationId: connection.organizationId,
        method: 'GET',
        path: `${event.entityName.toLowerCase()}/${encodeURIComponent(event.entityId)}`,
      });
    } catch (error: unknown) {
      if (!(error instanceof QboResourceNotFoundError)) throw error;
      if (!providerUpdatedAt) {
        await this.reconcileUnversionedWebhook(connection, event);
        return;
      }
      await this.upsertMapping(
        {
          organizationId: connection.organizationId,
          connectionId: connection.id,
          realmId: connection.realmId,
          entityName: event.entityName,
          entity: { Id: event.entityId },
          providerUpdatedAt,
          deleted: true,
          auditSource: 'webhook',
        },
        assertLock,
      );
      return;
    }
    const entity = extractResourceEntity(response.data, event.entityName);
    if (!entity) {
      if (!providerUpdatedAt) {
        await this.reconcileUnversionedWebhook(connection, event);
        return;
      }
      await this.upsertMapping(
        {
          organizationId: connection.organizationId,
          connectionId: connection.id,
          realmId: connection.realmId,
          entityName: event.entityName,
          entity: { Id: event.entityId },
          providerUpdatedAt,
          deleted: true,
          auditSource: 'webhook',
        },
        assertLock,
      );
      return;
    }
    // A valid resource snapshot is authoritative for create/update events and
    // can repair a missing or malformed envelope timestamp.
    providerUpdatedAt = latestQboTimestamp(providerUpdatedAt, qboEntityUpdatedAt(entity));
    if (!providerUpdatedAt) {
      await this.reconcileUnversionedWebhook(connection, event);
      return;
    }
    const definition = isSyncEntity(event.entityName)
      ? ENTITY_DEFINITIONS[event.entityName]
      : undefined;
    if (isCatalogEntity(event.entityName) && definition?.shouldStore?.(entity) === false) {
      await this.deactivateFilteredCatalogMapping(
        connection.organizationId,
        connection.id,
        connection.realmId,
        event.entityName,
        entity,
        providerUpdatedAt,
        'webhook',
        assertLock,
      );
      return;
    }
    await this.upsertMapping(
      {
        organizationId: connection.organizationId,
        connectionId: connection.id,
        realmId: connection.realmId,
        entityName: event.entityName,
        entity,
        providerUpdatedAt,
        deleted: false,
        auditSource: 'webhook',
      },
      assertLock,
    );
  }

  /**
   * Missing provider versions are queued for a durable reconciliation job. The
   * webhook worker acknowledges that job after enqueueing instead of guessing
   * a processing-time version or retrying the event once per delivery attempt.
   */
  private async reconcileUnversionedWebhook(
    connection: { id: string; organizationId: string; realmId: string },
    event: QboWebhookEvent,
  ): Promise<void> {
    if (isSyncEntity(event.entityName)) {
      await this.enqueueCatalogReconciliation(connection, event.entityName);
      return;
    }
    await this.enqueueCdcRecovery(connection);
  }

  /**
   * A merge has no resource GET for its source. Use the target's current QBO
   * metadata as the authoritative version when possible.
   */
  private async fetchVendorMergeTimestamp(
    organizationId: string,
    event: QboWebhookEvent,
    assertLock: OAuthLockGuard,
  ): Promise<Date | undefined> {
    const { targetId } = vendorMergeIds(event);
    if (!targetId) return undefined;

    await assertLock();
    try {
      const response = await this.qboClient.request<QboObject>({
        organizationId,
        method: 'GET',
        path: `vendor/${encodeURIComponent(targetId)}`,
      });
      const target = extractResourceEntity(response.data, 'Vendor');
      return target ? qboEntityUpdatedAt(target) : undefined;
    } catch (error: unknown) {
      if (error instanceof QboResourceNotFoundError) return undefined;
      throw error;
    }
  }

  private async scheduleOrganization(organizationId: string): Promise<void> {
    await this.oauthRedis.withLock(`qbo-sync:${organizationId}`, async (assertLock) => {
      await assertLock();
      if (!(await this.activeConnection(organizationId))) return;

      const syncJobId = `qbo-hourly-sync-${organizationId}`;
      await this.syncQueue.add(
        'scheduled-sync',
        { kind: 'scheduled', organizationId },
        {
          jobId: syncJobId,
          // A stable repeat key makes BullMQ update the schedule when the interval changes.
          repeat: { every: readSyncInterval(), key: syncJobId },
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );

      await assertLock();
      const cdcJobId = `qbo-daily-cdc-${organizationId}`;
      await this.cdcQueue.add(
        'daily-cdc-sweep',
        { kind: 'cdc-sweep', organizationId, lookbackDays: MAX_LOOKBACK_DAYS },
        {
          jobId: cdcJobId,
          // Keep the CDC schedule identity independent of its cron expression.
          repeat: { pattern: process.env.QBO_CDC_CRON ?? '0 2 * * *', key: cdcJobId },
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );
    });
  }

  private async activeConnection(organizationId: string) {
    return this.db.query.integrationConnections.findFirst({
      where: (connection, { and, eq }) =>
        and(
          eq(connection.organizationId, organizationId),
          eq(connection.provider, 'qbo'),
          eq(connection.status, 'active'),
        ),
    });
  }

  /** Lock the connection row while checking its realm so stale sync data cannot be persisted after a reconnect. */
  private async lockCurrentQboConnection(
    transaction: DbTransaction,
    connectionId: string,
    organizationId: string,
    realmId: string,
  ): Promise<boolean> {
    const rows = await transaction
      .select({ id: integrationConnections.id })
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.id, connectionId),
          eq(integrationConnections.organizationId, organizationId),
          eq(integrationConnections.provider, 'qbo'),
          eq(integrationConnections.realmId, realmId),
          eq(integrationConnections.status, 'active'),
        ),
      )
      .for('update')
      .limit(1);
    return rows.length > 0;
  }

  private async localRecordExists(
    transaction: DbTransaction,
    localEntity: string,
    localId: string,
    organizationId: string,
  ): Promise<boolean> {
    switch (localEntity) {
      case 'gl_account':
        throw new BadRequestException(
          'QBO Account links are not supported until the local chart of accounts is available',
        );
      case 'vendor':
        return Boolean(
          (
            await transaction
              .select({ id: vendors.id })
              .from(vendors)
              .where(and(eq(vendors.id, localId), eq(vendors.organizationId, organizationId)))
              .for('update')
              .limit(1)
          )[0],
        );
      case 'department':
        return Boolean(
          (
            await transaction
              .select({ id: departments.id })
              .from(departments)
              .where(
                and(eq(departments.id, localId), eq(departments.organizationId, organizationId)),
              )
              .for('update')
              .limit(1)
          )[0],
        );
      case 'project':
        return Boolean(
          (
            await transaction
              .select({ id: projects.id })
              .from(projects)
              .where(and(eq(projects.id, localId), eq(projects.organizationId, organizationId)))
              .for('update')
              .limit(1)
          )[0],
        );
      case 'tax_code':
        return Boolean(
          (
            await transaction
              .select({ id: taxCodes.id })
              .from(taxCodes)
              .where(and(eq(taxCodes.id, localId), eq(taxCodes.orgId, organizationId)))
              .for('update')
              .limit(1)
          )[0],
        );
      case 'payment_term':
      case 'tax_rate':
      case 'qbo_transaction':
        throw new BadRequestException(
          `QBO ${localEntity} links are not supported by the current local data model`,
        );
      default:
        throw new BadRequestException(`Unsupported QBO local entity ${localEntity}`);
    }
  }

  private async existingQueueJob(
    queue: Queue<QboSyncJobData> | Queue<QboCdcJobData>,
    jobId: string,
  ): Promise<{ id: string | undefined } | null> {
    const existing = await queue.getJob(jobId);
    if (!existing) return null;
    if ((await existing.getState()) === 'failed') {
      await existing.remove();
      return null;
    }
    return { id: existing.id };
  }

  private async existingDurableQueueJob(
    queue: Queue<QboSyncJobData> | Queue<QboCdcJobData>,
    jobId: string,
  ): Promise<{ id: string | undefined } | null> {
    const existing = await queue.getJob(jobId);
    if (!existing) return null;
    return { id: existing.id };
  }

  private async withOrganizationLock<T>(
    organizationId: string,
    callback: (assertLock: OAuthLockGuard) => Promise<T>,
  ): Promise<T> {
    return this.oauthRedis.withLock(`qbo-sync:${organizationId}`, callback);
  }

  private async connectionsForRealm(realmId: string) {
    return this.db.query.integrationConnections.findMany({
      where: (connection, { and, eq }) =>
        and(
          eq(connection.realmId, realmId),
          eq(connection.provider, 'qbo'),
          eq(connection.status, 'active'),
        ),
    });
  }

  private async completeConnectionSync(
    connectionId: string,
    organizationId: string,
    realmId: string,
    assertLock: OAuthLockGuard,
  ): Promise<Date> {
    const completedAt = new Date();
    await assertLock();
    await this.db.transaction(async (transaction) => {
      await assertLock();
      if (
        !(await this.lockCurrentQboConnection(transaction, connectionId, organizationId, realmId))
      ) {
        throw new ServiceUnavailableException('QBO connection changed during sync');
      }
      await assertLock();
      const [updated] = await transaction
        .update(integrationConnections)
        .set({ lastSyncAt: completedAt, updatedAt: completedAt })
        .where(
          and(
            eq(integrationConnections.id, connectionId),
            eq(integrationConnections.organizationId, organizationId),
            eq(integrationConnections.provider, 'qbo'),
            eq(integrationConnections.realmId, realmId),
            eq(integrationConnections.status, 'active'),
          ),
        )
        .returning({ id: integrationConnections.id });
      if (!updated) return;

      await assertLock();
      await appendAuditLog(transaction, {
        organizationId,
        userId: null,
        entityType: 'integration_connection',
        entityId: connectionId,
        action: 'sync_completed',
        changes: { lastSyncAt: completedAt.toISOString() },
        metadata: { actor: 'system', provider: 'qbo', source: 'sync' },
      });
    });
    return completedAt;
  }

  private async syncCatalogEntity(
    organizationId: string,
    connectionId: string,
    realmId: string,
    entityName: QboSyncEntity,
    assertLock: OAuthLockGuard,
  ): Promise<{ imported: number; tombstones: number }> {
    const definition = ENTITY_DEFINITIONS[entityName];
    const rows = await this.queryEntity(
      organizationId,
      entityName,
      QBO_ACTIVE_ENTITY_TYPES.has(entityName) ? 'Active IN (true, false)' : undefined,
      assertLock,
    );
    let imported = 0;
    const snapshotIds = new Set<string>();
    for (const entity of rows) {
      const externalId = stringValue(entity.Id);
      if (!externalId) continue;
      snapshotIds.add(externalId);
      if (definition.shouldStore?.(entity) === false) {
        await assertLock();
        await this.deactivateFilteredCatalogMapping(
          organizationId,
          connectionId,
          realmId,
          entityName,
          entity,
          qboEntityUpdatedAt(entity),
          'snapshot',
          assertLock,
        );
        continue;
      }
      await this.upsertMapping(
        {
          organizationId,
          connectionId,
          realmId,
          entityName,
          entity,
          providerUpdatedAt: qboEntityUpdatedAt(entity),
          deleted: false,
          auditSource: 'snapshot',
        },
        assertLock,
      );
      imported += 1;
    }
    const tombstones = await this.reconcileCatalogEntity(
      organizationId,
      connectionId,
      realmId,
      entityName,
      snapshotIds,
      assertLock,
    );
    return { imported, tombstones };
  }

  /**
   * Keeps a previously imported row out of the selectable catalog when it no
   * longer matches our supported subset, without misreporting it as deleted.
   */
  private async deactivateFilteredCatalogMapping(
    organizationId: string,
    connectionId: string,
    realmId: string,
    entityName: QboSyncEntity,
    entity: QboObject,
    providerUpdatedAt: Date | undefined,
    auditSource: 'snapshot' | 'cdc' | 'webhook',
    assertLock: OAuthLockGuard,
  ): Promise<void> {
    const externalId = stringValue(entity.Id);
    if (!externalId) return;

    await assertLock();
    await this.db.transaction(async (transaction) => {
      await assertLock();
      if (
        !(await this.lockCurrentQboConnection(transaction, connectionId, organizationId, realmId))
      ) {
        return;
      }
      const existing = await transaction.query.externalEntityMappings.findFirst({
        where: (mapping, { and, eq }) =>
          and(
            eq(mapping.organizationId, organizationId),
            eq(mapping.connectionId, connectionId),
            eq(mapping.realmId, realmId),
            eq(mapping.provider, 'qbo'),
            eq(mapping.direction, 'inbound'),
            eq(mapping.externalEntity, entityName),
            eq(mapping.externalId, externalId),
            eq(mapping.isDeleted, false),
          ),
        columns: {
          id: true,
          connectionId: true,
          displayName: true,
          syncToken: true,
          isActive: true,
          payload: true,
          syncedAt: true,
        },
      });
      if (!existing) return;

      const now = new Date();
      if (
        providerUpdatedAt &&
        existing.syncedAt &&
        providerUpdatedAt.getTime() <= existing.syncedAt.getTime()
      ) {
        return;
      }
      const displayName = ENTITY_DEFINITIONS[entityName].displayName(entity);
      const syncToken = stringValue(entity.SyncToken);
      await assertLock();
      const [updated] = await transaction
        .update(externalEntityMappings)
        .set({
          connectionId,
          realmId,
          displayName,
          syncToken,
          isActive: false,
          isDeleted: false,
          payload: entity,
          syncedAt: providerUpdatedAt ?? now,
          updatedAt: now,
        })
        .where(
          and(
            eq(externalEntityMappings.id, existing.id),
            eq(externalEntityMappings.organizationId, organizationId),
            eq(externalEntityMappings.connectionId, connectionId),
            eq(externalEntityMappings.realmId, realmId),
            eq(externalEntityMappings.provider, 'qbo'),
            eq(externalEntityMappings.direction, 'inbound'),
            eq(externalEntityMappings.isDeleted, false),
          ),
        )
        .returning({ id: externalEntityMappings.id });
      if (!updated) return;

      if (
        existing.connectionId !== connectionId ||
        existing.displayName !== displayName ||
        existing.syncToken !== syncToken ||
        existing.isActive ||
        !isDeepStrictEqual(existing.payload, entity)
      ) {
        await assertLock();
        await this.auditMappingMutation(transaction, {
          organizationId,
          userId: null,
          mappingId: updated.id,
          action: 'deactivated',
          changes: {
            externalEntity: entityName,
            externalId,
            isActive: { from: existing.isActive, to: false },
          },
          source: auditSource,
          reason: 'outside_supported_catalog',
        });
      }
    });
  }

  private async queryEntity(
    organizationId: string,
    entityName: QboSyncEntity | string,
    where?: string,
    assertLock?: OAuthLockGuard,
  ): Promise<QboObject[]> {
    const rows: QboObject[] = [];
    let startPosition = 1;

    while (true) {
      if (assertLock) await assertLock();
      const query = [
        `SELECT * FROM ${entityName}`,
        where ? `WHERE ${where}` : null,
        `STARTPOSITION ${startPosition}`,
        `MAXRESULTS ${QUERY_PAGE_SIZE}`,
      ]
        .filter((part): part is string => part !== null)
        .join(' ');
      const response = await this.qboClient.request<QboObject>({
        organizationId,
        method: 'GET',
        path: 'query',
        query: { query },
      });
      const page = extractQueryRows(response.data, entityName);
      rows.push(...page);
      if (page.length < QUERY_PAGE_SIZE) break;
      startPosition += page.length;
    }
    return rows;
  }

  private async reconcileCatalogEntity(
    organizationId: string,
    connectionId: string,
    realmId: string,
    entityName: QboSyncEntity,
    snapshotIds: ReadonlySet<string>,
    assertLock: OAuthLockGuard,
  ): Promise<number> {
    await assertLock();
    return this.db.transaction(async (transaction) => {
      await assertLock();
      if (
        !(await this.lockCurrentQboConnection(transaction, connectionId, organizationId, realmId))
      ) {
        return 0;
      }
      let tombstones = 0;
      const existing = await transaction.query.externalEntityMappings.findMany({
        where: (mapping, { and, eq }) =>
          and(
            eq(mapping.organizationId, organizationId),
            eq(mapping.connectionId, connectionId),
            eq(mapping.realmId, realmId),
            eq(mapping.provider, 'qbo'),
            eq(mapping.direction, 'inbound'),
            eq(mapping.externalEntity, entityName),
            eq(mapping.isDeleted, false),
          ),
        columns: { id: true, externalId: true, isActive: true },
      });

      for (const mapping of existing) {
        if (snapshotIds.has(mapping.externalId)) continue;
        await assertLock();
        const [updated] = await transaction
          .update(externalEntityMappings)
          .set({ isActive: false, isDeleted: true, updatedAt: new Date() })
          .where(
            and(
              eq(externalEntityMappings.id, mapping.id),
              eq(externalEntityMappings.organizationId, organizationId),
              eq(externalEntityMappings.connectionId, connectionId),
              eq(externalEntityMappings.realmId, realmId),
              eq(externalEntityMappings.provider, 'qbo'),
              eq(externalEntityMappings.direction, 'inbound'),
              eq(externalEntityMappings.isDeleted, false),
            ),
          )
          .returning({ id: externalEntityMappings.id });
        if (!updated) continue;
        tombstones += 1;

        await assertLock();
        await this.auditMappingMutation(transaction, {
          organizationId,
          userId: null,
          mappingId: updated.id,
          action: 'deleted',
          changes: { isActive: { from: mapping.isActive, to: false }, isDeleted: true },
          source: 'snapshot',
          reason: 'missing_from_snapshot',
        });
      }
      return tombstones;
    });
  }

  private async upsertMapping(input: MappingUpsert, assertLock: OAuthLockGuard): Promise<void> {
    await assertLock();
    await this.db.transaction(async (transaction) => {
      await this.upsertMappingInTransaction(transaction, input, assertLock);
    });
  }

  private async upsertMappingInTransaction(
    transaction: DbTransaction,
    input: MappingUpsert,
    assertLock?: OAuthLockGuard,
  ): Promise<string | undefined> {
    const {
      organizationId,
      connectionId,
      entityName,
      entity,
      deleted,
      mergedIntoExternalId,
      providerUpdatedAt,
    } = input;
    const externalId = stringValue(entity.Id);
    if (!externalId) return undefined;
    if (assertLock) await assertLock();
    if (
      !(await this.lockCurrentQboConnection(
        transaction,
        connectionId,
        organizationId,
        input.realmId,
      ))
    ) {
      return undefined;
    }
    const definition = isSyncEntity(entityName) ? ENTITY_DEFINITIONS[entityName] : undefined;
    const existing = await transaction.query.externalEntityMappings.findFirst({
      where: (mapping, { and, eq }) =>
        and(
          eq(mapping.organizationId, organizationId),
          eq(mapping.connectionId, connectionId),
          eq(mapping.realmId, input.realmId),
          eq(mapping.provider, 'qbo'),
          eq(mapping.direction, 'inbound'),
          eq(mapping.externalEntity, entityName),
          eq(mapping.externalId, externalId),
        ),
      columns: {
        id: true,
        connectionId: true,
        displayName: true,
        syncToken: true,
        isActive: true,
        isDeleted: true,
        mergedIntoExternalId: true,
        payload: true,
        localId: true,
        autoCreated: true,
        syncedAt: true,
      },
    });
    const connectionChanged = existing != null && existing.connectionId !== connectionId;
    if (input.connectionScoped && connectionChanged) return undefined;
    if (
      !connectionChanged &&
      existing?.syncedAt &&
      providerUpdatedAt &&
      providerUpdatedAt.getTime() <= existing.syncedAt.getTime()
    ) {
      return existing.id;
    }
    const existingLocalId = existing?.localId ?? null;
    const existingAutoCreated = existing?.autoCreated ?? false;
    const now = new Date();
    const existingDelete = deleted && existing ? existing : null;
    const values = {
      organizationId,
      connectionId,
      realmId: input.realmId,
      provider: 'qbo',
      externalEntity: entityName,
      externalId,
      displayName: existingDelete
        ? existingDelete.displayName
        : (definition?.displayName(entity) ?? displayNameFromQbo(entity)),
      syncToken: existingDelete ? existingDelete.syncToken : stringValue(entity.SyncToken),
      localEntity: definition?.localEntity ?? 'qbo_transaction',
      localId: connectionChanged ? null : (input.localId ?? existingLocalId),
      direction: 'inbound' as const,
      autoCreated: connectionChanged ? false : (input.autoCreated ?? existingAutoCreated),
      isActive: !deleted && entity.Active !== false,
      isDeleted: deleted,
      mergedIntoExternalId: existingDelete
        ? existingDelete.mergedIntoExternalId
        : (mergedIntoExternalId ?? null),
      payload: existingDelete ? existingDelete.payload : entity,
      syncedAt: providerUpdatedAt ?? now,
      updatedAt: now,
    };

    if (assertLock) await assertLock();
    const [mapping] = await transaction
      .insert(externalEntityMappings)
      .values(values)
      .onConflictDoUpdate({
        target: [
          externalEntityMappings.organizationId,
          externalEntityMappings.provider,
          externalEntityMappings.direction,
          externalEntityMappings.externalEntity,
          externalEntityMappings.externalId,
          externalEntityMappings.realmId,
        ],
        set: {
          connectionId: values.connectionId,
          realmId: values.realmId,
          displayName: values.displayName,
          syncToken: values.syncToken,
          isActive: values.isActive,
          isDeleted: values.isDeleted,
          mergedIntoExternalId: values.mergedIntoExternalId,
          payload: values.payload,
          ...(connectionChanged || input.localId !== undefined || input.autoCreated !== undefined
            ? { localId: values.localId, autoCreated: values.autoCreated }
            : {}),
          syncedAt: values.syncedAt,
          updatedAt: values.updatedAt,
        },
      })
      .returning({ id: externalEntityMappings.id });
    if (!mapping) return undefined;

    if (
      !existing ||
      existing.connectionId !== values.connectionId ||
      existing.displayName !== values.displayName ||
      existing.syncToken !== values.syncToken ||
      existing.isActive !== values.isActive ||
      existing.isDeleted !== values.isDeleted ||
      existing.mergedIntoExternalId !== values.mergedIntoExternalId ||
      existingLocalId !== values.localId ||
      existingAutoCreated !== values.autoCreated ||
      !isDeepStrictEqual(existing.payload, values.payload)
    ) {
      if (assertLock) await assertLock();
      await this.auditMappingMutation(transaction, {
        organizationId,
        userId: null,
        mappingId: mapping.id,
        action: deleted ? 'deleted' : 'synced',
        changes: {
          externalEntity: entityName,
          externalId,
          isActive: values.isActive,
          isDeleted: values.isDeleted,
          ...(existing && existingLocalId !== values.localId
            ? { localId: { from: existingLocalId, to: values.localId } }
            : input.localId !== undefined
              ? { localId: input.localId }
              : {}),
          ...(existing && existingAutoCreated !== values.autoCreated
            ? { autoCreated: { from: existingAutoCreated, to: values.autoCreated } }
            : input.autoCreated !== undefined
              ? { autoCreated: input.autoCreated }
              : {}),
        },
        source: input.auditSource ?? 'cdc',
        ...(input.auditReason || mergedIntoExternalId
          ? { reason: input.auditReason ?? 'merged' }
          : {}),
      });
    }
    return mapping.id;
  }

  private async auditMappingMutation(
    transaction: DbTransaction,
    input: {
      organizationId: string;
      userId: string | null;
      mappingId: string;
      action: string;
      changes: Record<string, unknown>;
      source: string;
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
        provider: 'qbo',
        source: input.source,
        ...(input.reason ? { reason: input.reason } : {}),
      },
    });
  }

  private async handleVendorMerge(
    organizationId: string,
    connectionId: string,
    realmId: string,
    event: QboWebhookEvent,
    providerUpdatedAt: Date,
    assertLock: OAuthLockGuard,
  ): Promise<void> {
    const { sourceId, targetId } = vendorMergeIds(event);
    if (!sourceId || !targetId || sourceId === targetId) {
      this.logger.warn(`Ignoring QBO Vendor Merge without distinct source and target IDs`);
      return;
    }

    let sourceIdForNotification: string | undefined;
    await assertLock();
    await this.db.transaction(async (transaction) => {
      await assertLock();
      if (
        !(await this.lockCurrentQboConnection(transaction, connectionId, organizationId, realmId))
      ) {
        return;
      }
      const lockedMappings = new Map<string, (typeof externalEntityMappings)['$inferSelect']>();
      for (const externalId of [sourceId, targetId].sort()) {
        const [mapping] = await transaction
          .select()
          .from(externalEntityMappings)
          .where(
            and(
              eq(externalEntityMappings.organizationId, organizationId),
              eq(externalEntityMappings.connectionId, connectionId),
              eq(externalEntityMappings.realmId, realmId),
              eq(externalEntityMappings.provider, 'qbo'),
              eq(externalEntityMappings.direction, 'inbound'),
              eq(externalEntityMappings.externalEntity, 'Vendor'),
              eq(externalEntityMappings.externalId, externalId),
            ),
          )
          .for('update')
          .limit(1);
        if (mapping) lockedMappings.set(externalId, mapping);
      }
      const source = lockedMappings.get(sourceId);
      const target = lockedMappings.get(targetId);

      if (
        [source, target].some(
          (mapping) => mapping?.syncedAt && providerUpdatedAt <= mapping.syncedAt,
        )
      ) {
        return;
      }

      if (source?.isDeleted && source.mergedIntoExternalId === targetId) {
        sourceIdForNotification = source.id;
        return;
      }

      if (source) {
        await assertLock();
        const [updated] = await transaction
          .update(externalEntityMappings)
          .set({
            isActive: false,
            isDeleted: true,
            mergedIntoExternalId: targetId,
            syncedAt: providerUpdatedAt,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(externalEntityMappings.id, source.id),
              eq(externalEntityMappings.organizationId, organizationId),
              eq(externalEntityMappings.connectionId, connectionId),
              eq(externalEntityMappings.realmId, realmId),
              eq(externalEntityMappings.provider, 'qbo'),
              eq(externalEntityMappings.direction, 'inbound'),
            ),
          )
          .returning({ id: externalEntityMappings.id });
        if (updated) {
          sourceIdForNotification = source.id;
          await assertLock();
          await this.auditMappingMutation(transaction, {
            organizationId,
            userId: null,
            mappingId: updated.id,
            action: 'merged',
            changes: {
              isActive: { from: source.isActive, to: false },
              isDeleted: { from: source.isDeleted, to: true },
              mergedIntoExternalId: { from: source.mergedIntoExternalId, to: targetId },
            },
            source: 'webhook',
            reason: 'vendor_merge',
          });
        }
      } else {
        await assertLock();
        sourceIdForNotification = await this.upsertMappingInTransaction(
          transaction,
          {
            organizationId,
            connectionId,
            realmId,
            entityName: 'Vendor',
            entity: { Id: sourceId, Name: firstString(event.payload, ['Name', 'DisplayName']) },
            providerUpdatedAt,
            deleted: true,
            mergedIntoExternalId: targetId,
            connectionScoped: true,
            auditSource: 'merge',
          },
          assertLock,
        );
      }

      if (source?.localId) {
        if (target && !target.localId) {
          await assertLock();
          const [updated] = await transaction
            .update(externalEntityMappings)
            .set({
              localId: source.localId,
              autoCreated: source.autoCreated,
              syncedAt: providerUpdatedAt,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(externalEntityMappings.id, target.id),
                eq(externalEntityMappings.organizationId, organizationId),
                eq(externalEntityMappings.connectionId, connectionId),
                eq(externalEntityMappings.realmId, realmId),
                eq(externalEntityMappings.provider, 'qbo'),
                eq(externalEntityMappings.direction, 'inbound'),
                isNull(externalEntityMappings.localId),
              ),
            )
            .returning({ id: externalEntityMappings.id });
          if (updated) {
            await assertLock();
            await this.auditMappingMutation(transaction, {
              organizationId,
              userId: null,
              mappingId: updated.id,
              action: 'linked',
              changes: { localId: { from: null, to: source.localId } },
              source: 'merge',
              reason: 'vendor_merge',
            });
          }
        } else if (!target) {
          await assertLock();
          await this.upsertMappingInTransaction(
            transaction,
            {
              organizationId,
              connectionId,
              realmId,
              entityName: 'Vendor',
              entity: { Id: targetId },
              providerUpdatedAt,
              deleted: false,
              localId: source.localId,
              autoCreated: source.autoCreated,
              connectionScoped: true,
              auditSource: 'merge',
              auditReason: 'vendor_merge',
            },
            assertLock,
          );
        }
      }
    });

    if (!sourceIdForNotification) return;
    await assertLock();
    const adminId = await resolveOrganizationAdminId(this.db, organizationId);
    if (adminId) {
      await assertLock();
      await this.notifications.createIdempotent(
        `qbo-vendor-merge:${organizationId}:${sourceId}:${targetId}`,
        organizationId,
        adminId,
        'qbo_vendor_merge',
        'QuickBooks vendor merged',
        `QuickBooks vendor ${sourceId} was merged into ${targetId}. Review the linked vendor mapping.`,
        'external_entity_mapping',
        sourceIdForNotification,
      );
    }
  }
}

export function verifyQboWebhookSignature(
  rawBody: Buffer,
  signature: string,
  verifierToken: string,
): boolean {
  const normalizedSignature = signature.trim().replace(/^sha256=/i, '');
  const expected = createHmac('sha256', verifierToken).update(rawBody).digest('base64');
  const actualBytes = Buffer.from(normalizedSignature, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function readSyncInterval(): number {
  const configured = Number(process.env.QBO_SYNC_INTERVAL_MS);
  if (!Number.isFinite(configured)) return DEFAULT_SYNC_INTERVAL_MS;
  return Math.min(Math.max(Math.floor(configured), 60_000), MAX_SYNC_INTERVAL_MS);
}

function isCatalogEntity(value: string): value is QboCatalogEntity {
  return (QBO_CATALOG_ENTITY_TYPES as readonly string[]).includes(value);
}

function isSyncEntity(value: string): value is QboSyncEntity {
  return isCatalogEntity(value) || isTaxEntity(value);
}

function isTaxEntity(value: string): value is QboTaxEntity {
  return (QBO_TAX_ENTITY_TYPES as readonly string[]).includes(value);
}

function isSupportedCdcEntity(value: string): boolean {
  return (CDC_ENTITY_TYPES as readonly string[]).includes(value);
}

function isSupportedWebhookEntity(value: string): value is QboWebhookEntity {
  return (QBO_WEBHOOK_ENTITY_TYPES as readonly string[]).includes(value);
}

function extractQueryRows(data: unknown, entityName: string): QboObject[] {
  if (!isRecord(data)) return [];
  const queryResponse = isRecord(data.QueryResponse) ? data.QueryResponse : data;
  const rows = queryResponse[entityName];
  return Array.isArray(rows) ? rows.filter(isRecord) : [];
}

function extractResourceEntity(data: unknown, entityName: string): QboObject | null {
  if (!isRecord(data)) return null;
  const resource = data[entityName];
  if (isRecord(resource)) return resource;
  return stringValue(data.Id) ? data : null;
}

function extractCdcEntries(data: unknown): CdcEntry[] {
  if (!isRecord(data)) return [];
  const responseItems = recordList(data.CDCResponse);
  const envelopes = responseItems.length > 0 ? responseItems : [data];
  const entries: CdcEntry[] = [];

  for (const item of envelopes) {
    const queryResponses = recordList(item.QueryResponse);
    const queryEnvelopes = queryResponses.length > 0 ? queryResponses : [item];
    for (const queryResponse of queryEnvelopes) {
      for (const [entityName, rawRows] of Object.entries(queryResponse)) {
        if (!Array.isArray(rawRows)) continue;
        for (const rawRow of rawRows) {
          if (!isRecord(rawRow)) continue;
          if (entityName === 'DeletedObject' || entityName === 'DeletedObjects') {
            const deletedEntity = isRecord(rawRow.DeletedObject)
              ? rawRow.DeletedObject
              : isRecord(rawRow.Deleted)
                ? rawRow.Deleted
                : rawRow;
            const deletedName =
              stringValue(deletedEntity.EntityName) ??
              stringValue(deletedEntity.Entity) ??
              stringValue(deletedEntity.ObjectType) ??
              stringValue(deletedEntity.Name) ??
              stringValue(rawRow.EntityName) ??
              stringValue(rawRow.Entity) ??
              stringValue(rawRow.ObjectType) ??
              stringValue(rawRow.Name);
            if (deletedName) {
              entries.push({ entityName: deletedName, entity: deletedEntity, deleted: true });
            }
          } else {
            entries.push({
              entityName,
              entity: rawRow,
              deleted: hasDeletedStatus(rawRow),
            });
          }
        }
      }
    }
  }
  return entries;
}

function hasDeletedStatus(entity: QboObject): boolean {
  const status = stringValue(entity.status) ?? stringValue(entity.Status);
  return status?.trim().toLowerCase() === 'deleted';
}

function parseQboTimestamp(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function qboEntityUpdatedAt(entity: QboObject): Date | undefined {
  const metadata = isRecord(entity.MetaData) ? entity.MetaData : undefined;
  for (const value of [
    stringValue(metadata?.LastUpdatedTime),
    stringValue(metadata?.lastUpdatedTime),
    stringValue(entity.LastUpdatedTime),
    stringValue(entity.lastUpdatedTime),
    stringValue(entity.DeletedTime),
    stringValue(entity.deletedTime),
    stringValue(entity.LastUpdated),
    stringValue(entity.lastUpdated),
  ]) {
    const parsed = parseQboTimestamp(value);
    if (parsed) return parsed;
  }
  return undefined;
}

function latestQboTimestamp(...timestamps: (Date | undefined)[]): Date | undefined {
  return timestamps.reduce<Date | undefined>((latest, timestamp) => {
    if (!timestamp) return latest;
    if (!latest || timestamp.getTime() > latest.getTime()) return timestamp;
    return latest;
  }, undefined);
}

function qboRecoveryJobId(kind: string, identity: readonly string[]): string {
  const digest = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  return `qbo-${kind}-recovery-${digest}`;
}

function qboStableUuid(...parts: string[]): string {
  const bytes = createHash('sha256').update(parts.join('\0')).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function parseQboWebhookEvents(payload: unknown): QboWebhookEvent[] {
  if (Array.isArray(payload)) {
    return payload.flatMap((event) => parseQboCloudEvent(event));
  }
  if (!isRecord(payload) || !Array.isArray(payload.eventNotifications)) return [];
  const events: QboWebhookEvent[] = [];
  for (const rawNotification of payload.eventNotifications) {
    if (!isRecord(rawNotification)) continue;
    const realmId = stringValue(rawNotification.realmId);
    const dataChangeEvent = rawNotification.dataChangeEvent;
    if (!realmId || !isRecord(dataChangeEvent) || !Array.isArray(dataChangeEvent.entities))
      continue;
    for (const rawEntity of dataChangeEvent.entities) {
      if (!isRecord(rawEntity)) continue;
      const entityName = parseQboWebhookEntity(stringValue(rawEntity.name));
      const entityId = stringValue(rawEntity.id);
      const operation = parseQboWebhookOperation(stringValue(rawEntity.operation));
      if (!entityName || !entityId || !operation) continue;
      const lastUpdated = stringValue(rawEntity.lastUpdated);
      events.push({
        realmId,
        entityName,
        entityId,
        operation,
        ...(lastUpdated ? { lastUpdated } : {}),
        payload: rawEntity,
      });
    }
  }
  return events;
}

function parseQboCloudEvent(value: unknown): QboWebhookEvent[] {
  if (!isRecord(value) || !stringValue(value.specversion)) return [];
  const type = stringValue(value.type);
  const realmId =
    stringValue(value.intuitaccountid) ??
    stringValue(value.intuitAccountId) ??
    stringValue(value.realmId);
  const entityId =
    stringValue(value.intuitentityid) ??
    stringValue(value.intuitEntityId) ??
    stringValue(value.entityId);
  if (!type || !realmId || !entityId) return [];

  const tokens = type.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const entityName = tokens.map(parseQboWebhookEntity).find((entity) => entity !== null) ?? null;
  const operation =
    tokens.map(parseQboWebhookOperation).find((candidate) => candidate !== null) ?? null;
  if (!entityName || !operation) return [];

  const data = isRecord(value.data) ? value.data : {};
  const lastUpdated =
    stringValue(value.time) ?? stringValue(data.lastUpdated) ?? stringValue(data.lastupdated);
  return [
    {
      realmId,
      entityName,
      entityId,
      operation,
      ...(lastUpdated ? { lastUpdated } : {}),
      payload: data,
    },
  ];
}

function parseQboWebhookEntity(value: string | null): QboWebhookEntity | null {
  if (!value) return null;
  const normalized = value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return (
    QBO_WEBHOOK_ENTITY_TYPES.find(
      (entity) => entity.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() === normalized,
    ) ?? null
  );
}

function parseQboWebhookOperation(value: string | null): QboWebhookOperation | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  const canonical = normalized.endsWith('d') ? normalized.slice(0, -1) : normalized;
  return (
    QBO_WEBHOOK_OPERATIONS.find(
      (operation) => operation === normalized || operation === canonical,
    ) ?? null
  );
}

function displayNameFromQbo(entity: QboObject): string | null {
  return (
    stringValue(entity.DisplayName) ??
    stringValue(entity.Name) ??
    stringValue(entity.FullyQualifiedName) ??
    stringValue(entity.Id)
  );
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function firstString(payload: QboObject, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = stringValue(payload[key]);
    if (value) return value;
  }
  return null;
}

function vendorMergeIds(event: QboWebhookEvent): {
  sourceId: string | null;
  targetId: string | null;
} {
  const payloadSourceId = firstString(event.payload, [
    'sourceId',
    'oldId',
    'deletedId',
    'mergedFromId',
    'fromId',
  ]);
  const payloadTargetId = firstString(event.payload, [
    'targetId',
    'newId',
    'mergeTo',
    'mergedIntoId',
    'toId',
  ]);
  return {
    sourceId: payloadSourceId ?? event.entityId,
    targetId: payloadTargetId ?? (payloadSourceId ? event.entityId : null),
  };
}

function isValidVendorMergeIds(sourceId: string | null, targetId: string | null): boolean {
  return (
    sourceId !== null &&
    targetId !== null &&
    sourceId !== targetId &&
    qboExternalIdSchema.safeParse(sourceId).success &&
    qboExternalIdSchema.safeParse(targetId).success
  );
}

function isRecord(value: unknown): value is QboObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordList(value: unknown): QboObject[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  return isRecord(value) ? [value] : [];
}
