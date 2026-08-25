import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { EmailIntakeService, type EmailIntakeJobData } from './email-intake.service';

@Processor('email-intake')
export class EmailIntakeProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailIntakeProcessor.name);

  constructor(private readonly emailIntakeService: EmailIntakeService) {
    super();
  }

  async process(job: Job<EmailIntakeJobData>): Promise<void> {
    this.logger.log(`Processing email intake job ${job.id ?? 'without id'}`);
    await this.emailIntakeService.processSesReceipt(job.data);
  }
}
