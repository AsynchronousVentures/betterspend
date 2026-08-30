import { QboCdcProcessor } from './qbo-cdc.processor';

describe('QboCdcProcessor', () => {
  it('rejects forged webhook jobs before dispatching them', async () => {
    const inbound = {
      processWebhookEvent: jest.fn(),
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
      runCdcSweep: jest.fn(),
    };
    const processor = new QboCdcProcessor(inbound as never);

    await processor.process({
      data: { kind: 'cdc-sweep', organizationId: 'organization-1', lookbackDays: 7 },
    } as never);

    expect(inbound.runCdcSweep).toHaveBeenCalledWith('organization-1', 7);
  });
});
