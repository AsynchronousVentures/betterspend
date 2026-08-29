import { createHmac } from 'node:crypto';
import {
  QboInboundService,
  verifyQboWebhookSignature,
  type QboCdcJobData,
  type QboSyncJobData,
} from './qbo-inbound.service';

function queue() {
  return {
    add: jest.fn(async (name: string, data: QboSyncJobData | QboCdcJobData) => ({
      id: `${name}-job`,
      data,
    })),
  };
}

function database(options: {
  connection?: Record<string, unknown>;
  mappings?: Record<string, unknown>[];
  adminId?: string;
}) {
  const inserted: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const connection = options.connection ?? {
    id: 'connection-1',
    organizationId: 'organization-1',
    provider: 'qbo',
    realmId: 'realm-1',
    status: 'active',
  };
  let mappingIndex = 0;
  const db = {
    query: {
      integrationConnections: {
        findFirst: jest.fn(async () => connection),
        findMany: jest.fn(async () => [connection]),
      },
      externalEntityMappings: {
        findFirst: jest.fn(async () => options.mappings?.[mappingIndex++] ?? null),
        findMany: jest.fn(async () => options.mappings ?? []),
      },
    },
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        innerJoin: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(async () => (options.adminId ? [{ id: options.adminId }] : [])),
          })),
        })),
      })),
    })),
    insert: jest.fn(() => ({
      values: jest.fn((values: Record<string, unknown>) => {
        inserted.push(values);
        return {
          onConflictDoUpdate: jest.fn(async () => undefined),
        };
      }),
    })),
    update: jest.fn(() => ({
      set: jest.fn((values: Record<string, unknown>) => {
        updates.push(values);
        return {
          where: jest.fn(async () => undefined),
          returning: jest.fn(async () => [{ ...values, id: 'mapping-1' }]),
        };
      }),
    })),
  };
  return { db, inserted, updates };
}

function service(
  options: {
    connection?: Record<string, unknown>;
    mappings?: Record<string, unknown>[];
    adminId?: string;
    request?: jest.Mock;
  } = {},
) {
  const harness = database(options);
  const syncQueue = queue();
  const cdcQueue = queue();
  const request = options.request ?? jest.fn();
  const notifications = { createIdempotent: jest.fn(async () => undefined) };
  const instance = new QboInboundService(
    harness.db as never,
    { request } as never,
    notifications as never,
    syncQueue as never,
    cdcQueue as never,
  );
  return { ...harness, instance, request, syncQueue, cdcQueue, notifications };
}

describe('QboInboundService', () => {
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

    expect(result.imported).toBe(2);
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
  });

  it('polls CDC in 1000-object pages, excludes tax entities, and stores transaction tombstones', async () => {
    const request = jest.fn(
      async ({ path, query }: { path: string; query?: Record<string, unknown> }) => {
        expect(path).toBe('cdc');
        expect(query?.maxresults).toBe(1000);
        expect(String(query?.entities)).not.toContain('TaxCode');
        expect(String(query?.entities)).not.toContain('TaxRate');
        return {
          data: {
            CDCResponse: [
              {
                QueryResponse: {
                  Vendor: [{ Id: 'vendor-1', Name: 'Acme', SyncToken: '9' }],
                  TaxCode: [{ Id: 'tax-1', Name: 'Sales Tax' }],
                  DeletedObject: [{ EntityName: 'Bill', Id: 'bill-1' }],
                },
              },
            ],
          },
        };
      },
    );
    const harness = service({ request });

    const result = await harness.instance.runCdcSweep('organization-1');

    expect(result).toMatchObject({ imported: 1, tombstones: 1 });
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
  });

  it('unwraps CDC query-response arrays and nested deleted objects', async () => {
    const request = jest.fn(async () => ({
      data: {
        CDCResponse: {
          QueryResponse: [
            {
              DeletedObject: [{ DeletedObject: { Name: 'Bill', Id: 'bill-2' } }],
            },
          ],
        },
      },
    }));
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
    const request = jest.fn(async () => ({
      data: {
        CDCResponse: [
          {
            QueryResponse: {
              Vendor: [{ Id: 'vendor-deleted', Status: 'Deleted' }],
              Bill: [{ Id: 'bill-deleted', status: 'deleted' }],
            },
          },
        ],
      },
    }));
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
          externalId: 'vendor-source',
          localId: localVendorId,
          autoCreated: true,
        },
        {
          id: 'target-mapping',
          externalId: 'vendor-target',
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

  it('preserves legacy vendor merge aliases', async () => {
    const localVendorId = '00000000-0000-4000-8000-000000000010';
    const harness = service({
      mappings: [
        {
          id: 'source-mapping',
          externalId: 'vendor-source',
          localId: localVendorId,
          autoCreated: false,
        },
        {
          id: 'target-mapping',
          externalId: 'vendor-target',
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
});
