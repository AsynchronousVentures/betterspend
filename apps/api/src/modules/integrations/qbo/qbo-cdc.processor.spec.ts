import { QboCdcProcessor } from './qbo-cdc.processor';

describe('QboCdcProcessor', () => {
  it('rejects transaction webhook jobs before dispatching them', async () => {
    const inbound = {
      synchronize: jest.fn(),
      processVendorMergeRecovery: jest.fn(),
    };
    const processor = new QboCdcProcessor(inbound as never);

    await expect(
      processor.process({
        data: {
          kind: 'webhook',
          event: {
            realmId: 'realm-1',
            entityName: 'Bill',
            entityId: 'bill-1',
            operation: 'delete',
            payload: {},
          },
        },
      } as never),
    ).rejects.toThrow();
    expect(inbound.synchronize).not.toHaveBeenCalled();
  });

  it('dispatches a valid CDC sweep after runtime validation', async () => {
    const inbound = {
      synchronize: jest.fn(),
      processVendorMergeRecovery: jest.fn(),
    };
    const processor = new QboCdcProcessor(inbound as never);

    await processor.process({
      data: {
        kind: 'cdc-sweep',
        organizationId: '00000000-0000-4000-8000-000000000001',
        lookbackDays: 7,
      },
    } as never);

    expect(inbound.synchronize).toHaveBeenCalledWith({
      kind: 'cdc',
      organizationId: '00000000-0000-4000-8000-000000000001',
      lookbackDays: 7,
    });
  });

  it('rejects a non-UUID organization boundary', async () => {
    const inbound = { synchronize: jest.fn(), processVendorMergeRecovery: jest.fn() };
    const processor = new QboCdcProcessor(inbound as never);

    await expect(
      processor.process({
        data: { kind: 'cdc-sweep', organizationId: 'not-a-uuid' },
      } as never),
    ).rejects.toThrow();
    expect(inbound.synchronize).not.toHaveBeenCalled();
  });

  it('dispatches a validated vendor merge recovery with its full identity', async () => {
    const inbound = {
      synchronize: jest.fn(),
      processVendorMergeRecovery: jest.fn(async () => undefined),
    };
    const processor = new QboCdcProcessor(inbound as never);

    await processor.process({
      data: {
        kind: 'vendor-merge-recovery',
        organizationId: '00000000-0000-4000-8000-000000000001',
        connectionId: '00000000-0000-4000-8000-000000000002',
        realmId: 'realm-1',
        sourceId: 'vendor-source',
        targetId: 'vendor-target',
      },
    } as never);

    expect(inbound.processVendorMergeRecovery).toHaveBeenCalledWith({
      kind: 'vendor-merge-recovery',
      organizationId: '00000000-0000-4000-8000-000000000001',
      connectionId: '00000000-0000-4000-8000-000000000002',
      realmId: 'realm-1',
      sourceId: 'vendor-source',
      targetId: 'vendor-target',
    });
  });

  it('rejects recovery jobs missing their connection and realm fence', async () => {
    const inbound = {
      synchronize: jest.fn(),
      processVendorMergeRecovery: jest.fn(),
    };
    const processor = new QboCdcProcessor(inbound as never);

    await expect(
      processor.process({
        data: {
          kind: 'vendor-merge-recovery',
          organizationId: '00000000-0000-4000-8000-000000000001',
          sourceId: 'vendor-source',
          targetId: 'vendor-target',
        },
      } as never),
    ).rejects.toThrow();
    expect(inbound.processVendorMergeRecovery).not.toHaveBeenCalled();
  });
});
