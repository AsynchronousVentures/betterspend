import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { and, eq, isNull } from 'drizzle-orm';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  auditLog,
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
  type QboMappingLinkInput,
  type QboSyncEntity,
} from '@betterspend/shared';
import { DB_TOKEN } from '../../../database/database.module';
import { NotificationsService } from '../../notifications/notifications.service';
import { resolveOrganizationAdminId } from '../../../common/demo-identity';
import { QboClientService } from '../../gl/qbo-client.service';
import { OAuthRedisService } from '../../gl/oauth-redis.service';

export type QboCatalogEntity = (typeof QBO_CATALOG_ENTITY_TYPES)[number];
export type QboTaxEntity = (typeof QBO_TAX_ENTITY_TYPES)[number];

const CDC_ENTITY_TYPES = [...QBO_CATALOG_ENTITY_TYPES, ...QBO_TRANSACTION_ENTITY_TYPES] as const;

const QBO_WEBHOOK_ENTITY_TYPES = [
  ...QBO_CATALOG_ENTITY_TYPES,
  ...QBO_TAX_ENTITY_TYPES,
  ...QBO_TRANSACTION_ENTITY_TYPES,
] as const;

const QBO_WEBHOOK_OPERATIONS = ['create', 'update', 'delete', 'merge'] as const;

const QBO_ACCOUNT_TYPES = new Set([
  'Accounts Payable',
  'Cost of Goods Sold',
  'Expense',
  'Other Expense',
]);

const CDC_PAGE_SIZE = 1000;
const QUERY_PAGE_SIZE = 1000;
const DEFAULT_SYNC_INTERVAL_MS = 60 * 60 * 1000;
const MAX_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_LOOKBACK_DAYS = 30;
const QBO_ACTIVE_ENTITY_TYPES = new Set<QboSyncEntity>(QBO_CATALOG_ENTITY_TYPES);

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

export type QboSyncJobData = {
  kind: 'initial' | 'scheduled';
  organizationId: string;
  entityTypes?: readonly QboSyncEntity[];
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
  | { kind: 'cdc-sweep'; organizationId: string; lookbackDays?: number };

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
  entityName: string;
  entity: QboObject;
  deleted: boolean;
  mergedIntoExternalId?: string | null;
  localId?: string | null;
  autoCreated?: boolean;
  auditSource?: 'snapshot' | 'cdc' | 'webhook' | 'merge';
  auditReason?: string;
};

/**
 * Provider-facing QBO import module. Callers only enqueue a sync, list the
 * cached catalog, or link one row. Query paging, CDC envelopes, tombstones,
 * and provider-specific entity names stay behind this interface.
 */
@Injectable()
export class QboInboundService implements OnModuleInit {
  private readonly logger = new Logger(QboInboundService.name);

  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly qboClient: QboClientService,
    private readonly notifications: NotificationsService,
    @InjectQueue('qbo-sync-in') private readonly syncQueue: Queue<QboSyncJobData>,
    @InjectQueue('qbo-cdc') private readonly cdcQueue: Queue<QboCdcJobData>,
    private readonly oauthRedis: OAuthRedisService,
  ) {}

  async onModuleInit(): Promise<void> {
    const connections = await this.db.query.integrationConnections.findMany({
      where: (connection, { and, eq }) =>
        and(eq(connection.provider, 'qbo'), eq(connection.status, 'active')),
      columns: { organizationId: true },
    });

    await Promise.all(
      connections.map(async ({ organizationId }) => {
        await this.scheduleOrganization(organizationId);
      }),
    );
  }

  async enqueueInitialSync(
    organizationId: string,
    entityTypes: readonly QboSyncEntity[] = [...QBO_CATALOG_ENTITY_TYPES, ...QBO_TAX_ENTITY_TYPES],
  ): Promise<{ queued: true; jobId: string | undefined }> {
    const options = {
      attempts: 3,
      backoff: { type: 'exponential' as const, delay: 2_000 },
      jobId: `qbo-initial-sync-${organizationId}`,
      removeOnComplete: true,
      removeOnFail: true,
    };
    const existing = await this.existingQueueJob(this.syncQueue, options.jobId);
    if (existing) return { queued: true, jobId: existing.id };

    const job = await this.syncQueue.add(
      'initial-sync',
      { kind: 'initial', organizationId, entityTypes },
      options,
    );
    return { queued: true, jobId: job.id };
  }

  /**
   * Creates the repeatable jobs for a connected organization. The initial
   * import calls this after its queue worker starts, so a newly connected
   * organization does not wait for an application restart to receive its
   * hourly import and daily CDC sweep.
   */
  async ensureScheduledSync(organizationId: string): Promise<void> {
    if (!(await this.activeConnection(organizationId))) return;
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

  async listMappings(organizationId: string, externalEntity?: string) {
    return this.db.query.externalEntityMappings.findMany({
      where: (mapping, { and, eq }) =>
        and(
          eq(mapping.organizationId, organizationId),
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
      const mapping = await transaction.query.externalEntityMappings.findFirst({
        where: (row, { and, eq }) =>
          and(
            eq(row.id, mappingId),
            eq(row.organizationId, organizationId),
            eq(row.provider, 'qbo'),
            eq(row.direction, 'inbound'),
          ),
      });
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
    return this.withOrganizationLock(organizationId, async () => {
      const connection = await this.activeConnection(organizationId);
      if (!connection) throw new ServiceUnavailableException('QBO is not connected');

      const requested = new Set(entityTypes);
      let imported = 0;
      for (const entityName of QBO_CATALOG_ENTITY_TYPES) {
        if (!requested.has(entityName)) continue;
        imported += await this.syncCatalogEntity(organizationId, connection.id, entityName);
      }

      // TaxCode and TaxRate are deliberately polled through the normal query
      // endpoint. Intuit excludes them from CDC notifications.
      for (const entityName of QBO_TAX_ENTITY_TYPES) {
        if (!requested.has(entityName)) continue;
        imported += await this.syncCatalogEntity(organizationId, connection.id, entityName);
      }

      const completedAt = await this.completeConnectionSync(connection.id, organizationId);

      return {
        organizationId,
        imported,
        tombstones: 0,
        completedAt: completedAt.toISOString(),
      };
    });
  }

  async runCdcSweep(
    organizationId: string,
    lookbackDays = MAX_LOOKBACK_DAYS,
  ): Promise<QboSyncResult> {
    return this.withOrganizationLock(organizationId, async () => {
      const connection = await this.activeConnection(organizationId);
      if (!connection) throw new ServiceUnavailableException('QBO is not connected');

      const boundedLookback = Math.min(Math.max(1, Math.floor(lookbackDays)), MAX_LOOKBACK_DAYS);
      const changedSince = new Date(Date.now() - boundedLookback * 24 * 60 * 60 * 1000);
      let startPosition = 1;
      let imported = 0;
      let tombstones = 0;

      while (true) {
        const response = await this.qboClient.request<QboObject>({
          organizationId,
          method: 'GET',
          path: 'cdc',
          query: {
            entities: CDC_ENTITY_TYPES.join(','),
            changedSince: changedSince.toISOString(),
            startposition: startPosition,
            maxresults: CDC_PAGE_SIZE,
          },
        });
        const entries = extractCdcEntries(response.data);
        for (const entry of entries) {
          if (isTaxEntity(entry.entityName)) continue;

          if (entry.deleted) {
            if (isSupportedCdcEntity(entry.entityName) && entry.entity.Id) {
              await this.upsertMapping({
                organizationId,
                connectionId: connection.id,
                entityName: entry.entityName,
                entity: entry.entity,
                deleted: true,
                auditSource: 'cdc',
              });
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
                entry.entityName,
                entry.entity,
              );
              continue;
            }
            if (entry.entity.Id) {
              await this.upsertMapping({
                organizationId,
                connectionId: connection.id,
                entityName: entry.entityName,
                entity: entry.entity,
                deleted: false,
                auditSource: 'cdc',
              });
              imported += 1;
            }
          }
        }

        if (entries.length < CDC_PAGE_SIZE) break;
        startPosition += entries.length;
      }

      const completedAt = await this.completeConnectionSync(connection.id, organizationId);

      return {
        organizationId,
        imported,
        tombstones,
        completedAt: completedAt.toISOString(),
      };
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
        this.withOrganizationLock(connection.organizationId, async () => {
          await this.processWebhookEventForConnection(connection, event);
        }),
      ),
    );
  }

  private async processWebhookEventForConnection(
    connection: { id: string; organizationId: string },
    event: QboWebhookEvent,
  ): Promise<void> {
    if (event.operation === 'merge' && event.entityName === 'Vendor') {
      await this.handleVendorMerge(connection.organizationId, connection.id, event);
      return;
    }

    if (event.operation === 'delete') {
      await this.upsertMapping({
        organizationId: connection.organizationId,
        connectionId: connection.id,
        entityName: event.entityName,
        entity: { ...event.payload, Id: event.entityId },
        deleted: true,
        auditSource: 'webhook',
      });
      return;
    }

    if (!isCatalogEntity(event.entityName) || isTaxEntity(event.entityName)) return;
    const response = await this.qboClient.request<QboObject>({
      organizationId: connection.organizationId,
      method: 'GET',
      path: `${event.entityName.toLowerCase()}/${encodeURIComponent(event.entityId)}`,
    });
    const entity = extractResourceEntity(response.data, event.entityName);
    if (!entity) {
      await this.upsertMapping({
        organizationId: connection.organizationId,
        connectionId: connection.id,
        entityName: event.entityName,
        entity: { Id: event.entityId },
        deleted: true,
        auditSource: 'webhook',
      });
      return;
    }
    const definition = ENTITY_DEFINITIONS[event.entityName];
    if (definition.shouldStore?.(entity) === false) {
      await this.deactivateFilteredCatalogMapping(
        connection.organizationId,
        connection.id,
        event.entityName,
        entity,
      );
      return;
    }
    await this.upsertMapping({
      organizationId: connection.organizationId,
      connectionId: connection.id,
      entityName: event.entityName,
      entity,
      deleted: false,
      auditSource: 'webhook',
    });
  }

  private async scheduleOrganization(organizationId: string): Promise<void> {
    await this.syncQueue.add(
      'scheduled-sync',
      { kind: 'scheduled', organizationId },
      {
        jobId: `qbo-hourly-sync-${organizationId}`,
        repeat: { every: readSyncInterval() },
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );
    await this.cdcQueue.add(
      'daily-cdc-sweep',
      { kind: 'cdc-sweep', organizationId, lookbackDays: MAX_LOOKBACK_DAYS },
      {
        jobId: `qbo-daily-cdc-${organizationId}`,
        repeat: { pattern: process.env.QBO_CDC_CRON ?? '0 2 * * *' },
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );
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
          await transaction.query.vendors.findFirst({
            where: (row, { and, eq }) =>
              and(eq(row.id, localId), eq(row.organizationId, organizationId)),
            columns: { id: true },
          }),
        );
      case 'department':
        return Boolean(
          await transaction.query.departments.findFirst({
            where: (row, { and, eq }) =>
              and(eq(row.id, localId), eq(row.organizationId, organizationId)),
            columns: { id: true },
          }),
        );
      case 'project':
        return Boolean(
          await transaction.query.projects.findFirst({
            where: (row, { and, eq }) =>
              and(eq(row.id, localId), eq(row.organizationId, organizationId)),
            columns: { id: true },
          }),
        );
      case 'tax_code':
        return Boolean(
          await transaction.query.taxCodes.findFirst({
            where: (row, { and, eq }) => and(eq(row.id, localId), eq(row.orgId, organizationId)),
            columns: { id: true },
          }),
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

  private async withOrganizationLock<T>(
    organizationId: string,
    callback: () => Promise<T>,
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
  ): Promise<Date> {
    const completedAt = new Date();
    await this.db.transaction(async (transaction) => {
      const [updated] = await transaction
        .update(integrationConnections)
        .set({ lastSyncAt: completedAt, updatedAt: completedAt })
        .where(
          and(
            eq(integrationConnections.id, connectionId),
            eq(integrationConnections.organizationId, organizationId),
          ),
        )
        .returning({ id: integrationConnections.id });
      if (!updated) return;

      await transaction.insert(auditLog).values({
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
    entityName: QboSyncEntity,
  ): Promise<number> {
    const definition = ENTITY_DEFINITIONS[entityName];
    const rows = await this.queryEntity(
      organizationId,
      entityName,
      QBO_ACTIVE_ENTITY_TYPES.has(entityName) ? 'Active IN (true, false)' : undefined,
    );
    let imported = 0;
    const snapshotIds = new Set<string>();
    for (const entity of rows) {
      const externalId = stringValue(entity.Id);
      if (!externalId) continue;
      snapshotIds.add(externalId);
      if (definition.shouldStore?.(entity) === false) {
        await this.deactivateFilteredCatalogMapping(
          organizationId,
          connectionId,
          entityName,
          entity,
        );
        continue;
      }
      await this.upsertMapping({
        organizationId,
        connectionId,
        entityName,
        entity,
        deleted: false,
        auditSource: 'snapshot',
      });
      imported += 1;
    }
    await this.reconcileCatalogEntity(organizationId, connectionId, entityName, snapshotIds);
    return imported;
  }

  /**
   * Keeps a previously imported row out of the selectable catalog when it no
   * longer matches our supported subset, without misreporting it as deleted.
   */
  private async deactivateFilteredCatalogMapping(
    organizationId: string,
    connectionId: string,
    entityName: QboSyncEntity,
    entity: QboObject,
  ): Promise<void> {
    const externalId = stringValue(entity.Id);
    if (!externalId) return;

    await this.db.transaction(async (transaction) => {
      const existing = await transaction.query.externalEntityMappings.findFirst({
        where: (mapping, { and, eq }) =>
          and(
            eq(mapping.organizationId, organizationId),
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
        },
      });
      if (!existing) return;

      const now = new Date();
      const displayName = ENTITY_DEFINITIONS[entityName].displayName(entity);
      const syncToken = stringValue(entity.SyncToken);
      const [updated] = await transaction
        .update(externalEntityMappings)
        .set({
          connectionId,
          displayName,
          syncToken,
          isActive: false,
          isDeleted: false,
          payload: entity,
          syncedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(externalEntityMappings.id, existing.id),
            eq(externalEntityMappings.organizationId, organizationId),
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
          source: 'snapshot',
          reason: 'outside_supported_catalog',
        });
      }
    });
  }

  private async queryEntity(
    organizationId: string,
    entityName: QboSyncEntity | string,
    where?: string,
  ): Promise<QboObject[]> {
    const rows: QboObject[] = [];
    let startPosition = 1;

    while (true) {
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
    entityName: QboSyncEntity,
    snapshotIds: ReadonlySet<string>,
  ): Promise<void> {
    await this.db.transaction(async (transaction) => {
      const existing = await transaction.query.externalEntityMappings.findMany({
        where: (mapping, { and, eq }) =>
          and(
            eq(mapping.organizationId, organizationId),
            eq(mapping.connectionId, connectionId),
            eq(mapping.provider, 'qbo'),
            eq(mapping.direction, 'inbound'),
            eq(mapping.externalEntity, entityName),
            eq(mapping.isDeleted, false),
          ),
        columns: { id: true, externalId: true, isActive: true },
      });

      for (const mapping of existing) {
        if (snapshotIds.has(mapping.externalId)) continue;
        const [updated] = await transaction
          .update(externalEntityMappings)
          .set({ isActive: false, isDeleted: true, updatedAt: new Date() })
          .where(
            and(
              eq(externalEntityMappings.id, mapping.id),
              eq(externalEntityMappings.organizationId, organizationId),
              eq(externalEntityMappings.connectionId, connectionId),
              eq(externalEntityMappings.isDeleted, false),
            ),
          )
          .returning({ id: externalEntityMappings.id });
        if (!updated) continue;

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
    });
  }

  private async upsertMapping(input: MappingUpsert): Promise<void> {
    await this.db.transaction(async (transaction) => {
      await this.upsertMappingInTransaction(transaction, input);
    });
  }

  private async upsertMappingInTransaction(
    transaction: DbTransaction,
    input: MappingUpsert,
  ): Promise<string | undefined> {
    const { organizationId, connectionId, entityName, entity, deleted, mergedIntoExternalId } =
      input;
    const externalId = stringValue(entity.Id);
    if (!externalId) return undefined;
    const definition = isSyncEntity(entityName) ? ENTITY_DEFINITIONS[entityName] : undefined;
    const existing = await transaction.query.externalEntityMappings.findFirst({
      where: (mapping, { and, eq }) =>
        and(
          eq(mapping.organizationId, organizationId),
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
      },
    });
    const now = new Date();
    const existingDelete = deleted && existing ? existing : null;
    const values = {
      organizationId,
      connectionId,
      provider: 'qbo',
      externalEntity: entityName,
      externalId,
      displayName: existingDelete
        ? existingDelete.displayName
        : (definition?.displayName(entity) ?? displayNameFromQbo(entity)),
      syncToken: existingDelete ? existingDelete.syncToken : stringValue(entity.SyncToken),
      localEntity: definition?.localEntity ?? 'qbo_transaction',
      localId: input.localId ?? null,
      direction: 'inbound' as const,
      autoCreated: input.autoCreated ?? false,
      isActive: !deleted && entity.Active !== false,
      isDeleted: deleted,
      mergedIntoExternalId: existingDelete
        ? existingDelete.mergedIntoExternalId
        : (mergedIntoExternalId ?? null),
      payload: existingDelete ? existingDelete.payload : entity,
      syncedAt: now,
      updatedAt: now,
    };

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
        ],
        set: {
          connectionId: values.connectionId,
          displayName: values.displayName,
          syncToken: values.syncToken,
          isActive: values.isActive,
          isDeleted: values.isDeleted,
          mergedIntoExternalId: values.mergedIntoExternalId,
          payload: values.payload,
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
      !isDeepStrictEqual(existing.payload, values.payload)
    ) {
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
          ...(input.localId !== undefined ? { localId: input.localId } : {}),
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
    await transaction.insert(auditLog).values({
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
    event: QboWebhookEvent,
  ): Promise<void> {
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
    const sourceId = payloadSourceId ?? event.entityId;
    const targetId = payloadTargetId ?? (payloadSourceId ? event.entityId : null);
    if (!sourceId || !targetId || sourceId === targetId) {
      this.logger.warn(`Ignoring QBO Vendor Merge without distinct source and target IDs`);
      return;
    }

    let sourceIdForNotification: string | undefined;
    await this.db.transaction(async (transaction) => {
      const source = await transaction.query.externalEntityMappings.findFirst({
        where: (mapping, { and, eq }) =>
          and(
            eq(mapping.organizationId, organizationId),
            eq(mapping.provider, 'qbo'),
            eq(mapping.direction, 'inbound'),
            eq(mapping.externalEntity, 'Vendor'),
            eq(mapping.externalId, sourceId),
          ),
      });
      const target = await transaction.query.externalEntityMappings.findFirst({
        where: (mapping, { and, eq }) =>
          and(
            eq(mapping.organizationId, organizationId),
            eq(mapping.provider, 'qbo'),
            eq(mapping.direction, 'inbound'),
            eq(mapping.externalEntity, 'Vendor'),
            eq(mapping.externalId, targetId),
          ),
      });

      if (source?.isDeleted && source.mergedIntoExternalId === targetId) {
        sourceIdForNotification = source.id;
        return;
      }

      if (source) {
        const [updated] = await transaction
          .update(externalEntityMappings)
          .set({
            isActive: false,
            isDeleted: true,
            mergedIntoExternalId: targetId,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(externalEntityMappings.id, source.id),
              eq(externalEntityMappings.organizationId, organizationId),
              eq(externalEntityMappings.provider, 'qbo'),
              eq(externalEntityMappings.direction, 'inbound'),
            ),
          )
          .returning({ id: externalEntityMappings.id });
        if (updated) {
          sourceIdForNotification = source.id;
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
        sourceIdForNotification = await this.upsertMappingInTransaction(transaction, {
          organizationId,
          connectionId,
          entityName: 'Vendor',
          entity: { Id: sourceId, Name: firstString(event.payload, ['Name', 'DisplayName']) },
          deleted: true,
          mergedIntoExternalId: targetId,
          auditSource: 'merge',
        });
      }

      if (source?.localId) {
        if (target && !target.localId) {
          const [updated] = await transaction
            .update(externalEntityMappings)
            .set({
              localId: source.localId,
              autoCreated: source.autoCreated,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(externalEntityMappings.id, target.id),
                eq(externalEntityMappings.organizationId, organizationId),
                eq(externalEntityMappings.provider, 'qbo'),
                eq(externalEntityMappings.direction, 'inbound'),
                isNull(externalEntityMappings.localId),
              ),
            )
            .returning({ id: externalEntityMappings.id });
          if (updated) {
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
          await this.upsertMappingInTransaction(transaction, {
            organizationId,
            connectionId,
            entityName: 'Vendor',
            entity: { Id: targetId },
            deleted: false,
            localId: source.localId,
            autoCreated: source.autoCreated,
            auditSource: 'merge',
            auditReason: 'vendor_merge',
          });
        }
      }
    });

    const adminId = await resolveOrganizationAdminId(this.db, organizationId);
    if (adminId) {
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

function isRecord(value: unknown): value is QboObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordList(value: unknown): QboObject[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  return isRecord(value) ? [value] : [];
}
