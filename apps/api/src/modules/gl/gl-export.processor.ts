import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { GlExportService, GlTargetSystem } from './gl-export.service';

export interface GlAnyJobData {
  organizationId: string;
  invoiceId: string;
  targetSystem: GlTargetSystem;
}

@Processor('gl-export')
export class GlExportProcessor extends WorkerHost {
  private readonly logger = new Logger(GlExportProcessor.name);

  constructor(private readonly glExportService: GlExportService) {
    super();
  }

  async process(job: Job<GlAnyJobData>): Promise<void> {
    const { organizationId, invoiceId, targetSystem } = job.data;
    this.logger.log(`Processing GL export job for invoice ${invoiceId} -> ${targetSystem}`);
    await this.glExportService.processExport(organizationId, invoiceId, targetSystem);
  }
}
