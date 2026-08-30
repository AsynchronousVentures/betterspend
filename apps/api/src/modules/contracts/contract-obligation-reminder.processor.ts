import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { ContractObligationReminderService } from './contract-obligation-reminder.service';
import { CONTRACT_OBLIGATION_REMINDER_JOB_NAME } from './contract-obligation-reminder.policy';
import { CONTRACT_OBLIGATION_REMINDER_QUEUE_NAME } from '../../common/contract-obligation-reminder-queue';

@Processor(CONTRACT_OBLIGATION_REMINDER_QUEUE_NAME)
export class ContractObligationReminderProcessor extends WorkerHost {
  constructor(private readonly reminderService: ContractObligationReminderService) {
    super();
  }

  async process(job: Job<unknown>): Promise<void> {
    if (job.name !== CONTRACT_OBLIGATION_REMINDER_JOB_NAME) return;
    await this.reminderService.scanAndNotifyDueObligations();
  }
}
