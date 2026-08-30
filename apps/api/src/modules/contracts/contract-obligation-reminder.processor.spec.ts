import type { Job } from 'bullmq';
import { ContractObligationReminderProcessor } from './contract-obligation-reminder.processor';
import { CONTRACT_OBLIGATION_REMINDER_JOB_NAME } from './contract-obligation-reminder.policy';

describe('ContractObligationReminderProcessor', () => {
  it('runs the scan and lets failures reach BullMQ retry handling', async () => {
    const scan = jest.fn().mockRejectedValue(new Error('temporary failure'));
    const processor = new ContractObligationReminderProcessor({
      scanAndNotifyDueObligations: scan,
    } as never);

    await expect(
      processor.process({ name: CONTRACT_OBLIGATION_REMINDER_JOB_NAME, data: {} } as Job<unknown>),
    ).rejects.toThrow('temporary failure');
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it('ignores jobs from another name on the shared queue', async () => {
    const scan = jest.fn();
    const processor = new ContractObligationReminderProcessor({
      scanAndNotifyDueObligations: scan,
    } as never);

    await processor.process({ name: 'unexpected', data: {} } as Job<unknown>);

    expect(scan).not.toHaveBeenCalled();
  });
});
