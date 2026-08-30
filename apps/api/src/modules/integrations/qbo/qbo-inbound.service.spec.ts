import { createHmac } from 'node:crypto';
import * as dbModule from '@betterspend/db';
import { PgDialect } from 'drizzle-orm/pg-core';
import { QboResourceNotFoundError } from '../../gl/qbo-client.service';
import {
  QboInboundService,
  qboCdcJobDataSchema,
  verifyQboWebhookSignature,
  type QboCdcJobData,
  type QboSyncJobData,
} from './qbo-inbound.service';

type QueueJob = {
  id?: string;
  getState: jest.Mock<Promise<string>, []>;
  remove: jest.Mock<Promise<void>, []>;
};

type WhereFactory = (
  row: Record<string, string>,
  operators: {
    and: (...conditions: unknown[]) => boolean;
    eq: (column: unknown, value: unknown) => boolean;
  },
) => unknown;

function whereCriteria(where: unknown): Record<string, unknown> {
  if (typeof where !== 'function') {
    try {
      const query = new PgDialect().sqlToQuery(where as never);
      const criteria: Record<string, unknown> = {};
      const matches = query.sql.matchAll(/"[^"]+"\."([^"]+)" = \$(\d+)/g);
      for (const match of matches) {
        const parameterIndex = Number(match[2]) - 1;
        criteria[match[1].replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())] =
          query.params[parameterIndex];
      }
      return criteria;
    } catch {
      return {};
    }
  }

  const criteria: Record<string, unknown> = {};
  const row = new Proxy({} as Record<string, string>, {
    get: (_target, property) => String(property),
  });
  const operators = {
    and: (...conditions: unknown[]) => conditions.every(Boolean),
    eq: (column: unknown, value: unknown) => {
      const name =
        typeof column === 'string'
          ? column
          : typeof column === 'object' && column !== null && 'name' in column
            ? String((column as { name: unknown }).name)
            : undefined;
      if (name) {
        criteria[name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())] = value;
      }
      return true;
    },
  };
  (where as WhereFactory)(row, operators);
  return criteria;
}

function matchesWhere(row: Record<string, unknown>, criteria: Record<string, unknown>): boolean {
  return Object.entries(criteria).every(([key, value]) => row[key] === value);
}

function tableName(table: unknown): string | undefined {
  if (typeof table !== 'object' || table === null) return undefined;
  return (table as { [key: symbol]: unknown })[Symbol.for('drizzle:Name')] as string | undefined;
}

function selectedRows(
  table: unknown,
  criteria: Record<string, unknown>,
  options: {
    connections: Record<string, unknown>[];
    currentConnection?: Record<string, unknown>;
    mappings: Record<string, unknown>[];
    localRecordExists: boolean;
    adminId?: string;
  },
): Record<string, unknown>[] {
  switch (tableName(table)) {
    case 'integration_connections':
      if (options.currentConnection) {
        return matchesWhere(options.currentConnection, criteria) ? [options.currentConnection] : [];
      }
      return options.connections.filter((row) => matchesWhere(row, criteria));
    case 'external_entity_mappings':
      return options.mappings.filter((row) => matchesWhere(row, criteria));
    case 'vendors':
    case 'departments':
    case 'projects':
    case 'tax_codes':
      return options.localRecordExists ? [{ id: criteria.id ?? 'local' }] : [];
    default:
      return options.adminId ? [{ id: options.adminId }] : [];
  }
}

type FakeSelectQuery = {
  from: jest.Mock;
  innerJoin: jest.Mock;
  where: jest.Mock;
  for: jest.Mock;
  limit: jest.Mock;
};

function queue(existingJob?: QueueJob) {
  return {
    getJob: jest.fn(async () => existingJob ?? null),
    add: jest.fn(async (name: string, data: QboSyncJobData | QboCdcJobData) => ({
      id: `${name}-job`,
      data,
    })),
  };
}

function database(options: {
  connection?: Record<string, unknown>;
  currentConnection?: Record<string, unknown>;
  connections?: Record<string, unknown>[];
  mappings?: Record<string, unknown>[];
  adminId?: string;
  localRecordExists?: boolean;
}) {
  const inserted: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const conflictUpdates: Record<string, unknown>[] = [];
  const connection = options.connection ?? {
    id: 'connection-1',
    organizationId: 'organization-1',
    provider: 'qbo',
    realmId: 'realm-1',
    status: 'active',
  };
  const connections = options.connections ?? [connection];
  const localRecordExists = options.localRecordExists ?? true;
  const mappingRealmId = options.currentConnection?.realmId ?? connection.realmId ?? 'realm-1';
  const mappings = (options.mappings ?? []).map((mapping) => {
    mapping.realmId ??= mappingRealmId;
    return mapping;
  });
  const db = {
    query: {
      integrationConnections: {
        findFirst: jest.fn(async () => connection),
        findMany: jest.fn(async () => connections),
      },
      externalEntityMappings: {
        findFirst: jest.fn(async (query: { where?: unknown }) => {
          const criteria = whereCriteria(query?.where);
          return mappings.find((mapping) => matchesWhere(mapping, criteria)) ?? null;
        }),
        findMany: jest.fn(async (query: { where?: unknown }) => {
          const criteria = whereCriteria(query?.where);
          return mappings.filter((mapping) => matchesWhere(mapping, criteria));
        }),
      },
      vendors: { findFirst: jest.fn(async () => (localRecordExists ? { id: 'local' } : null)) },
      departments: { findFirst: jest.fn(async () => (localRecordExists ? { id: 'local' } : null)) },
      projects: { findFirst: jest.fn(async () => (localRecordExists ? { id: 'local' } : null)) },
      taxCodes: { findFirst: jest.fn(async () => (localRecordExists ? { id: 'local' } : null)) },
    },
    select: jest.fn(() => {
      let table: unknown;
      let criteria: Record<string, unknown> = {};
      const query = {} as FakeSelectQuery;
      query.from = jest.fn((nextTable: unknown) => {
        table = nextTable;
        return query;
      });
      query.innerJoin = jest.fn(() => query);
      query.where = jest.fn((where: unknown) => {
        criteria = whereCriteria(where);
        return query;
      });
      query.for = jest.fn(() => query);
      query.limit = jest.fn(async () =>
        selectedRows(table, criteria, {
          connections,
          currentConnection: options.currentConnection,
          mappings,
          localRecordExists,
          adminId: options.adminId,
        }),
      );
      return query;
    }),
    insert: jest.fn(() => ({
      values: jest.fn((values: Record<string, unknown>) => {
        inserted.push(values);
        return {
          onConflictDoUpdate: jest.fn(({ set }: { set: Record<string, unknown> }) => {
            conflictUpdates.push(set);
            return {
              returning: jest.fn(async () => [{ ...values, id: 'mapping-1' }]),
            };
          }),
          returning: jest.fn(async () => [{ ...values, id: 'mapping-1' }]),
        };
      }),
    })),
    update: jest.fn(() => ({
      set: jest.fn((values: Record<string, unknown>) => {
        updates.push(values);
        return {
          where: jest.fn(() => ({
            returning: jest.fn(async () => [{ ...values, id: 'mapping-1' }]),
          })),
        };
      }),
    })),
    transaction: undefined as unknown as jest.Mock,
  };
  db.transaction = jest.fn(async (callback: (transaction: unknown) => Promise<unknown>) =>
    callback(db),
  );
  return { db, inserted, updates, conflictUpdates };
}

function service(
  options: {
    connection?: Record<string, unknown>;
    currentConnection?: Record<string, unknown>;
    connections?: Record<string, unknown>[];
    mappings?: Record<string, unknown>[];
    adminId?: string;
    request?: jest.Mock;
    localRecordExists?: boolean;
    syncJob?: QueueJob;
    cdcJob?: QueueJob;
    lockGuard?: jest.Mock<Promise<void>, []>;
  } = {},
) {
  const harness = database(options);
  const syncQueue = queue(options.syncJob);
  const cdcQueue = queue(options.cdcJob);
  const request = options.request ?? jest.fn();
  const notifications = { createIdempotent: jest.fn(async () => undefined) };
  const assertLock = options.lockGuard ?? jest.fn(async () => undefined);
  const oauthRedis = {
    withLock: jest.fn(
      async (_key: string, callback: (assertLock: () => Promise<void>) => Promise<unknown>) =>
        callback(assertLock),
    ),
  };
  const instance = new QboInboundService(
    harness.db as never,
    { request } as never,
    notifications as never,
    syncQueue as never,
    cdcQueue as never,
    oauthRedis as never,
  );
  return {
    ...harness,
    instance,
    request,
    syncQueue,
    cdcQueue,
    notifications,
    oauthRedis,
    assertLock,
  };
}

describe('QboInboundService', () => {
  beforeEach(() => {
    jest.spyOn(dbModule, 'appendAuditLog').mockImplementation(async (transaction, input) => {
      const fakeTransaction = transaction as unknown as {
        insert: jest.Mock;
      };
      await fakeTransaction.insert(null).values({
        organizationId: input.organizationId,
        userId: input.userId ?? null,
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        changes: input.changes ?? {},
        metadata: input.metadata ?? {},
      });
      return undefined as never;
    });
    jest
      .spyOn(dbModule, 'appendAuditLogIfAbsent')
      .mockImplementation(async (transaction, input) => {
        const fakeTransaction = transaction as unknown as {
          insert: jest.Mock;
        };
        await fakeTransaction.insert(null).values({
          id: input.id,
          organizationId: input.organizationId,
          userId: input.userId ?? null,
          entityType: input.entityType,
          entityId: input.entityId,
          action: input.action,
          changes: input.changes ?? {},
          metadata: input.metadata ?? {},
        });
        return undefined as never;
      });
  });

  afterEach(() => {
    delete process.env.QBO_WEBHOOK_VERIFIER_TOKEN;
    delete process.env.QBO_WEBHOOK_SECRET;
    jest.restoreAllMocks();
  });

  it('verifies the exact raw webhook bytes with a constant-time-safe comparison', () => {
    const secret = 'webhook-secret';
    const body = Buffer.from('{"eventNotifications":[]}');
    const signature = createHmac('sha256', secret).update(body).digest('base64');

    expect(verifyQboWebhookSignature(body, signature, secret)).toBe(true);
    expect(verifyQboWebhookSignature(Buffer.from(`${body} `), signature, secret)).toBe(false);
    expect(verifyQboWebhookSignature(body, `sha256=${signature}`, secret)).toBe(true);
  });

  it('queues signed webhook entities without doing provider work in the request path', async () => {
    const secret = 'webhook-secret';
    process.env.QBO_WEBHOOK_VERIFIER_TOKEN = secret;
    const body = Buffer.from(
      JSON.stringify({
        eventNotifications: [
          {
            realmId: 'realm-1',
            dataChangeEvent: {
              entities: [{ name: 'Vendor', id: '42', operation: 'Update', lastUpdated: 'now' }],
            },
          },
        ],
      }),
    );
    const harness = service();
    const signature = createHmac('sha256', secret).update(body).digest('base64');

    await expect(harness.instance.receiveWebhook(body, signature)).resolves.toEqual({
      accepted: true,
      queued: 1,
    });
    expect(harness.cdcQueue.add).toHaveBeenCalledWith(
      'webhook',
      expect.objectContaining({
        kind: 'webhook',
        event: expect.objectContaining({
          realmId: 'realm-1',
          entityName: 'Vendor',
          entityId: '42',
          operation: 'update',
        }),
      }),
      expect.objectContaining({ attempts: 5 }),
    );
    expect(harness.request).not.toHaveBeenCalled();
  });

  it('accepts only strict, allow-listed CDC job payloads', () => {
    const event = {
      kind: 'webhook' as const,
      event: {
        realmId: 'realm-1',
        entityName: 'Vendor' as const,
        entityId: 'vendor-1',
        operation: 'delete' as const,
        payload: {},
      },
    };

    expect(qboCdcJobDataSchema.parse(event)).toEqual(event);
    expect(() =>
      qboCdcJobDataSchema.parse({
        ...event,
        event: { ...event.event, entityName: 'User' },
      }),
    ).toThrow();
    expect(() =>
      qboCdcJobDataSchema.parse({
        ...event,
        event: { ...event.event, operation: 'DELETE' },
      }),
    ).toThrow();
    expect(() => qboCdcJobDataSchema.parse({ ...event, unexpected: true })).toThrow();
  });

  it('accepts bounded QBO CloudEvents and keeps merge data for async processing', async () => {
    const secret = 'webhook-secret';
    process.env.QBO_WEBHOOK_VERIFIER_TOKEN = secret;
    const body = Buffer.from(
      JSON.stringify([
        {
          specversion: '1.0',
          type: 'qbo.vendor.merged.v1',
          intuitaccountid: 'realm-1',
          intuitentityid: 'vendor-target',
          time: '2026-08-29T20:00:00.000Z',
          data: { deletedId: 'vendor-source' },
        },
        {
          specversion: '1.0',
          type: 'qbo.employee.updated.v1',
          intuitaccountid: 'realm-1',
          intuitentityid: 'employee-1',
          data: {},
        },
      ]),
    );
    const harness = service();
    const signature = createHmac('sha256', secret).update(body).digest('base64');

    await expect(harness.instance.receiveWebhook(body, signature)).resolves.toEqual({
      accepted: true,
      queued: 1,
    });
    expect(harness.cdcQueue.add).toHaveBeenCalledWith(
      'webhook',
      {
        kind: 'webhook',
        event: {
          realmId: 'realm-1',
          entityName: 'Vendor',
          entityId: 'vendor-target',
          operation: 'merge',
          lastUpdated: '2026-08-29T20:00:00.000Z',
          payload: { deletedId: 'vendor-source' },
        },
      },
      expect.objectContaining({ attempts: 5 }),
    );
  });

  it('rejects an invalid webhook signature before parsing or enqueueing', async () => {
    process.env.QBO_WEBHOOK_VERIFIER_TOKEN = 'webhook-secret';
    const body = Buffer.from('{"eventNotifications":[]}');
    const harness = service();

    await expect(harness.instance.receiveWebhook(body, 'wrong-signature')).rejects.toThrow(
      'Invalid QBO webhook signature',
    );
    expect(harness.cdcQueue.add).not.toHaveBeenCalled();
  });

  it('retries an existing failed initial or CDC job after removing the failed job', async () => {
    const failedInitialJob: QueueJob = {
      id: 'failed-initial',
      getState: jest.fn(async () => 'failed'),
      remove: jest.fn(async () => undefined),
    };
    const failedCdcJob: QueueJob = {
      id: 'failed-cdc',
      getState: jest.fn(async () => 'failed'),
      remove: jest.fn(async () => undefined),
    };
    const harness = service({ syncJob: failedInitialJob, cdcJob: failedCdcJob });

    await harness.instance.enqueueInitialSync('organization-1', ['Vendor']);
    await harness.instance.enqueueCdcSweep('organization-1');

    expect(failedInitialJob.remove).toHaveBeenCalledTimes(1);
    expect(failedCdcJob.remove).toHaveBeenCalledTimes(1);
    expect(harness.syncQueue.add).toHaveBeenCalledWith(
      'initial-sync',
      { kind: 'initial', organizationId: 'organization-1', entityTypes: ['Vendor'] },
      expect.objectContaining({
        jobId: 'qbo-initial-sync-organization-1',
        removeOnFail: true,
      }),
    );
    expect(harness.cdcQueue.add).toHaveBeenCalledWith(
      'cdc-sweep',
      expect.objectContaining({ kind: 'cdc-sweep', organizationId: 'organization-1' }),
      expect.objectContaining({ removeOnFail: true }),
    );
  });

  it('recovers a pending initial sync from the connection marker on startup', async () => {
    const harness = service({
      connection: {
        id: 'connection-1',
        organizationId: 'organization-1',
        provider: 'qbo',
        realmId: 'realm-1',
        status: 'active',
        lastSyncAt: null,
      },
    });

    await harness.instance.onModuleInit();

    expect(harness.syncQueue.add).toHaveBeenCalledWith(
      'initial-sync',
      {
        kind: 'initial',
        organizationId: 'organization-1',
        entityTypes: expect.any(Array),
      },
      expect.objectContaining({
        jobId: 'qbo-initial-sync-organization-1',
        attempts: 3,
        removeOnFail: true,
      }),
    );
    expect(harness.syncQueue.add).toHaveBeenCalledTimes(1);
  });

  it('retries pending initial syncs after the queue recovers without a restart', async () => {
    jest.useFakeTimers();
    const harness = service();
    try {
      harness.syncQueue.add.mockRejectedValueOnce(new Error('Redis unavailable'));

      await harness.instance.onModuleInit();

      expect(harness.syncQueue.add).toHaveBeenCalledTimes(1);
      harness.syncQueue.add.mockResolvedValue({
        id: 'qbo-retry-job',
        data: { kind: 'initial', organizationId: 'organization-1' },
      });

      await jest.advanceTimersByTimeAsync(30_000);

      expect(harness.syncQueue.add).toHaveBeenCalledTimes(2);
      expect(harness.syncQueue.add).toHaveBeenLastCalledWith(
        'initial-sync',
        expect.objectContaining({ kind: 'initial', organizationId: 'organization-1' }),
        expect.objectContaining({ jobId: 'qbo-initial-sync-organization-1' }),
      );
    } finally {
      harness.instance.onModuleDestroy();
      jest.useRealTimers();
    }
  });

  it('repairs a missing daily CDC schedule after the queue recovers without a restart', async () => {
    jest.useFakeTimers();
    const harness = service({
      connection: {
        id: 'connection-1',
        organizationId: 'organization-1',
        provider: 'qbo',
        realmId: 'realm-1',
        status: 'active',
        lastSyncAt: new Date('2026-08-29T20:00:00.000Z'),
      },
    });
    try {
      harness.cdcQueue.add.mockRejectedValueOnce(new Error('Redis unavailable'));

      await harness.instance.onModuleInit();

      expect(harness.syncQueue.add).toHaveBeenCalledTimes(1);
      expect(harness.cdcQueue.add).toHaveBeenCalledTimes(1);

      harness.cdcQueue.add.mockResolvedValue({
        id: 'qbo-cdc-retry-job',
        data: { kind: 'cdc-sweep', organizationId: 'organization-1' },
      });

      await jest.advanceTimersByTimeAsync(30_000);

      expect(harness.syncQueue.add).toHaveBeenCalledTimes(2);
      expect(harness.cdcQueue.add).toHaveBeenCalledTimes(2);
      expect(harness.cdcQueue.add).toHaveBeenLastCalledWith(
        'daily-cdc-sweep',
        { kind: 'cdc-sweep', organizationId: 'organization-1', lookbackDays: 30 },
        expect.objectContaining({ jobId: 'qbo-daily-cdc-organization-1' }),
      );
    } finally {
      harness.instance.onModuleDestroy();
      jest.useRealTimers();
    }
  });

  it('fans one realm webhook out to every active organization connection', async () => {
    const connections = [
      {
        id: 'connection-1',
        organizationId: 'organization-1',
        provider: 'qbo',
        realmId: 'shared-realm',
        status: 'active',
      },
      {
        id: 'connection-2',
        organizationId: 'organization-2',
        provider: 'qbo',
        realmId: 'shared-realm',
        status: 'active',
      },
    ];
    const request = jest.fn(async ({ organizationId }: { organizationId: string }) => ({
      data: { Vendor: { Id: `vendor-${organizationId}`, Name: organizationId } },
    }));
    const harness = service({ connections, request });

    await harness.instance.processWebhookEvent({
      realmId: 'shared-realm',
      entityName: 'Vendor',
      entityId: 'vendor-1',
      operation: 'update',
      lastUpdated: '2026-08-30T00:00:00.000Z',
      payload: {},
    });

    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.map(([input]) => input.organizationId)).toEqual(
      expect.arrayContaining(['organization-1', 'organization-2']),
    );
    expect(harness.inserted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          organizationId: 'organization-1',
          externalId: 'vendor-organization-1',
        }),
        expect.objectContaining({
          organizationId: 'organization-2',
          externalId: 'vendor-organization-2',
        }),
      ]),
    );
    expect(harness.oauthRedis.withLock).toHaveBeenCalledTimes(2);
    expect(harness.oauthRedis.withLock.mock.calls.map(([key]) => key)).toEqual([
      'qbo-sync:organization-1',
      'qbo-sync:organization-2',
    ]);
  });

  it('does not persist a webhook fetched before a QBO realm reconnect', async () => {
    const staleConnection = {
      id: 'connection-1',
      organizationId: 'organization-1',
      provider: 'qbo',
      realmId: 'old-realm',
      status: 'active',
    };
    const currentConnection = { ...staleConnection, realmId: 'new-realm' };
    const harness = service({
      connection: currentConnection,
      connections: [staleConnection],
      currentConnection,
      request: jest.fn(async () => ({ data: { Vendor: { Id: 'vendor-1', Name: 'Acme' } } })),
    });

    await harness.instance.processWebhookEvent({
      realmId: 'old-realm',
      entityName: 'Vendor',
      entityId: 'vendor-1',
      operation: 'update',
      lastUpdated: '2026-08-30T00:00:00.000Z',
      payload: {},
    });

    expect(harness.updates).toHaveLength(0);
    expect(harness.inserted).toHaveLength(0);
  });

  it('clears a mapping link when an overlapping external ID moves to a new realm', async () => {
    const harness = service({
      connection: {
        id: 'new-connection',
        organizationId: 'organization-1',
        provider: 'qbo',
        realmId: 'new-realm',
        status: 'active',
      },
      mappings: [
        {
          id: 'mapping-1',
          organizationId: 'organization-1',
          connectionId: 'old-connection',
          realmId: 'old-realm',
          provider: 'qbo',
          externalEntity: 'Vendor',
          externalId: 'vendor-1',
          direction: 'inbound',
          localId: '00000000-0000-4000-8000-000000000010',
          autoCreated: true,
          syncedAt: new Date('2026-08-30T00:00:00.000Z'),
        },
      ],
    });

    await harness.instance.processWebhookEvent({
      realmId: 'new-realm',
      entityName: 'Vendor',
      entityId: 'vendor-1',
      operation: 'delete',
      lastUpdated: '2026-08-29T00:00:00.000Z',
      payload: {},
    });

    expect(harness.conflictUpdates).toHaveLength(1);
    expect(harness.conflictUpdates[0]).not.toHaveProperty('localId');
    expect(harness.inserted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ realmId: 'new-realm', localId: null, autoCreated: false }),
      ]),
    );
  });

  it('ignores a replayed webhook older than the stored mapping version', async () => {
    const harness = service({
      mappings: [
        {
          id: 'mapping-1',
          organizationId: 'organization-1',
          connectionId: 'connection-1',
          provider: 'qbo',
          externalEntity: 'Vendor',
          externalId: 'vendor-1',
          direction: 'inbound',
          displayName: 'Acme',
          isActive: true,
          isDeleted: false,
          payload: { Id: 'vendor-1', DisplayName: 'Acme' },
          syncedAt: new Date('2026-08-30T00:00:00.000Z'),
        },
      ],
    });

    await harness.instance.processWebhookEvent({
      realmId: 'realm-1',
      entityName: 'Vendor',
      entityId: 'vendor-1',
      operation: 'delete',
      lastUpdated: '2026-08-29T00:00:00.000Z',
      payload: {},
    });

    expect(harness.conflictUpdates).toHaveLength(0);
    expect(harness.inserted).toHaveLength(0);
  });

  it('ignores an older filtered-catalog webhook instead of overwriting the current row', async () => {
    const harness = service({
      mappings: [
        {
          id: 'mapping-1',
          organizationId: 'organization-1',
          connectionId: 'connection-1',
          realmId: 'realm-1',
          provider: 'qbo',
          externalEntity: 'Account',
          externalId: 'account-1',
          direction: 'inbound',
          isActive: true,
          isDeleted: false,
          syncedAt: new Date('2026-08-30T00:00:00.000Z'),
        },
      ],
      request: jest.fn(async () => ({
        data: { Account: { Id: 'account-1', AccountType: 'Bank' } },
      })),
    });

    await harness.instance.processWebhookEvent({
      realmId: 'realm-1',
      entityName: 'Account',
      entityId: 'account-1',
      operation: 'update',
      lastUpdated: '2026-08-29T00:00:00.000Z',
      payload: {},
    });

    expect(harness.updates).toHaveLength(0);
    expect(harness.inserted).toHaveLength(0);
  });

  it('fetches webhook entities by an encoded resource ID instead of building query text', async () => {
    const hostileId = "42' OR Id = '43";
    const request = jest.fn(
      async ({ path, query }: { path: string; query?: Record<string, unknown> }) => {
        expect(path).toBe(`vendor/${encodeURIComponent(hostileId)}`);
        expect(query).toBeUndefined();
        return { data: { Vendor: { Id: hostileId, DisplayName: 'Acme' } } };
      },
    );
    const harness = service({ request });

    await harness.instance.processWebhookEvent({
      realmId: 'realm-1',
      entityName: 'Vendor',
      entityId: hostileId,
      operation: 'update',
      lastUpdated: '2026-08-30T00:00:00.000Z',
      payload: {},
    });

    expect(harness.inserted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalEntity: 'Vendor',
          externalId: hostileId,
          isDeleted: false,
        }),
      ]),
    );
  });

  it('tombstones a webhook mapping when QBO returns a not-found response', async () => {
    const request = jest.fn(async () => {
      throw new QboResourceNotFoundError();
    });
    const harness = service({ request });

    await harness.instance.processWebhookEvent({
      realmId: 'realm-1',
      entityName: 'Vendor',
      entityId: 'vendor-missing',
      operation: 'update',
      lastUpdated: '2026-08-30T00:00:00.000Z',
      payload: {},
    });

    expect(harness.inserted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalEntity: 'Vendor',
          externalId: 'vendor-missing',
          isActive: false,
          isDeleted: true,
        }),
      ]),
    );
  });

  it('processes supported tax and transaction create/update webhooks instead of discarding them', async () => {
    const events = [
      ['TaxCode', 'tax-code-1', 'tax_code'],
      ['TaxRate', 'tax-rate-1', 'tax_rate'],
      ['Bill', 'bill-1', 'qbo_transaction'],
      ['Invoice', 'invoice-1', 'qbo_transaction'],
    ] as const;

    for (const [entityName, entityId, localEntity] of events) {
      const request = jest.fn(async () => ({ data: { [entityName]: { Id: entityId } } }));
      const harness = service({ request });

      await harness.instance.processWebhookEvent({
        realmId: 'realm-1',
        entityName,
        entityId,
        operation: 'update',
        lastUpdated: '2026-08-30T00:00:00.000Z',
        payload: {},
      });

      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({ path: `${entityName.toLowerCase()}/${entityId}` }),
      );
      expect(harness.inserted).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            externalEntity: entityName,
            externalId: entityId,
            localEntity,
            isDeleted: false,
          }),
        ]),
      );
    }
  });

  it('uses the fetched QBO resource version when the webhook timestamp is missing or invalid', async () => {
    const providerTimestamp = '2026-08-30T01:02:03.000Z';
    const request = jest.fn(async () => ({
      data: {
        Vendor: {
          Id: 'vendor-1',
          Name: 'Acme',
          MetaData: { LastUpdatedTime: providerTimestamp },
        },
      },
    }));
    const harness = service({ request });

    await harness.instance.processWebhookEvent({
      realmId: 'realm-1',
      entityName: 'Vendor',
      entityId: 'vendor-1',
      operation: 'update',
      lastUpdated: 'not-a-timestamp',
      payload: {},
    });

    expect(harness.inserted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalEntity: 'Vendor',
          externalId: 'vendor-1',
          syncedAt: new Date(providerTimestamp),
        }),
      ]),
    );
    expect(harness.cdcQueue.add).not.toHaveBeenCalled();
  });

  it('queues an unversioned catalog delete for reconciliation without blocking the webhook', async () => {
    const harness = service({
      mappings: [
        {
          id: 'mapping-1',
          organizationId: 'organization-1',
          connectionId: 'connection-1',
          realmId: 'realm-1',
          provider: 'qbo',
          externalEntity: 'Vendor',
          externalId: 'vendor-1',
          direction: 'inbound',
          isActive: true,
          isDeleted: false,
          syncedAt: new Date('2026-08-29T00:00:00.000Z'),
        },
      ],
      request: jest.fn(async ({ path }: { path: string }) => {
        expect(path).toBe('query');
        return { data: { QueryResponse: { Vendor: [] } } };
      }),
    });

    await harness.instance.processWebhookEvent({
      realmId: 'realm-1',
      entityName: 'Vendor',
      entityId: 'vendor-1',
      operation: 'delete',
      lastUpdated: 'not-a-timestamp',
      payload: {},
    });

    expect(harness.updates).toHaveLength(0);
    expect(harness.syncQueue.add).toHaveBeenCalledWith(
      'webhook-reconciliation',
      expect.objectContaining({
        kind: 'reconcile',
        organizationId: 'organization-1',
        connectionId: 'connection-1',
        realmId: 'realm-1',
        entityName: 'Vendor',
      }),
      expect.objectContaining({
        attempts: 5,
        removeOnComplete: true,
        removeOnFail: false,
      }),
    );
    expect(harness.cdcQueue.add).not.toHaveBeenCalled();
  });

  it('queues CDC and acknowledges an unversioned transaction webhook without writing it', async () => {
    const request = jest.fn(async () => ({ data: { Bill: { Id: 'bill-1' } } }));
    const harness = service({ request });

    await expect(
      harness.instance.processWebhookEvent({
        realmId: 'realm-1',
        entityName: 'Bill',
        entityId: 'bill-1',
        operation: 'update',
        lastUpdated: 'not-a-timestamp',
        payload: {},
      }),
    ).resolves.toBeUndefined();

    expect(harness.inserted).toHaveLength(0);
    expect(harness.updates).toHaveLength(0);
    expect(harness.cdcQueue.add).toHaveBeenCalledWith(
      'cdc-recovery',
      expect.objectContaining({
        kind: 'cdc-recovery',
        organizationId: 'organization-1',
        connectionId: 'connection-1',
        realmId: 'realm-1',
      }),
      expect.objectContaining({
        attempts: 5,
        removeOnComplete: true,
        removeOnFail: false,
      }),
    );
  });

  it('queues CDC for an unversioned QBO 404 and acknowledges without writing a tombstone', async () => {
    const request = jest.fn(async () => {
      throw new QboResourceNotFoundError();
    });
    const harness = service({ request });

    await expect(
      harness.instance.processWebhookEvent({
        realmId: 'realm-1',
        entityName: 'Invoice',
        entityId: 'invoice-missing',
        operation: 'update',
        lastUpdated: 'not-a-timestamp',
        payload: {},
      }),
    ).resolves.toBeUndefined();

    expect(harness.inserted).toHaveLength(0);
    expect(harness.updates).toHaveLength(0);
    expect(harness.cdcQueue.add).toHaveBeenCalledWith(
      'cdc-recovery',
      expect.objectContaining({ kind: 'cdc-recovery', organizationId: 'organization-1' }),
      expect.objectContaining({ removeOnFail: false }),
    );
  });

  it('uses the current target version to apply a vendor merge without an envelope timestamp', async () => {
    const providerTimestamp = '2026-08-30T04:05:06.000Z';
    const harness = service({
      mappings: [
        {
          id: 'source-mapping',
          organizationId: 'organization-1',
          connectionId: 'connection-1',
          realmId: 'realm-1',
          provider: 'qbo',
          externalEntity: 'Vendor',
          externalId: 'vendor-source',
          direction: 'inbound',
          localId: '00000000-0000-4000-8000-000000000010',
          isActive: true,
          isDeleted: false,
        },
        {
          id: 'target-mapping',
          organizationId: 'organization-1',
          connectionId: 'connection-1',
          realmId: 'realm-1',
          provider: 'qbo',
          externalEntity: 'Vendor',
          externalId: 'vendor-target',
          direction: 'inbound',
          localId: null,
          isActive: true,
          isDeleted: false,
        },
      ],
      request: jest.fn(async ({ path }: { path: string }) => {
        expect(path).toBe('vendor/vendor-target');
        return {
          data: {
            Vendor: { Id: 'vendor-target', MetaData: { LastUpdatedTime: providerTimestamp } },
          },
        };
      }),
    });

    await harness.instance.processWebhookEvent({
      realmId: 'realm-1',
      entityName: 'Vendor',
      entityId: 'vendor-target',
      operation: 'merge',
      payload: { deletedId: 'vendor-source' },
    });

    expect(harness.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ isDeleted: true, mergedIntoExternalId: 'vendor-target' }),
      ]),
    );
    expect(harness.cdcQueue.add).not.toHaveBeenCalled();
  });

  it('deduplicates durable recovery jobs while an earlier failed job is retained', async () => {
    const existingJob: QueueJob = {
      id: 'existing-recovery-job',
      getState: jest.fn(async () => 'failed'),
      remove: jest.fn(async () => undefined),
    };
    const harness = service({ syncJob: existingJob, cdcJob: existingJob });
    const connection = {
      id: 'connection-1',
      organizationId: 'organization-1',
      realmId: 'realm-1',
    };

    await harness.instance.enqueueCatalogReconciliation(connection, 'Vendor');
    await harness.instance.enqueueCdcRecovery(connection);
    await harness.instance.enqueueVendorMergeRecovery(connection, {
      realmId: 'realm-1',
      entityName: 'Vendor',
      entityId: 'vendor-target',
      operation: 'merge',
      payload: { deletedId: 'vendor-source' },
    });

    expect(harness.syncQueue.add).not.toHaveBeenCalled();
    expect(harness.cdcQueue.add).not.toHaveBeenCalled();
    expect(existingJob.remove).not.toHaveBeenCalled();
  });

  it('retries vendor merge recovery until the target exposes a provider version', async () => {
    const providerTimestamp = '2026-08-30T05:06:07.000Z';
    const request = jest
      .fn()
      .mockResolvedValueOnce({ data: { Vendor: { Id: 'vendor-target' } } })
      .mockResolvedValueOnce({
        data: { Vendor: { Id: 'vendor-target', MetaData: { LastUpdatedTime: providerTimestamp } } },
      });
    const harness = service({
      request,
      mappings: [
        {
          id: 'source-mapping',
          organizationId: 'organization-1',
          connectionId: 'connection-1',
          realmId: 'realm-1',
          provider: 'qbo',
          externalEntity: 'Vendor',
          externalId: 'vendor-source',
          direction: 'inbound',
          localId: '00000000-0000-4000-8000-000000000010',
          isActive: true,
          isDeleted: false,
        },
      ],
    });
    const recovery = {
      organizationId: 'organization-1',
      connectionId: 'connection-1',
      realmId: 'realm-1',
      sourceId: 'vendor-source',
      targetId: 'vendor-target',
    };

    await expect(harness.instance.processVendorMergeRecovery(recovery)).rejects.toThrow(
      'no authoritative target timestamp',
    );
    expect(harness.updates).toHaveLength(0);

    await expect(harness.instance.processVendorMergeRecovery(recovery)).resolves.toBeUndefined();
    expect(harness.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ isDeleted: true, mergedIntoExternalId: 'vendor-target' }),
      ]),
    );
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('acknowledges stale recovery jobs without crossing into the active QBO realm', async () => {
    const request = jest.fn();
    const harness = service({
      connection: {
        id: 'current-connection',
        organizationId: 'organization-1',
        provider: 'qbo',
        realmId: 'current-realm',
        status: 'active',
      },
      request,
    });

    await expect(
      harness.instance.reconcileCatalogWebhook(
        'organization-1',
        'old-connection',
        'old-realm',
        'Vendor',
      ),
    ).resolves.toBeUndefined();
    await expect(
      harness.instance.runCdcRecovery('organization-1', 'old-connection', 'old-realm'),
    ).resolves.toMatchObject({ imported: 0, tombstones: 0 });
    await expect(
      harness.instance.processVendorMergeRecovery({
        organizationId: 'organization-1',
        connectionId: 'old-connection',
        realmId: 'old-realm',
        sourceId: 'vendor-source',
        targetId: 'vendor-target',
      }),
    ).resolves.toBeUndefined();

    expect(request).not.toHaveBeenCalled();
  });

  it('imports expense/AP accounts and keeps inactive vendors as catalog rows', async () => {
    const request = jest.fn(
      async ({ path, query }: { path: string; query?: Record<string, unknown> }) => {
        expect(path).toBe('query');
        const statement = String(query?.query);
        if (statement.includes('FROM Account')) {
          return {
            data: {
              QueryResponse: {
                Account: [
                  { Id: 'account-expense', Name: 'Travel', AccountType: 'Expense', SyncToken: '3' },
                  { Id: 'account-bank', Name: 'Cash', AccountType: 'Bank', SyncToken: '4' },
                ],
              },
            },
          };
        }
        if (statement.includes('FROM Vendor')) {
          return {
            data: {
              QueryResponse: {
                Vendor: [{ Id: 'vendor-inactive', DisplayName: 'Former supplier', Active: false }],
              },
            },
          };
        }
        return { data: { QueryResponse: {} } };
      },
    );
    const harness = service({ request });

    const result = await harness.instance.syncNow('organization-1', ['Account', 'Vendor']);

    const statements = request.mock.calls.map(([input]) =>
      String((input as { query?: { query?: unknown } }).query?.query),
    );

    expect(result.imported).toBe(2);
    expect(statements).toEqual(
      expect.arrayContaining([
        expect.stringContaining('FROM Account WHERE Active IN (true, false)'),
        expect.stringContaining('FROM Vendor WHERE Active IN (true, false)'),
      ]),
    );
    expect(harness.inserted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalEntity: 'Account',
          externalId: 'account-expense',
          localEntity: 'gl_account',
          syncToken: '3',
          isActive: true,
          isDeleted: false,
        }),
        expect.objectContaining({
          externalEntity: 'Vendor',
          externalId: 'vendor-inactive',
          localEntity: 'vendor',
          isActive: false,
          isDeleted: false,
        }),
      ]),
    );
    expect(harness.inserted).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ externalId: 'account-bank' })]),
    );
    expect(harness.updates).toEqual(
      expect.arrayContaining([expect.objectContaining({ lastSyncAt: expect.any(Date) })]),
    );
    expect(harness.oauthRedis.withLock).toHaveBeenCalledWith(
      'qbo-sync:organization-1',
      expect.any(Function),
    );
  });

  it('aborts before writing when the organization lock lease is lost', async () => {
    const lockLost = new Error('QBO sync lock was lost');
    const lockGuard = jest.fn(async () => {
      if (lockGuard.mock.calls.length >= 3) throw lockLost;
    });
    const harness = service({
      lockGuard,
      request: jest.fn(async () => ({
        data: { QueryResponse: { Vendor: [{ Id: 'vendor-1', DisplayName: 'Acme' }] } },
      })),
    });

    await expect(harness.instance.syncNow('organization-1', ['Vendor'])).rejects.toBe(lockLost);
    expect(harness.inserted).toHaveLength(0);
    expect(harness.updates).toHaveLength(0);
  });

  it('audits a completed sync with the connection update in one transaction', async () => {
    const harness = service({
      request: jest.fn(async () => ({ data: { QueryResponse: { Vendor: [] } } })),
    });

    await harness.instance.syncNow('organization-1', ['Vendor']);

    expect(harness.db.transaction).toHaveBeenCalled();
    expect(harness.inserted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          organizationId: 'organization-1',
          entityType: 'integration_connection',
          entityId: 'connection-1',
          action: 'sync_completed',
          changes: { lastSyncAt: expect.any(String) },
          metadata: { actor: 'system', provider: 'qbo', source: 'sync' },
        }),
      ]),
    );
  });

  it('classifies imported tax entities with their local mapping entities', async () => {
    const request = jest.fn(async ({ query }: { query?: Record<string, unknown> }) => {
      const statement = String(query?.query);
      if (statement.includes('FROM TaxCode')) {
        return { data: { QueryResponse: { TaxCode: [{ Id: 'tax-code-1', Name: 'Sales tax' }] } } };
      }
      if (statement.includes('FROM TaxRate')) {
        return { data: { QueryResponse: { TaxRate: [{ Id: 'tax-rate-1', Name: 'State rate' }] } } };
      }
      return { data: { QueryResponse: {} } };
    });
    const harness = service({ request });

    const result = await harness.instance.syncNow('organization-1', ['TaxCode', 'TaxRate']);

    expect(result.imported).toBe(2);
    expect(harness.inserted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalEntity: 'TaxCode',
          externalId: 'tax-code-1',
          localEntity: 'tax_code',
        }),
        expect.objectContaining({
          externalEntity: 'TaxRate',
          externalId: 'tax-rate-1',
          localEntity: 'tax_rate',
        }),
      ]),
    );
  });

  it('deactivates an account that leaves the supported subset during a CDC sweep', async () => {
    const harness = service({
      mappings: [
        {
          id: 'mapping-1',
          organizationId: 'organization-1',
          connectionId: 'connection-1',
          provider: 'qbo',
          externalEntity: 'Account',
          externalId: 'account-1',
          direction: 'inbound',
          displayName: 'Travel',
          syncToken: '3',
          isActive: true,
          isDeleted: false,
          payload: { Id: 'account-1', Name: 'Travel', AccountType: 'Expense' },
        },
      ],
      request: jest.fn(async () => ({
        data: {
          CDCResponse: [
            {
              QueryResponse: {
                Account: [{ Id: 'account-1', Name: 'Cash', AccountType: 'Bank', SyncToken: '4' }],
              },
            },
          ],
        },
      })),
    });

    const result = await harness.instance.runCdcSweep('organization-1');

    expect(result.imported).toBe(0);
    expect(harness.updates).toEqual(
      expect.arrayContaining([expect.objectContaining({ isActive: false, isDeleted: false })]),
    );
    expect(harness.inserted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'external_entity_mapping',
          action: 'deactivated',
          metadata: expect.objectContaining({
            source: 'cdc',
            reason: 'outside_supported_catalog',
          }),
        }),
      ]),
    );
  });

  it('deactivates an account that leaves the supported subset from a webhook update', async () => {
    const harness = service({
      mappings: [
        {
          id: 'mapping-1',
          organizationId: 'organization-1',
          connectionId: 'connection-1',
          provider: 'qbo',
          externalEntity: 'Account',
          externalId: 'account-1',
          direction: 'inbound',
          displayName: 'Travel',
          syncToken: '3',
          isActive: true,
          isDeleted: false,
          payload: { Id: 'account-1', Name: 'Travel', AccountType: 'Expense' },
        },
      ],
      request: jest.fn(async () => ({
        data: { Account: { Id: 'account-1', Name: 'Cash', AccountType: 'Bank', SyncToken: '4' } },
      })),
    });

    await harness.instance.processWebhookEvent({
      realmId: 'realm-1',
      entityName: 'Account',
      entityId: 'account-1',
      operation: 'update',
      lastUpdated: '2026-08-30T00:00:00.000Z',
      payload: {},
    });

    expect(harness.updates).toEqual(
      expect.arrayContaining([expect.objectContaining({ isActive: false, isDeleted: false })]),
    );
    expect(harness.inserted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'external_entity_mapping',
          action: 'deactivated',
          metadata: expect.objectContaining({
            source: 'webhook',
            reason: 'outside_supported_catalog',
          }),
        }),
      ]),
    );
  });

  it('reconciles rows missing from a completed snapshot and audits the tombstone', async () => {
    const staleMapping = {
      id: 'stale-mapping',
      organizationId: 'organization-1',
      connectionId: 'connection-1',
      provider: 'qbo',
      externalEntity: 'Vendor',
      externalId: 'vendor-stale',
      direction: 'inbound',
      isActive: true,
      isDeleted: false,
    };
    const request = jest.fn(async () => ({ data: { QueryResponse: { Vendor: [] } } }));
    const harness = service({ mappings: [staleMapping], request });

    const result = await harness.instance.syncNow('organization-1', ['Vendor']);

    expect(result.imported).toBe(0);
    expect(result.tombstones).toBe(1);
    expect(harness.updates).toEqual(
      expect.arrayContaining([expect.objectContaining({ isActive: false, isDeleted: true })]),
    );
    expect(harness.inserted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'external_entity_mapping',
          action: 'deleted',
          metadata: expect.objectContaining({
            source: 'snapshot',
            reason: 'missing_from_snapshot',
          }),
        }),
      ]),
    );
  });

  it('deactivates an account that leaves the supported subset without tombstoning it', async () => {
    const previousAccount = {
      Id: 'account-1',
      Name: 'Travel',
      AccountType: 'Expense',
      SyncToken: '3',
    };
    const currentAccount = {
      Id: 'account-1',
      Name: 'Operating cash',
      AccountType: 'Bank',
      SyncToken: '4',
    };
    const harness = service({
      mappings: [
        {
          id: 'mapping-1',
          organizationId: 'organization-1',
          connectionId: 'connection-1',
          provider: 'qbo',
          externalEntity: 'Account',
          externalId: 'account-1',
          direction: 'inbound',
          displayName: 'Travel',
          syncToken: '3',
          isActive: true,
          isDeleted: false,
          payload: previousAccount,
        },
      ],
      request: jest.fn(async () => ({
        data: { QueryResponse: { Account: [currentAccount] } },
      })),
    });

    const result = await harness.instance.syncNow('organization-1', ['Account']);

    expect(result.imported).toBe(0);
    expect(harness.updates).toEqual(
      expect.arrayContaining([expect.objectContaining({ isActive: false, isDeleted: false })]),
    );
    expect(harness.inserted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'external_entity_mapping',
          action: 'deactivated',
          metadata: expect.objectContaining({ reason: 'outside_supported_catalog' }),
        }),
      ]),
    );
    expect(harness.inserted).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityType: 'external_entity_mapping', action: 'deleted' }),
      ]),
    );
  });

  it('does not audit an unchanged snapshot row', async () => {
    const vendor = { Id: 'vendor-1', DisplayName: 'Acme', Active: true, SyncToken: '7' };
    const harness = service({
      mappings: [
        {
          id: 'mapping-1',
          organizationId: 'organization-1',
          connectionId: 'connection-1',
          provider: 'qbo',
          externalEntity: 'Vendor',
          externalId: 'vendor-1',
          direction: 'inbound',
          displayName: 'Acme',
          syncToken: '7',
          isActive: true,
          isDeleted: false,
          mergedIntoExternalId: null,
          payload: vendor,
        },
      ],
      request: jest.fn(async () => ({ data: { QueryResponse: { Vendor: [vendor] } } })),
    });

    await harness.instance.syncNow('organization-1', ['Vendor']);

    expect(
      harness.inserted.filter((values) => values.entityType === 'external_entity_mapping'),
    ).toEqual([]);
  });

  it('uses CDC-supported request parameters, excludes tax entities, and stores transaction tombstones', async () => {
    const request = jest.fn(
      async ({ path, query }: { path: string; query?: Record<string, unknown> }) => {
        expect(path).toBe('cdc');
        const entityName = String(query?.entities);
        expect([
          'Account',
          'Vendor',
          'Class',
          'Department',
          'Customer',
          'Term',
          'Bill',
          'Invoice',
          'Payment',
          'BillPayment',
          'PurchaseOrder',
        ]).toContain(entityName);
        expect(entityName).not.toBe('TaxCode');
        expect(entityName).not.toBe('TaxRate');
        expect(query?.changedSince).toEqual(expect.any(String));
        expect(query).not.toHaveProperty('startposition');
        expect(query).not.toHaveProperty('maxresults');
        const queryResponse =
          entityName === 'Vendor'
            ? { Vendor: [{ Id: 'vendor-1', Name: 'Acme', SyncToken: '9' }] }
            : entityName === 'Bill'
              ? { DeletedObject: [{ EntityName: 'Bill', Id: 'bill-1' }] }
              : {};
        return {
          data: {
            CDCResponse: [
              {
                QueryResponse: queryResponse,
              },
            ],
          },
        };
      },
    );
    const harness = service({ request });

    const result = await harness.instance.runCdcSweep('organization-1');

    expect(result).toMatchObject({ imported: 1, tombstones: 1 });
    expect(request).toHaveBeenCalledTimes(11);
    expect(harness.inserted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalEntity: 'Vendor',
          externalId: 'vendor-1',
          isDeleted: false,
        }),
        expect.objectContaining({
          externalEntity: 'Bill',
          externalId: 'bill-1',
          localEntity: 'qbo_transaction',
          isDeleted: true,
          isActive: false,
        }),
      ]),
    );
    expect(harness.inserted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'external_entity_mapping',
          metadata: expect.objectContaining({ source: 'cdc' }),
        }),
      ]),
    );
    expect(harness.oauthRedis.withLock).toHaveBeenCalledWith(
      'qbo-sync:organization-1',
      expect.any(Function),
    );
  });

  it('falls back to a full catalog snapshot when CDC reaches its response limit', async () => {
    const cdcRows = Array.from({ length: 1_000 }, (_, index) => ({
      Id: `account-cdc-${index}`,
      Name: `Account ${index}`,
      AccountType: 'Expense',
    }));
    const request = jest.fn(
      async ({ path, query }: { path: string; query?: Record<string, unknown> }) => {
        if (path === 'cdc') {
          expect(query).not.toHaveProperty('startposition');
          expect(query).not.toHaveProperty('maxresults');
          if (query?.entities === 'Account') {
            return { data: { CDCResponse: [{ QueryResponse: { Account: cdcRows } }] } };
          }
          return { data: { CDCResponse: [] } };
        }

        expect(path).toBe('query');
        expect(String(query?.query)).toContain('FROM Account');
        return {
          data: {
            QueryResponse: {
              Account: [{ Id: 'account-authoritative', Name: 'Cash', AccountType: 'Expense' }],
            },
          },
        };
      },
    );
    const harness = service({ request });

    const result = await harness.instance.runCdcSweep('organization-1');

    expect(result.imported).toBe(1);
    expect(request.mock.calls.filter(([input]) => input.path === 'query')).toHaveLength(1);
    expect(harness.inserted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalEntity: 'Account',
          externalId: 'account-authoritative',
          localEntity: 'gl_account',
        }),
      ]),
    );
    expect(harness.inserted).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ externalId: 'account-cdc-0' })]),
    );
  });

  it('keeps returned transaction tombstones but does not advance sync after CDC overflow', async () => {
    const deletedRows = Array.from({ length: 1_000 }, (_, index) => ({
      EntityName: 'Bill',
      Id: `bill-${index}`,
    }));
    const request = jest.fn(
      async ({ path, query }: { path: string; query?: Record<string, unknown> }) => {
        expect(path).toBe('cdc');
        if (query?.entities === 'Bill') {
          return { data: { CDCResponse: [{ QueryResponse: { DeletedObject: deletedRows } }] } };
        }
        return { data: { CDCResponse: [] } };
      },
    );
    const harness = service({ request });

    await expect(harness.instance.runCdcSweep('organization-1')).rejects.toThrow(
      'sync state was not advanced',
    );

    expect(harness.inserted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalEntity: 'Bill',
          externalId: 'bill-0',
          localEntity: 'qbo_transaction',
          isDeleted: true,
          isActive: false,
        }),
      ]),
    );
    expect(harness.inserted).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityType: 'integration_connection', action: 'sync_completed' }),
      ]),
    );
    expect(harness.updates).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ lastSyncAt: expect.any(Date) })]),
    );
  });

  it('unwraps CDC query-response arrays and nested deleted objects', async () => {
    const request = jest.fn(async ({ query }: { query?: Record<string, unknown> }) => {
      if (query?.entities !== 'Bill') return { data: { CDCResponse: [] } };
      return {
        data: {
          CDCResponse: {
            QueryResponse: [
              {
                DeletedObject: [{ DeletedObject: { Name: 'Bill', Id: 'bill-2' } }],
              },
            ],
          },
        },
      };
    });
    const harness = service({ request });

    const result = await harness.instance.runCdcSweep('organization-1');

    expect(result).toMatchObject({ imported: 0, tombstones: 1 });
    expect(harness.inserted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalEntity: 'Bill',
          externalId: 'bill-2',
          isDeleted: true,
        }),
      ]),
    );
  });

  it('treats normal CDC rows with deleted status casing as tombstones', async () => {
    const request = jest.fn(async ({ query }: { query?: Record<string, unknown> }) => {
      const entityName = query?.entities;
      return {
        data: {
          CDCResponse: [
            {
              QueryResponse: {
                ...(entityName === 'Vendor'
                  ? { Vendor: [{ Id: 'vendor-deleted', Status: 'Deleted' }] }
                  : {}),
                ...(entityName === 'Bill'
                  ? { Bill: [{ Id: 'bill-deleted', status: 'deleted' }] }
                  : {}),
              },
            },
          ],
        },
      };
    });
    const harness = service({ request });

    const result = await harness.instance.runCdcSweep('organization-1');

    expect(result).toMatchObject({ imported: 0, tombstones: 2 });
    expect(harness.inserted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ externalId: 'vendor-deleted', isDeleted: true }),
        expect.objectContaining({ externalId: 'bill-deleted', isDeleted: true }),
      ]),
    );
  });

  it('remaps and alerts for CloudEvent vendor merges', async () => {
    const localVendorId = '00000000-0000-4000-8000-000000000010';
    const harness = service({
      adminId: '00000000-0000-4000-8000-000000000020',
      mappings: [
        {
          id: 'source-mapping',
          organizationId: 'organization-1',
          connectionId: 'connection-1',
          provider: 'qbo',
          externalEntity: 'Vendor',
          externalId: 'vendor-source',
          direction: 'inbound',
          localId: localVendorId,
          autoCreated: true,
        },
        {
          id: 'target-mapping',
          organizationId: 'organization-1',
          connectionId: 'connection-1',
          provider: 'qbo',
          externalEntity: 'Vendor',
          externalId: 'vendor-target',
          direction: 'inbound',
          localId: null,
          autoCreated: false,
        },
      ],
    });

    await harness.instance.processWebhookEvent({
      realmId: 'realm-1',
      entityName: 'Vendor',
      entityId: 'vendor-target',
      operation: 'merge',
      lastUpdated: '2026-08-30T00:00:00.000Z',
      payload: { deletedId: 'vendor-source' },
    });

    expect(harness.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          isDeleted: true,
          isActive: false,
          mergedIntoExternalId: 'vendor-target',
        }),
        expect.objectContaining({ localId: localVendorId, autoCreated: true }),
      ]),
    );
    expect(harness.notifications.createIdempotent).toHaveBeenCalledWith(
      'qbo-vendor-merge:organization-1:vendor-source:vendor-target',
      'organization-1',
      '00000000-0000-4000-8000-000000000020',
      'qbo_vendor_merge',
      'QuickBooks vendor merged',
      expect.stringContaining('vendor-source was merged into vendor-target'),
      'external_entity_mapping',
      'source-mapping',
    );
  });

  it('locks both current-realm vendor rows before applying a merge', async () => {
    const harness = service({
      mappings: [
        {
          id: 'source-mapping',
          organizationId: 'organization-1',
          connectionId: 'connection-1',
          provider: 'qbo',
          externalEntity: 'Vendor',
          externalId: 'vendor-source',
          direction: 'inbound',
          localId: '00000000-0000-4000-8000-000000000010',
          autoCreated: true,
          isActive: true,
          isDeleted: false,
        },
        {
          id: 'target-mapping',
          organizationId: 'organization-1',
          connectionId: 'connection-1',
          provider: 'qbo',
          externalEntity: 'Vendor',
          externalId: 'vendor-target',
          direction: 'inbound',
          localId: null,
          autoCreated: false,
          isActive: true,
          isDeleted: false,
        },
      ],
    });

    await harness.instance.processWebhookEvent({
      realmId: 'realm-1',
      entityName: 'Vendor',
      entityId: 'vendor-target',
      operation: 'merge',
      lastUpdated: '2026-08-30T00:00:00.000Z',
      payload: { deletedId: 'vendor-source' },
    });

    expect(harness.db.select).toHaveBeenCalledTimes(4);
    expect(harness.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ isDeleted: true, mergedIntoExternalId: 'vendor-target' }),
        expect.objectContaining({ localId: '00000000-0000-4000-8000-000000000010' }),
      ]),
    );
  });

  it('does not mutate old-realm vendor rows for a merge in the current realm', async () => {
    const harness = service({
      mappings: [
        {
          id: 'old-source-mapping',
          organizationId: 'organization-1',
          connectionId: 'old-connection',
          realmId: 'old-realm',
          provider: 'qbo',
          externalEntity: 'Vendor',
          externalId: 'vendor-source',
          direction: 'inbound',
          localId: '00000000-0000-4000-8000-000000000010',
          autoCreated: true,
          isActive: true,
          isDeleted: false,
        },
        {
          id: 'old-target-mapping',
          organizationId: 'organization-1',
          connectionId: 'old-connection',
          realmId: 'old-realm',
          provider: 'qbo',
          externalEntity: 'Vendor',
          externalId: 'vendor-target',
          direction: 'inbound',
          localId: null,
          autoCreated: false,
          isActive: true,
          isDeleted: false,
        },
      ],
    });

    await harness.instance.processWebhookEvent({
      realmId: 'realm-1',
      entityName: 'Vendor',
      entityId: 'vendor-target',
      operation: 'merge',
      lastUpdated: '2026-08-30T00:00:00.000Z',
      payload: { deletedId: 'vendor-source' },
    });

    expect(harness.updates).toHaveLength(0);
    expect(harness.inserted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalId: 'vendor-source',
          realmId: 'realm-1',
          isDeleted: true,
        }),
      ]),
    );
  });

  it('uses stable repeat keys when scheduling and reconciling QBO jobs', async () => {
    process.env.QBO_SYNC_INTERVAL_MS = '120000';
    process.env.QBO_CDC_CRON = '15 3 * * *';
    const harness = service();

    await harness.instance.ensureScheduledSync('organization-1');

    expect(harness.syncQueue.add).toHaveBeenCalledWith(
      'scheduled-sync',
      { kind: 'scheduled', organizationId: 'organization-1' },
      expect.objectContaining({
        jobId: 'qbo-hourly-sync-organization-1',
        repeat: { every: 120_000, key: 'qbo-hourly-sync-organization-1' },
      }),
    );
    expect(harness.cdcQueue.add).toHaveBeenCalledWith(
      'daily-cdc-sweep',
      { kind: 'cdc-sweep', organizationId: 'organization-1', lookbackDays: 30 },
      expect.objectContaining({
        jobId: 'qbo-daily-cdc-organization-1',
        repeat: { pattern: '15 3 * * *', key: 'qbo-daily-cdc-organization-1' },
      }),
    );
  });

  it('does not mutate or re-audit a duplicate vendor merge webhook', async () => {
    const source = {
      id: 'source-mapping',
      organizationId: 'organization-1',
      connectionId: 'connection-1',
      provider: 'qbo',
      externalEntity: 'Vendor',
      externalId: 'vendor-source',
      direction: 'inbound',
      localId: null,
      autoCreated: false,
      isActive: true,
      isDeleted: false,
      mergedIntoExternalId: null,
    };
    const target = {
      id: 'target-mapping',
      organizationId: 'organization-1',
      connectionId: 'connection-1',
      provider: 'qbo',
      externalEntity: 'Vendor',
      externalId: 'vendor-target',
      direction: 'inbound',
      localId: null,
      autoCreated: false,
      isActive: true,
      isDeleted: false,
      mergedIntoExternalId: null,
    };
    const harness = service({ mappings: [source, target] });
    const event = {
      realmId: 'realm-1',
      entityName: 'Vendor' as const,
      entityId: 'vendor-target',
      operation: 'merge' as const,
      lastUpdated: '2026-08-30T00:00:00.000Z',
      payload: { deletedId: 'vendor-source' },
    };

    await harness.instance.processWebhookEvent(event);
    Object.assign(source, {
      isActive: false,
      isDeleted: true,
      mergedIntoExternalId: 'vendor-target',
    });
    await harness.instance.processWebhookEvent(event);

    expect(
      harness.inserted.filter(
        (values) => values.entityType === 'external_entity_mapping' && values.action === 'merged',
      ),
    ).toHaveLength(1);
    expect(
      harness.updates.filter((values) => values.mergedIntoExternalId === 'vendor-target'),
    ).toHaveLength(1);
  });

  it('ignores a vendor merge older than either locked mapping version', async () => {
    const harness = service({
      mappings: [
        {
          id: 'source-mapping',
          organizationId: 'organization-1',
          connectionId: 'connection-1',
          realmId: 'realm-1',
          provider: 'qbo',
          externalEntity: 'Vendor',
          externalId: 'vendor-source',
          direction: 'inbound',
          localId: '00000000-0000-4000-8000-000000000010',
          isActive: true,
          isDeleted: false,
          syncedAt: new Date('2026-08-30T00:00:00.000Z'),
        },
        {
          id: 'target-mapping',
          organizationId: 'organization-1',
          connectionId: 'connection-1',
          realmId: 'realm-1',
          provider: 'qbo',
          externalEntity: 'Vendor',
          externalId: 'vendor-target',
          direction: 'inbound',
          localId: null,
          isActive: true,
          isDeleted: false,
          syncedAt: new Date('2026-08-30T00:00:00.000Z'),
        },
      ],
    });

    await harness.instance.processWebhookEvent({
      realmId: 'realm-1',
      entityName: 'Vendor',
      entityId: 'vendor-target',
      operation: 'merge',
      lastUpdated: '2026-08-29T00:00:00.000Z',
      payload: { deletedId: 'vendor-source' },
    });

    expect(harness.updates).toHaveLength(0);
    expect(harness.conflictUpdates).toHaveLength(0);
    expect(harness.notifications.createIdempotent).not.toHaveBeenCalled();
  });

  it('queues a durable merge recovery and acknowledges without an authoritative provider timestamp', async () => {
    const harness = service({
      request: jest.fn(async () => {
        throw new QboResourceNotFoundError();
      }),
    });

    await expect(
      harness.instance.processWebhookEvent({
        realmId: 'realm-1',
        entityName: 'Vendor',
        entityId: 'vendor-target',
        operation: 'merge',
        payload: { deletedId: 'vendor-source' },
      }),
    ).resolves.toBeUndefined();

    expect(harness.updates).toHaveLength(0);
    expect(harness.conflictUpdates).toHaveLength(0);
    expect(harness.notifications.createIdempotent).not.toHaveBeenCalled();
    expect(harness.cdcQueue.add).toHaveBeenCalledWith(
      'vendor-merge-recovery',
      expect.objectContaining({
        kind: 'vendor-merge-recovery',
        organizationId: 'organization-1',
        connectionId: 'connection-1',
        realmId: 'realm-1',
        sourceId: 'vendor-source',
        targetId: 'vendor-target',
      }),
      expect.objectContaining({
        attempts: 5,
        removeOnComplete: true,
        removeOnFail: false,
      }),
    );
  });

  it('retains and alerts on a vendor merge without distinct IDs instead of retrying it', async () => {
    const harness = service({ adminId: 'admin-1' });

    await expect(
      harness.instance.processWebhookEvent({
        realmId: 'realm-1',
        entityName: 'Vendor',
        entityId: 'vendor-event',
        operation: 'merge',
        payload: { DisplayName: 'Untrusted vendor payload', secret: 'must not be persisted' },
      }),
    ).resolves.toBeUndefined();

    expect(harness.request).not.toHaveBeenCalled();
    expect(harness.syncQueue.add).not.toHaveBeenCalled();
    expect(harness.cdcQueue.add).not.toHaveBeenCalled();
    expect(harness.inserted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'integration_connection',
          entityId: 'connection-1',
          action: 'vendor_merge_recovery_failed',
          changes: expect.objectContaining({
            reason: 'missing_or_invalid_merge_ids',
            sourceIdPresent: true,
            targetIdPresent: false,
          }),
          metadata: expect.objectContaining({
            connectionId: 'connection-1',
            realmId: 'realm-1',
            event: expect.objectContaining({
              entityName: 'Vendor',
              operation: 'merge',
              entityId: 'vendor-event',
              payloadKeys: ['DisplayName', 'secret'],
            }),
          }),
        }),
      ]),
    );
    expect(harness.notifications.createIdempotent).toHaveBeenCalledWith(
      expect.stringMatching(/^qbo-vendor-merge-recovery-failed:/),
      'organization-1',
      'admin-1',
      'qbo_vendor_merge_recovery_failed',
      'QuickBooks vendor merge needs attention',
      expect.stringContaining('without distinct source and target IDs'),
      'integration_connection',
      'connection-1',
    );
  });

  it('does not notify when a vendor merge arrives from a stale realm', async () => {
    const staleConnection = {
      id: 'connection-1',
      organizationId: 'organization-1',
      provider: 'qbo',
      realmId: 'old-realm',
      status: 'active',
    };
    const harness = service({
      connection: staleConnection,
      connections: [staleConnection],
      currentConnection: { ...staleConnection, realmId: 'new-realm' },
    });

    await harness.instance.processWebhookEvent({
      realmId: 'old-realm',
      entityName: 'Vendor',
      entityId: 'vendor-target',
      operation: 'merge',
      lastUpdated: '2026-08-30T00:00:00.000Z',
      payload: { deletedId: 'vendor-source' },
    });

    expect(harness.notifications.createIdempotent).not.toHaveBeenCalled();
  });

  it('preserves an existing mapping payload and name in a delete tombstone', async () => {
    const previousPayload = { Id: 'vendor-1', DisplayName: 'Acme', SyncToken: '7' };
    const harness = service({
      mappings: [
        {
          id: 'mapping-1',
          organizationId: 'organization-1',
          connectionId: 'connection-1',
          provider: 'qbo',
          externalEntity: 'Vendor',
          externalId: 'vendor-1',
          direction: 'inbound',
          displayName: 'Acme',
          syncToken: '7',
          isActive: true,
          isDeleted: false,
          mergedIntoExternalId: null,
          payload: previousPayload,
        },
      ],
    });

    await harness.instance.processWebhookEvent({
      realmId: 'realm-1',
      entityName: 'Vendor',
      entityId: 'vendor-1',
      operation: 'delete',
      lastUpdated: '2026-08-30T00:00:00.000Z',
      payload: { operation: 'Delete', lastUpdated: 'now' },
    });

    expect(harness.inserted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalEntity: 'Vendor',
          externalId: 'vendor-1',
          displayName: 'Acme',
          syncToken: '7',
          payload: previousPayload,
          isActive: false,
          isDeleted: true,
        }),
      ]),
    );
  });

  it('uses webhook metadata when creating a new delete tombstone', async () => {
    const webhookPayload = { DisplayName: 'Deleted vendor', lastUpdated: 'now' };
    const harness = service();

    await harness.instance.processWebhookEvent({
      realmId: 'realm-1',
      entityName: 'Vendor',
      entityId: 'vendor-new',
      operation: 'delete',
      lastUpdated: '2026-08-30T00:00:00.000Z',
      payload: webhookPayload,
    });

    expect(harness.inserted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalEntity: 'Vendor',
          externalId: 'vendor-new',
          displayName: 'Deleted vendor',
          payload: { ...webhookPayload, Id: 'vendor-new' },
          isDeleted: true,
        }),
      ]),
    );
  });

  it('preserves legacy vendor merge aliases', async () => {
    const localVendorId = '00000000-0000-4000-8000-000000000010';
    const harness = service({
      mappings: [
        {
          id: 'source-mapping',
          organizationId: 'organization-1',
          connectionId: 'connection-1',
          provider: 'qbo',
          externalEntity: 'Vendor',
          externalId: 'vendor-source',
          direction: 'inbound',
          localId: localVendorId,
          autoCreated: false,
        },
        {
          id: 'target-mapping',
          organizationId: 'organization-1',
          connectionId: 'connection-1',
          provider: 'qbo',
          externalEntity: 'Vendor',
          externalId: 'vendor-target',
          direction: 'inbound',
          localId: null,
          autoCreated: false,
        },
      ],
    });

    await harness.instance.processWebhookEvent({
      realmId: 'realm-1',
      entityName: 'Vendor',
      entityId: 'vendor-source',
      operation: 'merge',
      lastUpdated: '2026-08-30T00:00:00.000Z',
      payload: { mergeTo: 'vendor-target' },
    });

    expect(harness.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          isDeleted: true,
          mergedIntoExternalId: 'vendor-target',
        }),
        expect.objectContaining({ localId: localVendorId }),
      ]),
    );
  });

  it('carries a linked source vendor into a target mapping created by the merge event', async () => {
    const localVendorId = '00000000-0000-4000-8000-000000000010';
    const harness = service({
      mappings: [
        {
          id: 'source-mapping',
          organizationId: 'organization-1',
          connectionId: 'connection-1',
          provider: 'qbo',
          externalEntity: 'Vendor',
          externalId: 'vendor-source',
          direction: 'inbound',
          localId: localVendorId,
          autoCreated: true,
        },
      ],
    });

    await harness.instance.processWebhookEvent({
      realmId: 'realm-1',
      entityName: 'Vendor',
      entityId: 'vendor-target',
      operation: 'merge',
      lastUpdated: '2026-08-30T00:00:00.000Z',
      payload: { deletedId: 'vendor-source' },
    });

    expect(harness.inserted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalEntity: 'Vendor',
          externalId: 'vendor-target',
          localId: localVendorId,
          autoCreated: true,
          isDeleted: false,
        }),
      ]),
    );
    expect(
      harness.inserted.filter(
        (values) =>
          values.entityType === 'external_entity_mapping' && values.entityId === 'mapping-1',
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: null,
          metadata: expect.objectContaining({ reason: 'vendor_merge' }),
          changes: expect.objectContaining({ localId: localVendorId }),
        }),
      ]),
    );
  });

  it('writes user link changes and audits them in the same transaction', async () => {
    const localVendorId = '00000000-0000-4000-8000-000000000010';
    const userId = '00000000-0000-4000-8000-000000000011';
    const harness = service({
      mappings: [
        {
          id: 'mapping-1',
          organizationId: 'organization-1',
          connectionId: 'connection-1',
          provider: 'qbo',
          externalEntity: 'Vendor',
          externalId: 'vendor-1',
          localEntity: 'vendor',
          localId: null,
          direction: 'inbound',
          autoCreated: false,
        },
      ],
    });

    await harness.instance.linkMapping(
      'mapping-1',
      'organization-1',
      { localId: localVendorId, autoCreated: true },
      userId,
    );

    expect(harness.db.transaction).toHaveBeenCalledTimes(1);
    expect(harness.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ localId: localVendorId, autoCreated: true }),
      ]),
    );
    expect(harness.inserted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId,
          entityType: 'external_entity_mapping',
          entityId: 'mapping-1',
          action: 'linked',
          changes: expect.objectContaining({ localId: { from: null, to: localVendorId } }),
          metadata: expect.objectContaining({ actor: 'user', source: 'user' }),
        }),
      ]),
    );
  });

  it('rejects links to a missing local record without mutating or auditing the mapping', async () => {
    const harness = service({
      localRecordExists: false,
      mappings: [
        {
          id: 'mapping-1',
          organizationId: 'organization-1',
          connectionId: 'connection-1',
          provider: 'qbo',
          externalEntity: 'Vendor',
          externalId: 'vendor-1',
          localEntity: 'vendor',
          localId: null,
          direction: 'inbound',
          autoCreated: false,
        },
      ],
    });

    await expect(
      harness.instance.linkMapping('mapping-1', 'organization-1', {
        localId: '00000000-0000-4000-8000-000000000010',
      }),
    ).rejects.toThrow('valid vendor record');
    expect(harness.updates).toHaveLength(0);
    expect(harness.inserted).toHaveLength(0);
  });

  it('rejects GL links until a local chart-of-accounts record exists', async () => {
    const harness = service({
      mappings: [
        {
          id: 'mapping-1',
          organizationId: 'organization-1',
          connectionId: 'connection-1',
          provider: 'qbo',
          externalEntity: 'Account',
          externalId: 'account-1',
          localEntity: 'gl_account',
          localId: null,
          direction: 'inbound',
          autoCreated: false,
        },
      ],
    });

    await expect(
      harness.instance.linkMapping('mapping-1', 'organization-1', {
        localId: '00000000-0000-0000-0000-000000000010',
      }),
    ).rejects.toThrow('chart of accounts');
    expect(harness.updates).toHaveLength(0);
    expect(harness.inserted).toHaveLength(0);
  });
});
