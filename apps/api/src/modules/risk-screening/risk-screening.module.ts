import { Module } from '@nestjs/common';
import { RiskScreeningController } from './risk-screening.controller';
import { RiskScreeningService } from './risk-screening.service';
import { AuditModule } from '../audit/audit.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [AuditModule, SettingsModule],
  controllers: [RiskScreeningController],
  providers: [RiskScreeningService],
  exports: [RiskScreeningService],
})
export class RiskScreeningModule {}
