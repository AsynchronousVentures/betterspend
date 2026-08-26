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
          vendor: { id: 'vendor-1', name: 'Acme Supplies', organizationId },
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
      vendor: { columns: { id: true, name: true, organizationId: true } },
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
          vendor: { id: 'vendor-2', name: 'Other Org Supplies', organizationId: 'organization-2' },
        },
        lines: [],
      },
    ]);

    await expect(service.findAll(organizationId)).resolves.toMatchObject([
      { id: 'grn-1', purchaseOrder: null },
    ]);
  });

  it('does not expose a vendor that is outside the receipt organization', async () => {
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
          vendor: {
            id: 'vendor-other-org',
            name: 'Other Org Supplies',
            organizationId: 'organization-2',
          },
        },
        lines: [],
      },
    ]);

    await expect(service.findAll(organizationId)).resolves.toMatchObject([
      { id: 'grn-1', purchaseOrder: { id: 'po-1', vendor: null } },
    ]);
  });

  it('recomputes PO receipt status after cancelling and excludes cancelled quantities', async () => {
    const findReceipt = jest
      .fn()
      .mockResolvedValueOnce({
        id: 'grn-1',
        organizationId,
        status: 'confirmed',
        purchaseOrder: { id: 'po-1', number: 'PO-2026-0001', organizationId, vendor: null },
        lines: [],
      })
      .mockResolvedValueOnce({
        id: 'grn-1',
        organizationId,
        status: 'cancelled',
        purchaseOrder: { id: 'po-1', number: 'PO-2026-0001', organizationId, vendor: null },
        lines: [],
      });
    const lockedPurchaseOrder = {
      id: 'po-1',
      status: 'received',
      issuedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const findPoLines = jest.fn().mockResolvedValue([{ id: 'po-line-1', quantity: '10' }]);
    const findReceipts = jest.fn().mockResolvedValue([
      {
        status: 'cancelled',
        lines: [{ poLineId: 'po-line-1', quantityReceived: '10' }],
      },
    ]);
    const updateWhere = jest.fn().mockResolvedValue([]);
    const updateSet = jest.fn(() => ({ where: updateWhere }));
    const lockedFor = jest.fn().mockResolvedValue([lockedPurchaseOrder]);
    const selectWhere = jest.fn(() => ({ for: lockedFor }));
    const selectFrom = jest.fn(() => ({ where: selectWhere }));
    const transaction = jest.fn(async (callback: (tx: unknown) => unknown) =>
      callback({
        query: {
          poLines: { findMany: findPoLines },
          goodsReceipts: { findMany: findReceipts },
        },
        select: jest.fn(() => ({ from: selectFrom })),
        update: jest.fn(() => ({ set: updateSet })),
      }),
    );
    const db = {
      query: {
        goodsReceipts: { findFirst: findReceipt },
      },
      update: jest.fn(() => ({ set: updateSet })),
      transaction,
    };
    const service = new ReceivingService(
      db as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.cancelGrn('grn-1', organizationId);

    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'issued' }));
    expect(lockedFor).toHaveBeenCalledWith('update');
  });
});
