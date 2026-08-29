import { Module } from '@nestjs/common';
import { AiProvidersModule } from '../ai-providers/ai-providers.module';
import { EntitiesModule } from '../entities/entities.module';
import { WorkflowDefinitionsController } from './workflow-definitions.controller';
import {
  createWorkflowDraftLeaseRedis,
  WORKFLOW_DRAFT_LEASE_REDIS,
  WorkflowDraftLeaseService,
} from './workflow-draft-lease.service';
import { WorkflowAssistantService } from './workflow-assistant.service';
import { WorkflowDefinitionsService } from './workflow-definitions.service';

@Module({
  imports: [EntitiesModule, AiProvidersModule],
  controllers: [WorkflowDefinitionsController],
  providers: [
    {
      provide: WORKFLOW_DRAFT_LEASE_REDIS,
      useFactory: createWorkflowDraftLeaseRedis,
    },
    WorkflowDraftLeaseService,
    WorkflowAssistantService,
    WorkflowDefinitionsService,
  ],
  exports: [WorkflowDefinitionsService],
})
export class WorkflowDefinitionsModule {}
