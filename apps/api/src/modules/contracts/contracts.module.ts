import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { DocumentsModule } from '../documents/documents.module';
import { ContractObligationReminderService } from './contract-obligation-reminder.service';
import { ContractObligationReminderProcessor } from './contract-obligation-reminder.processor';
import { CONTRACT_OBLIGATION_REMINDER_QUEUE_NAME } from '../../common/contract-obligation-reminder-queue';
import {
  CONTRACT_DOCUMENT_EXTRACTOR,
  ContractDocumentExtractorService,
} from './contract-document-extractor';

@Module({
  imports: [
    DocumentsModule,
    BullModule.registerQueue({ name: CONTRACT_OBLIGATION_REMINDER_QUEUE_NAME }),
  ],
  controllers: [ContractsController],
  providers: [
    ContractsService,
    ContractDocumentExtractorService,
    { provide: CONTRACT_DOCUMENT_EXTRACTOR, useExisting: ContractDocumentExtractorService },
    ContractObligationReminderService,
    ContractObligationReminderProcessor,
  ],
  exports: [ContractsService],
})
export class ContractsModule {}
