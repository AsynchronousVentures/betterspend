import { ReceivingService } from './receiving.service';

describe('ReceivingService response context', () => {
  const organizationId = 'organization-1';

  function createService() {
    const findMany = jest.fn();
    const db = { query: { goodsReceipts: { findMany } } };
    const service = new ReceivingService(
      db as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { findMany, service };
  }

  it('includes a scoped purchase-order and vendor summary in list rows', async () => {
    const { findMany, service } = createService();
    findMany.mockResolvedValue([
      {
        id: 'grn-1',
        number: 'GRN-2026-0001',
        organizationId,
        purchaseOrder: {
          id: 'po-1',
          number: 'PO-2026-0001',
          organizationId,
          vendor: { id: 'vendor-1', name: 'Acme Supplies' },
        },
        lines: [],
      },
    ]);

    await expect(service.findAll(organizationId)).resolves.toMatchObject([
      {
        id: 'grn-1',
        purchaseOrder: {
          id: 'po-1',
          number: 'PO-2026-0001',
          vendor: { id: 'vendor-1', name: 'Acme Supplies' },
        },
      },
    ]);

    const options = findMany.mock.calls[0][0] as {
      with: { lines: boolean; purchaseOrder: { columns: Record<string, boolean>; with: unknown } };
      where: (table: { organizationId: string }, operators: { eq: jest.Mock }) => unknown;
    };
    expect(options.with.lines).toBe(true);
    expect(options.with.purchaseOrder.columns).toMatchObject({
      id: true,
      number: true,
      organizationId: true,
    });
    expect(options.with.purchaseOrder.with).toEqual({
      vendor: { columns: { id: true, name: true } },
    });

    const eq = jest.fn((column: string, value: string) => ({ column, value }));
    options.where({ organizationId: 'organization-column' }, { eq });
    expect(eq).toHaveBeenCalledWith('organization-column', organizationId);
  });

  it('does not expose a relation that is outside the receipt organization', async () => {
    const { findMany, service } = createService();
    findMany.mockResolvedValue([
      {
        id: 'grn-1',
        number: 'GRN-2026-0001',
        organizationId,
        purchaseOrder: {
          id: 'po-other-org',
          number: 'PO-OTHER-ORG',
          organizationId: 'organization-2',
          vendor: { id: 'vendor-2', name: 'Other Org Supplies' },
        },
        lines: [],
      },
    ]);

    await expect(service.findAll(organizationId)).resolves.toMatchObject([
      { id: 'grn-1', purchaseOrder: null },
    ]);
  });
});
