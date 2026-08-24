import type { Db } from '@betterspend/db';
import { GlExportService } from './gl-export.service';

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
          return { where: jest.fn(async () => undefined) };
        }),
      })),
    } as unknown as Db;
    const mappings = {
      findByGlAccount: jest.fn(async () => ({
        externalAccountCode: '6100',
        externalAccountName: 'Software',
      })),
    };
    const oauth = { getQboToken: jest.fn(async () => null) };
    const queue = { add: jest.fn(async () => undefined) };
    const service = new GlExportService(db, mappings as never, oauth as never, queue as never);

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
});
