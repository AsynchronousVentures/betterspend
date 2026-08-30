import { QboSyncProcessor } from './qbo-sync.processor';

describe('QboSyncProcessor', () => {
  it('rejects forged jobs before dispatching them', async () => {
    const inbound = {
      syncNow: jest.fn(),
      ensureScheduledSync: jest.fn(),
    };
    const processor = new QboSyncProcessor(inbound as never);

    await expect(
      processor.process({
        data: {
          kind: 'initial',
          organizationId: 'o'.repeat(256),
          entityTypes: ['Vendor'],
        },
      } as never),
    ).rejects.toThrow();

    await expect(
      processor.process({
        data: {
          kind: 'initial',
          organizationId: 'organization-1',
          entityTypes: ['User'],
        },
      } as never),
    ).rejects.toThrow();

    expect(inbound.syncNow).not.toHaveBeenCalled();
    expect(inbound.ensureScheduledSync).not.toHaveBeenCalled();
  });

  it('dispatches a validated initial sync and schedules follow-up work', async () => {
    const inbound = {
      syncNow: jest.fn(async () => undefined),
      ensureScheduledSync: jest.fn(async () => undefined),
    };
    const processor = new QboSyncProcessor(inbound as never);

    await processor.process({
      data: { kind: 'initial', organizationId: 'organization-1', entityTypes: ['Vendor'] },
    } as never);

    expect(inbound.syncNow).toHaveBeenCalledWith('organization-1', ['Vendor']);
    expect(inbound.ensureScheduledSync).toHaveBeenCalledWith('organization-1');
  });

  it('dispatches a validated scheduled sync without re-registering schedules', async () => {
    const inbound = {
      syncNow: jest.fn(async () => undefined),
      ensureScheduledSync: jest.fn(async () => undefined),
    };
    const processor = new QboSyncProcessor(inbound as never);

    await processor.process({
      data: { kind: 'scheduled', organizationId: 'organization-1' },
    } as never);

    expect(inbound.syncNow).toHaveBeenCalledWith('organization-1', undefined);
    expect(inbound.ensureScheduledSync).not.toHaveBeenCalled();
  });

  it('rejects unknown fields and empty entity selections', async () => {
    const inbound = {
      syncNow: jest.fn(),
      ensureScheduledSync: jest.fn(),
    };
    const processor = new QboSyncProcessor(inbound as never);

    await expect(
      processor.process({
        data: { kind: 'scheduled', organizationId: 'organization-1', unexpected: true },
      } as never),
    ).rejects.toThrow();
    await expect(
      processor.process({
        data: { kind: 'initial', organizationId: 'organization-1', entityTypes: [] },
      } as never),
    ).rejects.toThrow();
    expect(inbound.syncNow).not.toHaveBeenCalled();
  });
});
