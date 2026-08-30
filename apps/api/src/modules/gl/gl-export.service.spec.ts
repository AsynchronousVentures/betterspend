import { PgDialect } from 'drizzle-orm/pg-core';
import { and, eq, or } from 'drizzle-orm';
import { syncRecords, type Db } from '@betterspend/db';
import { GlExportService } from './gl-export.service';
import { QboConnectionRequiredError } from './qbo-client.service';

const noExternalMappings = { resolve: jest.fn(async () => null) };

function invoiceExportHarness(
  lines: Array<{
    lineNumber: string;
    description: string;
    quantity: string;
    unitPrice: string;
    totalPrice: string;
    glAccount: string | null;
  }>,
  qboMappings: Record<string, { id: string; externalId: string; displayName: string } | null> = {},
  xeroMappings: Record<
    string,
    { externalAccountCode: string; externalAccountName: string } | null
  > = {},
  departmentId: string | null = null,
  qboDefaultMapping: { id: string; externalId: string; displayName: string } | null = null,
) {
  const updates: Array<Record<string, unknown>> = [];
  const db = {
    query: {
      invoices: {
        findFirst: jest.fn(async () => ({
          id: 'invoice-1',
          organizationId: 'organization-1',
          internalNumber: 'INV-2026-0001',
          invoiceNumber: 'VENDOR-100',
          invoiceDate: new Date('2026-08-01T00:00:00Z'),
          dueDate: new Date('2026-09-01T00:00:00Z'),
          currency: 'USD',
          totalAmount: '75.00',
          vendor: { name: 'Example Vendor' },
          lines,
          purchaseOrder: departmentId ? { requisition: { departmentId } } : null,
        })),
      },
    },
    insert: jest.fn(() => ({
      values: jest.fn(() => ({
        onConflictDoUpdate: jest.fn(() => ({
          returning: jest.fn(async () => [{ id: 'record-1', status: 'pending' }]),
        })),
      })),
    })),
    update: jest.fn(() => ({
      set: jest.fn((values: Record<string, unknown>) => {
        updates.push(values);
        return {
          where: jest.fn(() => ({
            returning: jest.fn(async () => [{ id: 'record-1' }]),
          })),
        };
      }),
    })),
  } as unknown as Db;
  const externalMappings = {
    resolve: jest.fn(
      async ({ localId, fallbackToDefault }: { localId: string; fallbackToDefault?: boolean }) =>
        qboMappings[localId] ?? (fallbackToDefault ? qboDefaultMapping : null),
    ),
    resolveMany: jest.fn(async ({ localIds }: { localIds: readonly string[] }) => {
      const mappings = new Map<
        string,
        { id: string; externalId: string; displayName: string; source: 'linked' }
      >();
      for (const localId of localIds) {
        const mapping = qboMappings[localId];
        if (mapping) mappings.set(localId, { ...mapping, source: 'linked' });
      }
      return mappings;
    }),
  };
  const glMappings = {
    findByGlAccount: jest.fn(
      async (_organizationId: string, localId: string) => xeroMappings[localId] ?? null,
    ),
  };
  const qboClient = {
    request: jest.fn(async () => ({
      connectionId: 'connection-1',
      data: { Bill: { Id: 'qbo-bill-1' } },
    })),
  };
  const oauth = {
    getXeroToken: jest.fn(async () => ({ connectionId: 'connection-1' })),
  };
  const xeroClient = {
    request: jest.fn(async () => ({
      connectionId: 'connection-1',
      data: { Invoices: [{ InvoiceID: 'xero-invoice-1' }] },
    })),
  };
  const service = new GlExportService(
    db,
    glMappings as never,
    oauth as never,
    qboClient as never,
    { add: jest.fn() } as never,
    xeroClient as never,
    externalMappings as never,
  );
  return { service, updates, externalMappings, qboClient, xeroClient };
}

describe('GlExportService', () => {
  it('does not mark a disconnected QBO export as synced or exported', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const db = {
      query: {
        invoices: {
          findFirst: jest.fn(async () => ({
            id: '00000000-0000-0000-0000-000000000101',
            organizationId: '00000000-0000-0000-0000-000000000001',
            internalNumber: 'INV-2026-0001',
            invoiceNumber: 'VENDOR-100',
            invoiceDate: new Date('2026-08-01T00:00:00Z'),
            dueDate: new Date('2026-09-01T00:00:00Z'),
            currency: 'USD',
            totalAmount: '50.00',
            vendor: { name: 'Example Vendor' },
            lines: [
              {
                lineNumber: '1',
                description: 'Subscription',
                quantity: '1',
                unitPrice: '50.00',
                totalPrice: '50.00',
                glAccount: '6100',
              },
            ],
          })),
        },
      },
      insert: jest.fn(() => ({
        values: jest.fn(() => ({
          onConflictDoUpdate: jest.fn(() => ({
            returning: jest.fn(async () => [
              { id: '00000000-0000-0000-0000-000000000201', status: 'pending' },
            ]),
          })),
        })),
      })),
      update: jest.fn(() => ({
        set: jest.fn((values: Record<string, unknown>) => {
          updates.push(values);
          return {
            where: jest.fn(() => ({
              returning: jest.fn(async () => [{ id: 'record-1' }]),
            })),
          };
        }),
      })),
    } as unknown as Db;
    const mappings = {
      findByGlAccount: jest.fn(async () => ({
        externalAccountCode: '6100',
        externalAccountName: 'Software',
      })),
    };
    const externalMappings = {
      resolve: jest.fn(async () => ({
        id: 'mapping-1',
        externalId: '6100',
        displayName: 'Software',
        source: 'linked' as const,
      })),
      resolveMany: jest.fn(
        async () =>
          new Map([
            [
              '6100',
              {
                id: 'mapping-1',
                externalId: '6100',
                displayName: 'Software',
                source: 'linked' as const,
              },
            ],
          ]),
      ),
    };
    const oauth = {};
    const qboClient = {
      request: jest.fn(async () => Promise.reject(new QboConnectionRequiredError())),
    };
    const queue = { add: jest.fn(async () => undefined) };
    const service = new GlExportService(
      db,
      mappings as never,
      oauth as never,
      qboClient as never,
      queue as never,
      {} as never,
      externalMappings as never,
    );

    await service.processExport(
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000101',
      'qbo',
    );

    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'pending', errorMessage: 'QBO is not connected' }),
      ]),
    );
    expect(updates).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 'synced' })]),
    );
    expect(updates).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 'exported' })]),
    );
  });

  it('persists an explicit QBO error and sends no provider request for mixed lines', async () => {
    const harness = invoiceExportHarness(
      [
        {
          lineNumber: '1',
          description: 'Mapped line',
          quantity: '1',
          unitPrice: '50.00',
          totalPrice: '50.00',
          glAccount: '6100',
        },
        {
          lineNumber: '2',
          description: 'Unmapped line',
          quantity: '1',
          unitPrice: '25.00',
          totalPrice: '25.00',
          glAccount: '6200',
        },
      ],
      { '6100': { id: 'mapping-1', externalId: 'qbo-account-1', displayName: 'Travel' } },
    );

    await harness.service.processExport('organization-1', 'invoice-1', 'qbo');

    expect(harness.qboClient.request).not.toHaveBeenCalled();
    expect(harness.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'failed',
          errorCode: 'UNMAPPED_GL_ACCOUNT',
          errorMessage: expect.stringContaining('GL account 6200'),
        }),
      ]),
    );
    const payloadUpdate = harness.updates.find((values) => values.payload);
    expect(payloadUpdate).toEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          lines: expect.arrayContaining([
            expect.objectContaining({ externalAccountCode: 'qbo-account-1', unmapped: false }),
            expect.objectContaining({ glAccount: '6200', unmapped: true }),
          ]),
        }),
      }),
    );
  });

  it('uses the linked generic QBO Account identity for every mapped line', async () => {
    const harness = invoiceExportHarness(
      [
        {
          lineNumber: '1',
          description: 'Travel',
          quantity: '1',
          unitPrice: '50.00',
          totalPrice: '50.00',
          glAccount: '6100',
        },
      ],
      { '6100': { id: 'mapping-1', externalId: 'qbo-account-42', displayName: 'Travel' } },
    );

    await harness.service.processExport('organization-1', 'invoice-1', 'qbo');

    expect(harness.externalMappings.resolveMany).toHaveBeenCalledWith({
      organizationId: 'organization-1',
      provider: 'qbo',
      direction: 'inbound',
      externalEntity: 'Account',
      localEntity: 'gl_account',
      localIds: ['6100'],
    });
    expect(harness.qboClient.request).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          Line: [
            expect.objectContaining({
              AccountBasedExpenseLineDetail: { AccountRef: { value: 'qbo-account-42' } },
            }),
          ],
        }),
      }),
    );
    expect(harness.updates).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 'synced' })]),
    );
  });

  it('resolves distinct QBO GL accounts with one batched lookup', async () => {
    const harness = invoiceExportHarness(
      [
        {
          lineNumber: '1',
          description: 'Travel',
          quantity: '1',
          unitPrice: '50.00',
          totalPrice: '50.00',
          glAccount: '6100',
        },
        {
          lineNumber: '2',
          description: 'Software',
          quantity: '1',
          unitPrice: '25.00',
          totalPrice: '25.00',
          glAccount: '6200',
        },
        {
          lineNumber: '3',
          description: 'Another trip',
          quantity: '1',
          unitPrice: '10.00',
          totalPrice: '10.00',
          glAccount: '6100',
        },
      ],
      {
        '6100': { id: 'mapping-1', externalId: 'qbo-account-42', displayName: 'Travel' },
        '6200': { id: 'mapping-2', externalId: 'qbo-account-43', displayName: 'Software' },
      },
    );

    await harness.service.processExport('organization-1', 'invoice-1', 'qbo');

    expect(harness.externalMappings.resolveMany).toHaveBeenCalledTimes(1);
    expect(harness.externalMappings.resolveMany).toHaveBeenCalledWith(
      expect.objectContaining({ localIds: ['6100', '6200'] }),
    );
    expect(harness.externalMappings.resolve).not.toHaveBeenCalled();
    expect(harness.qboClient.request).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          Line: [
            expect.objectContaining({
              AccountBasedExpenseLineDetail: { AccountRef: { value: 'qbo-account-42' } },
            }),
            expect.objectContaining({
              AccountBasedExpenseLineDetail: { AccountRef: { value: 'qbo-account-43' } },
            }),
            expect.objectContaining({
              AccountBasedExpenseLineDetail: { AccountRef: { value: 'qbo-account-42' } },
            }),
          ],
        }),
      }),
    );
  });

  it('applies the QBO Class default for the purchase order department', async () => {
    const harness = invoiceExportHarness(
      [
        {
          lineNumber: '1',
          description: 'Travel',
          quantity: '1',
          unitPrice: '50.00',
          totalPrice: '50.00',
          glAccount: '6100',
        },
      ],
      { '6100': { id: 'mapping-1', externalId: 'qbo-account-42', displayName: 'Travel' } },
      {},
      'department-1',
      { id: 'class-mapping-1', externalId: 'qbo-class-7', displayName: 'Operations' },
    );

    await harness.service.processExport('organization-1', 'invoice-1', 'qbo');

    expect(harness.externalMappings.resolve).toHaveBeenCalledWith({
      organizationId: 'organization-1',
      provider: 'qbo',
      direction: 'inbound',
      externalEntity: 'Class',
      localEntity: 'department',
      localId: 'department-1',
      fallbackToDefault: true,
    });
    expect(harness.qboClient.request).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          Line: [
            expect.objectContaining({
              AccountBasedExpenseLineDetail: {
                AccountRef: { value: 'qbo-account-42' },
                ClassRef: { value: 'qbo-class-7' },
              },
            }),
          ],
        }),
      }),
    );
  });

  it('blocks QBO export when a purchase order department has no Class mapping', async () => {
    const harness = invoiceExportHarness(
      [
        {
          lineNumber: '1',
          description: 'Travel',
          quantity: '1',
          unitPrice: '50.00',
          totalPrice: '50.00',
          glAccount: '6100',
        },
      ],
      { '6100': { id: 'mapping-1', externalId: 'qbo-account-42', displayName: 'Travel' } },
      {},
      'department-1',
    );

    await harness.service.processExport('organization-1', 'invoice-1', 'qbo');

    expect(harness.qboClient.request).not.toHaveBeenCalled();
    expect(harness.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'failed',
          errorCode: 'UNMAPPED_QBO_CLASS',
          errorMessage: expect.stringContaining('department department-1'),
        }),
      ]),
    );
  });

  it('keeps Xero partial-line behavior unchanged', async () => {
    const harness = invoiceExportHarness(
      [
        {
          lineNumber: '1',
          description: 'Mapped line',
          quantity: '1',
          unitPrice: '50.00',
          totalPrice: '50.00',
          glAccount: '6100',
        },
        {
          lineNumber: '2',
          description: 'Unmapped line',
          quantity: '1',
          unitPrice: '25.00',
          totalPrice: '25.00',
          glAccount: '6200',
        },
      ],
      {},
      { '6100': { externalAccountCode: '200', externalAccountName: 'Travel' } },
    );

    await harness.service.processExport('organization-1', 'invoice-1', 'xero');

    expect(harness.xeroClient.request).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          Invoices: [expect.objectContaining({ LineItems: [expect.anything()] })],
        }),
      }),
    );
    expect(harness.updates).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 'synced' })]),
    );
  });

  it('journals payload construction failures as failed attempts', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const db = {
      query: { invoices: { findFirst: jest.fn(async () => null) } },
      insert: jest.fn(() => ({
        values: jest.fn(() => ({
          onConflictDoUpdate: jest.fn(() => ({
            returning: jest.fn(async () => [{ id: 'record-1', status: 'pending' }]),
          })),
        })),
      })),
      update: jest.fn(() => ({
        set: jest.fn((values: Record<string, unknown>) => {
          updates.push(values);
          return {
            where: jest.fn(() => ({
              returning: jest.fn(async () => [{ id: 'record-1' }]),
            })),
          };
        }),
      })),
    } as unknown as Db;
    const service = new GlExportService(
      db,
      {} as never,
      {} as never,
      {} as never,
      { add: jest.fn() } as never,
      {} as never,
      noExternalMappings as never,
    );

    await expect(
      service.processExport(
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000101',
        'qbo',
      ),
    ).rejects.toThrow('Invoice 00000000-0000-0000-0000-000000000101 not found');
    expect(updates).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 'failed' })]),
    );
  });

  it('scopes invoice journal lookups to the authenticated organization', async () => {
    let predicate: unknown;
    const db = {
      query: {
        syncRecords: {
          findMany: jest.fn(async (options: { where: (row: object, ops: object) => unknown }) => {
            const row = {
              organizationId: 'organizationId',
              direction: 'direction',
              localEntity: 'localEntity',
              localId: 'localId',
            };
            predicate = options.where(row, {
              and: (...parts: unknown[]) => ['and', ...parts],
              eq: (left: unknown, right: unknown) => ['eq', left, right],
              or: (...parts: unknown[]) => ['or', ...parts],
            });
            return [];
          }),
        },
      },
    } as unknown as Db;
    const service = new GlExportService(
      db,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      noExternalMappings as never,
    );

    await service.findJobsForInvoice('invoice-1', 'organization-1');

    expect(predicate).toEqual(expect.arrayContaining([['eq', 'organizationId', 'organization-1']]));
  });

  it('does not expose the internal export payload through journal list endpoints', async () => {
    const db = {
      query: {
        syncRecords: {
          findMany: jest.fn(async () => [
            {
              id: 'record-1',
              provider: 'qbo',
              localId: 'invoice-1',
              syncedAt: null,
              payload: { vendorName: 'Private vendor' },
            },
          ]),
        },
      },
    } as unknown as Db;
    const service = new GlExportService(
      db,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      noExternalMappings as never,
    );

    const [record] = await service.findJobsForInvoice('invoice-1', 'organization-1');

    expect(record).not.toHaveProperty('payload');
  });

  it('rejects scoped export triggers for invoices outside the granted scope', async () => {
    const queue = { add: jest.fn() };
    const db = {
      execute: jest.fn(async () => []),
    } as unknown as Db;
    const service = new GlExportService(
      db,
      {} as never,
      {} as never,
      {} as never,
      queue as never,
      {} as never,
      noExternalMappings as never,
    );
    const scope = {
      organizationId: 'organization-1',
      userId: 'user-1',
      unrestricted: false,
      ownOnly: false,
      departmentIds: ['department-1'],
      projectIds: [],
      entityIds: [],
    };

    await expect(
      service.enqueue('organization-1', 'invoice-outside-scope', 'qbo', undefined, scope),
    ).rejects.toThrow('outside your access scope');
    expect(queue.add).not.toHaveBeenCalled();
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('fails closed for own-only invoice scopes without an owner column', async () => {
    const execute = jest.fn(async (..._args: unknown[]) => []);
    const queue = { add: jest.fn() };
    const db = { execute } as unknown as Db;
    const service = new GlExportService(
      db,
      {} as never,
      {} as never,
      {} as never,
      queue as never,
      {} as never,
      noExternalMappings as never,
    );
    const scope = {
      organizationId: 'organization-1',
      userId: 'user-1',
      unrestricted: false,
      ownOnly: true,
      departmentIds: ['department-1'],
      projectIds: [],
      entityIds: [],
    };

    await expect(
      service.enqueue('organization-1', 'invoice-own-only', 'qbo', undefined, scope),
    ).rejects.toThrow('outside your access scope');
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0]?.[0] as never);
    expect(query.sql).toContain('false');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('keeps scoped journal lists filtered in SQL without materializing invoice IDs', async () => {
    let predicate: unknown;
    const findMany = jest.fn(
      async (options: {
        where: (
          record: typeof syncRecords,
          operators: { and: typeof and; eq: typeof eq; or: typeof or },
        ) => unknown;
      }) => {
        predicate = options.where(syncRecords, { and, eq, or });
        return [];
      },
    );
    const db = {
      query: { syncRecords: { findMany } },
    } as unknown as Db;
    const service = new GlExportService(
      db,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      noExternalMappings as never,
    );
    const scope = {
      organizationId: 'organization-1',
      userId: 'user-1',
      unrestricted: false,
      ownOnly: false,
      departmentIds: ['department-1'],
      projectIds: [],
      entityIds: [],
    };

    await service.findAll('organization-1', scope);

    const query = new PgDialect().sqlToQuery(predicate as never);
    expect(query.sql).toContain('SELECT i.id');
    expect(query.sql).toContain('department_id');
    expect(query.params).toContain('department-1');
  });

  it('lets only the active attempt record a successful delivery', async () => {
    let predicate: unknown;
    const db = {
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn((condition: unknown) => {
            predicate = condition;
          }),
        })),
      })),
    } as unknown as Db;
    const service = new GlExportService(
      db,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      noExternalMappings as never,
    );

    await (
      service as unknown as {
        markRecord: (id: string, attemptId: string, values: { status: 'synced' }) => Promise<void>;
      }
    ).markRecord('record-1', '00000000-0000-0000-0000-000000000001', { status: 'synced' });

    const query = new PgDialect().sqlToQuery(predicate as never);
    expect(query.sql).toContain('"attempt_id" =');
    expect(query.sql).toContain('"status" <>');
  });

  it('does not let a stale delivery move a synced record back into an active state', async () => {
    const invoiceLookup = jest.fn();
    const db = {
      query: { invoices: { findFirst: invoiceLookup } },
      insert: jest.fn(() => ({
        values: jest.fn(() => ({
          onConflictDoUpdate: jest.fn(() => ({
            returning: jest.fn(async () => [{ id: 'record-1', status: 'queued' }]),
          })),
        })),
      })),
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({ returning: jest.fn(async () => []) })),
        })),
      })),
    } as unknown as Db;
    const service = new GlExportService(
      db,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      noExternalMappings as never,
    );

    await service.processExport('organization-1', 'invoice-1', 'qbo');

    expect(invoiceLookup).not.toHaveBeenCalled();
  });
});
