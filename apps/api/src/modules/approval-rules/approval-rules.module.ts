import { Module } from '@nestjs/common';
import { ApprovalRulesController } from './approval-rules.controller';
import { ApprovalRulesService } from './approval-rules.service';
import { EntitiesModule } from '../entities/entities.module';

@Module({
  imports: [EntitiesModule],
  controllers: [ApprovalRulesController],
  providers: [ApprovalRulesService],
  exports: [ApprovalRulesService],
})
export class ApprovalRulesModule {}
