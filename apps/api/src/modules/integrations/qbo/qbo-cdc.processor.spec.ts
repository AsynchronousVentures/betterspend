import { QboCdcProcessor } from './qbo-cdc.processor';

describe('QboCdcProcessor', () => {
  it('rejects forged webhook jobs before dispatching them', async () => {
    const inbound = {
      processWebhookEvent: jest.fn(),
      runCdcRecovery: jest.fn(),
      processVendorMergeRecovery: jest.fn(),
      runCdcSweep: jest.fn(),
    };
    const processor = new QboCdcProcessor(inbound as never);

    await expect(
      processor.process({
        data: {
          kind: 'webhook',
          event: {
            realmId: 'realm-1',
            entityName: 'User',
            entityId: 'user-1',
            operation: 'delete',
            payload: {},
          },
        },
      } as never),
    ).rejects.toThrow();
    expect(inbound.processWebhookEvent).not.toHaveBeenCalled();
  });

  it('dispatches a valid CDC sweep after runtime validation', async () => {
    const inbound = {
      processWebhookEvent: jest.fn(),
      runCdcRecovery: jest.fn(),
      processVendorMergeRecovery: jest.fn(),
      runCdcSweep: jest.fn(),
    };
    const processor = new QboCdcProcessor(inbound as never);

    await processor.process({
      data: { kind: 'cdc-sweep', organizationId: 'organization-1', lookbackDays: 7 },
    } as never);

    expect(inbound.runCdcSweep).toHaveBeenCalledWith('organization-1', 7);
  });

  it('dispatches a validated CDC recovery without broadening its realm', async () => {
    const inbound = {
      processWebhookEvent: jest.fn(),
      runCdcRecovery: jest.fn(async () => undefined),
      processVendorMergeRecovery: jest.fn(),
      runCdcSweep: jest.fn(),
    };
    const processor = new QboCdcProcessor(inbound as never);

    await processor.process({
      data: {
        kind: 'cdc-recovery',
        organizationId: 'organization-1',
        connectionId: 'connection-1',
        realmId: 'realm-1',
        lookbackDays: 7,
      },
    } as never);

    expect(inbound.runCdcRecovery).toHaveBeenCalledWith(
      'organization-1',
      'connection-1',
      'realm-1',
      7,
    );
    expect(inbound.runCdcSweep).not.toHaveBeenCalled();
  });

  it('dispatches a validated vendor merge recovery with its full identity', async () => {
    const inbound = {
      processWebhookEvent: jest.fn(),
      runCdcRecovery: jest.fn(),
      processVendorMergeRecovery: jest.fn(async () => undefined),
      runCdcSweep: jest.fn(),
    };
    const processor = new QboCdcProcessor(inbound as never);

    await processor.process({
      data: {
        kind: 'vendor-merge-recovery',
        organizationId: 'organization-1',
        connectionId: 'connection-1',
        realmId: 'realm-1',
        sourceId: 'vendor-source',
        targetId: 'vendor-target',
      },
    } as never);

    expect(inbound.processVendorMergeRecovery).toHaveBeenCalledWith({
      kind: 'vendor-merge-recovery',
      organizationId: 'organization-1',
      connectionId: 'connection-1',
      realmId: 'realm-1',
      sourceId: 'vendor-source',
      targetId: 'vendor-target',
    });
  });

  it('rejects recovery jobs missing their connection and realm fence', async () => {
    const inbound = {
      processWebhookEvent: jest.fn(),
      runCdcRecovery: jest.fn(),
      processVendorMergeRecovery: jest.fn(),
      runCdcSweep: jest.fn(),
    };
    const processor = new QboCdcProcessor(inbound as never);

    await expect(
      processor.process({
        data: { kind: 'cdc-recovery', organizationId: 'organization-1' },
      } as never),
    ).rejects.toThrow();
    expect(inbound.runCdcRecovery).not.toHaveBeenCalled();
  });
});
