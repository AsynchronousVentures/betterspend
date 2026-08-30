import { QboSyncProcessor } from './qbo-sync.processor';

describe('QboSyncProcessor', () => {
  it('rejects forged jobs before dispatching them', async () => {
    const inbound = {
      synchronize: jest.fn(),
      ensureScheduledSync: jest.fn(),
    };
    const processor = new QboSyncProcessor(inbound as never);

    await expect(
      processor.process({
        data: {
          kind: 'initial',
          organizationId: 'not-a-uuid',
          entityTypes: ['Vendor'],
        },
      } as never),
    ).rejects.toThrow();

    await expect(
      processor.process({
        data: {
          kind: 'initial',
          organizationId: '00000000-0000-4000-8000-000000000001',
          entityTypes: ['User'],
        },
      } as never),
    ).rejects.toThrow();

    await expect(
      processor.process({
        data: {
          kind: 'reconcile',
          organizationId: '00000000-0000-4000-8000-000000000001',
          connectionId: 'not-a-uuid',
          realmId: 'realm-1',
          entityName: 'Vendor',
        },
      } as never),
    ).rejects.toThrow();

    expect(inbound.synchronize).not.toHaveBeenCalled();
    expect(inbound.ensureScheduledSync).not.toHaveBeenCalled();
  });

  it('dispatches a validated initial sync and schedules follow-up work', async () => {
    const inbound = {
      synchronize: jest.fn(async () => undefined),
      ensureScheduledSync: jest.fn(async () => undefined),
    };
    const processor = new QboSyncProcessor(inbound as never);

    await processor.process({
      data: {
        kind: 'initial',
        organizationId: '00000000-0000-4000-8000-000000000001',
        entityTypes: ['Vendor'],
      },
    } as never);

    expect(inbound.synchronize).toHaveBeenCalledWith({
      kind: 'snapshot',
      organizationId: '00000000-0000-4000-8000-000000000001',
      entityTypes: ['Vendor'],
    });
    expect(inbound.ensureScheduledSync).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
    );
  });

  it('dispatches a validated scheduled sync without re-registering schedules', async () => {
    const inbound = {
      synchronize: jest.fn(async () => undefined),
      ensureScheduledSync: jest.fn(async () => undefined),
    };
    const processor = new QboSyncProcessor(inbound as never);

    await processor.process({
      data: { kind: 'scheduled', organizationId: '00000000-0000-4000-8000-000000000001' },
    } as never);

    expect(inbound.synchronize).toHaveBeenCalledWith({
      kind: 'snapshot',
      organizationId: '00000000-0000-4000-8000-000000000001',
      entityTypes: undefined,
    });
    expect(inbound.ensureScheduledSync).not.toHaveBeenCalled();
  });

  it('dispatches a validated catalog reconciliation with its connection fence', async () => {
    const inbound = {
      synchronize: jest.fn(),
      ensureScheduledSync: jest.fn(),
      reconcileCatalogWebhook: jest.fn(async () => undefined),
    };
    const processor = new QboSyncProcessor(inbound as never);

    await processor.process({
      data: {
        kind: 'reconcile',
        organizationId: '00000000-0000-4000-8000-000000000001',
        connectionId: '00000000-0000-4000-8000-000000000002',
        realmId: 'realm-1',
        entityName: 'TaxRate',
      },
    } as never);

    expect(inbound.reconcileCatalogWebhook).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      'realm-1',
      'TaxRate',
    );
    expect(inbound.synchronize).not.toHaveBeenCalled();
  });

  it('rejects unknown fields and empty entity selections', async () => {
    const inbound = {
      synchronize: jest.fn(),
      ensureScheduledSync: jest.fn(),
      reconcileCatalogWebhook: jest.fn(),
    };
    const processor = new QboSyncProcessor(inbound as never);

    await expect(
      processor.process({
        data: {
          kind: 'scheduled',
          organizationId: '00000000-0000-4000-8000-000000000001',
          unexpected: true,
        },
      } as never),
    ).rejects.toThrow();
    await expect(
      processor.process({
        data: {
          kind: 'initial',
          organizationId: '00000000-0000-4000-8000-000000000001',
          entityTypes: [],
        },
      } as never),
    ).rejects.toThrow();
    await expect(
      processor.process({
        data: {
          kind: 'reconcile',
          organizationId: '00000000-0000-4000-8000-000000000001',
          connectionId: '00000000-0000-4000-8000-000000000002',
          realmId: 'realm-1',
          entityName: 'User',
        },
      } as never),
    ).rejects.toThrow();
    expect(inbound.synchronize).not.toHaveBeenCalled();
    expect(inbound.reconcileCatalogWebhook).not.toHaveBeenCalled();
  });
});
