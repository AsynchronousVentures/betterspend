import { Module } from '@nestjs/common';
import { RiskScreeningController } from './risk-screening.controller';
import { RiskScreeningService } from './risk-screening.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  controllers: [RiskScreeningController],
  providers: [RiskScreeningService],
  exports: [RiskScreeningService],
})
export class RiskScreeningModule {}
