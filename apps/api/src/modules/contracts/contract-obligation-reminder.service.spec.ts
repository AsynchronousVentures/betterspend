import type { Queue } from 'bullmq';
import { ContractObligationReminderService } from './contract-obligation-reminder.service';
import {
  CONTRACT_OBLIGATION_REMINDER_JOB_ID,
  CONTRACT_OBLIGATION_REMINDER_JOB_NAME,
} from './contract-obligation-reminder.policy';

const now = new Date('2026-09-23T12:00:00.000Z');
const organizationId = 'org-1';

type ReminderRow = {
  organizationId: string;
  contractOrganizationId: string;
  obligationId: string;
  contractId: string;
  contractTitle: string;
  obligationTitle: string;
  obligationDescription: string | null;
  status: string;
  dueDate: Date | null;
  notificationLeadDays: number;
  obligationOwnerId: string | null;
  obligationOwnerOrganizationId: string | null;
  contractOwnerId: string | null;
  contractOwnerOrganizationId: string | null;
  createdById: string | null;
  createdByOrganizationId: string | null;
};

function row(overrides: Partial<ReminderRow> = {}): ReminderRow {
  return {
    organizationId,
    contractOrganizationId: organizationId,
    obligationId: 'obligation-1',
    contractId: 'contract-1',
    contractTitle: 'Master services agreement',
    obligationTitle: 'Renew insurance certificate',
    obligationDescription: 'Provide a current certificate.',
    status: 'open',
    dueDate: new Date('2026-09-30T12:00:00.000Z'),
    notificationLeadDays: 7,
    obligationOwnerId: 'obligation-owner',
    obligationOwnerOrganizationId: organizationId,
    contractOwnerId: 'contract-owner',
    contractOwnerOrganizationId: organizationId,
    createdById: 'creator',
    createdByOrganizationId: organizationId,
    ...overrides,
  };
}

function serviceWith(rows: ReminderRow[]) {
  const where = jest.fn().mockResolvedValue(rows);
  const query = {
    from: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    where,
  };
  const db = { select: jest.fn().mockReturnValue(query) };
  const notifications = { createIdempotent: jest.fn().mockResolvedValue({ id: 'notice-1' }) };
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  const service = new ContractObligationReminderService(
    db as never,
    notifications as never,
    queue as unknown as Queue,
  );

  return { service, notifications, queue, where };
}

describe('ContractObligationReminderService scheduling', () => {
  it('registers one stable repeat job with retry options on startup', async () => {
    const harness = serviceWith([]);

    await harness.service.onModuleInit();
    harness.service.onModuleDestroy();

    expect(harness.queue.add).toHaveBeenCalledWith(
      CONTRACT_OBLIGATION_REMINDER_JOB_NAME,
      {},
      expect.objectContaining({
        jobId: CONTRACT_OBLIGATION_REMINDER_JOB_ID,
        attempts: 5,
        backoff: { type: 'exponential', delay: 60_000 },
        repeat: {
          every: 24 * 60 * 60 * 1000,
          key: CONTRACT_OBLIGATION_REMINDER_JOB_ID,
        },
      }),
    );
  });

  it('retries schedule registration after a temporary queue outage', async () => {
    const harness = serviceWith([]);
    harness.queue.add.mockRejectedValueOnce(new Error('Redis unavailable'));

    await harness.service.onModuleInit();
    expect(harness.queue.add).toHaveBeenCalledTimes(1);

    await harness.service['recoverSchedule']();
    harness.service.onModuleDestroy();

    expect(harness.queue.add).toHaveBeenCalledTimes(2);
  });
});

describe('ContractObligationReminderService scanning', () => {
  it('notifies eligible obligations once through the idempotent notification seam', async () => {
    const harness = serviceWith([
      row(),
      row({
        obligationId: 'obligation-2',
        obligationOwnerId: null,
        contractOwnerId: 'contract-owner',
      }),
      row({
        obligationId: 'obligation-3',
        obligationOwnerId: null,
        contractOwnerId: null,
        createdById: 'creator',
      }),
      row({ obligationId: 'closed', status: 'completed' }),
      row({ obligationId: 'no-date', dueDate: null }),
      row({
        obligationId: 'future',
        dueDate: new Date('2026-10-01T12:00:00.000Z'),
      }),
      row({
        obligationId: 'unowned',
        obligationOwnerId: null,
        contractOwnerId: null,
        createdById: null,
      }),
      row({ organizationId: 'other-org' }),
    ]);

    const result = await harness.service.scanAndNotifyDueObligations(now);

    expect(result).toEqual({ scanned: 8, notified: 3 });
    expect(harness.notifications.createIdempotent).toHaveBeenCalledTimes(3);
    expect(harness.notifications.createIdempotent).toHaveBeenNthCalledWith(
      1,
      'contract-obligation-reminder:org-1:obligation-1:2026-09-30T12:00:00.000Z:obligation-owner',
      organizationId,
      'obligation-owner',
      'contract_obligation',
      'Contract obligation due: Renew insurance certificate',
      'Master services agreement: Provide a current certificate.',
      'contract',
      'contract-1',
    );
    expect(harness.notifications.createIdempotent).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(':contract-owner'),
      organizationId,
      'contract-owner',
      expect.any(String),
      expect.any(String),
      expect.any(String),
      'contract',
      'contract-1',
    );
    expect(harness.notifications.createIdempotent).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining(':creator'),
      organizationId,
      'creator',
      expect.any(String),
      expect.any(String),
      expect.any(String),
      'contract',
      'contract-1',
    );
  });

  it('passes scope filters to the database query when extraction requests an organization and contract', async () => {
    const harness = serviceWith([]);

    await harness.service.scanAndNotifyDueObligations(now, {
      organizationId,
      contractId: 'contract-1',
    });

    expect(harness.where).toHaveBeenCalledTimes(1);
  });

  it('propagates a transient notification failure so BullMQ can retry the scan', async () => {
    const harness = serviceWith([row()]);
    harness.notifications.createIdempotent
      .mockRejectedValueOnce(new Error('notification store unavailable'))
      .mockResolvedValueOnce({ id: 'notice-1' });

    await expect(harness.service.scanAndNotifyDueObligations(now)).rejects.toThrow(
      'notification store unavailable',
    );
    await expect(harness.service.scanAndNotifyDueObligations(now)).resolves.toEqual({
      scanned: 1,
      notified: 1,
    });
    expect(harness.notifications.createIdempotent).toHaveBeenCalledTimes(2);
    expect(harness.notifications.createIdempotent.mock.calls[0]?.[0]).toBe(
      harness.notifications.createIdempotent.mock.calls[1]?.[0],
    );
  });

  it('uses one stable notification identity when the daily scan runs twice', async () => {
    const harness = serviceWith([row()]);

    await harness.service.scanAndNotifyDueObligations(now);
    await harness.service.scanAndNotifyDueObligations(now);

    expect(harness.notifications.createIdempotent).toHaveBeenCalledTimes(2);
    expect(harness.notifications.createIdempotent.mock.calls[0]?.[0]).toBe(
      harness.notifications.createIdempotent.mock.calls[1]?.[0],
    );
  });

  it('continues after an oversized obligation title and keeps every notification title valid', async () => {
    const harness = serviceWith([
      row({ obligationTitle: 'x'.repeat(255) }),
      row({ obligationId: 'later-obligation', obligationTitle: 'Later obligation' }),
    ]);
    harness.notifications.createIdempotent.mockImplementation(async (...args: unknown[]) => {
      const title = String(args[4]);
      if (Array.from(title).length > 255) throw new Error('notification title is too long');
      return { id: 'notice-1' };
    });

    await expect(harness.service.scanAndNotifyDueObligations(now)).resolves.toEqual({
      scanned: 2,
      notified: 2,
    });
    expect(harness.notifications.createIdempotent).toHaveBeenCalledTimes(2);
    expect(harness.notifications.createIdempotent.mock.calls[0]?.[4]).toBe(
      `Contract obligation due: ${'x'.repeat(230)}`,
    );
    expect(harness.notifications.createIdempotent.mock.calls[1]?.[4]).toBe(
      'Contract obligation due: Later obligation',
    );
  });

  it('falls back from inactive or deleted owners without crossing the tenant boundary', async () => {
    const harness = serviceWith([
      row({
        obligationId: 'inactive-obligation-owner',
        obligationOwnerId: 'inactive-owner',
        obligationOwnerOrganizationId: null,
        contractOwnerId: 'contract-owner',
        contractOwnerOrganizationId: organizationId,
      }),
      row({
        obligationId: 'deleted-contract-owner',
        obligationOwnerId: null,
        contractOwnerId: 'deleted-owner',
        contractOwnerOrganizationId: null,
        createdById: 'creator',
        createdByOrganizationId: organizationId,
      }),
      row({
        obligationId: 'tenant-mismatch',
        contractOrganizationId: 'other-org',
        obligationOwnerId: 'other-owner',
        obligationOwnerOrganizationId: 'other-org',
        contractOwnerId: null,
        contractOwnerOrganizationId: null,
        createdById: null,
        createdByOrganizationId: null,
      }),
    ]);

    const result = await harness.service.scanAndNotifyDueObligations(now);

    expect(result).toEqual({ scanned: 3, notified: 2 });
    expect(harness.notifications.createIdempotent).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(':contract-owner'),
      organizationId,
      'contract-owner',
      expect.any(String),
      expect.any(String),
      expect.any(String),
      'contract',
      'contract-1',
    );
    expect(harness.notifications.createIdempotent).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(':creator'),
      organizationId,
      'creator',
      expect.any(String),
      expect.any(String),
      expect.any(String),
      'contract',
      'contract-1',
    );
  });
});
