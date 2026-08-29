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
  const db = {
    query: {
      integrationConnections: {
        findFirst: jest.fn(async () => connection),
        findMany: jest.fn(async () => [connection]),
      },
      externalEntityMappings: {
        findFirst: jest.fn(async () => options.mappings?.[0] ?? null),
        findMany: jest.fn(async () => options.mappings ?? []),
      },
    },
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
        }),
      }),
      expect.objectContaining({ attempts: 5 }),
    );
    expect(harness.request).not.toHaveBeenCalled();
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
});
