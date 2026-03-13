import { Module } from '@nestjs/common';
import { SpendGuardController } from './spend-guard.controller';
import { SpendGuardService } from './spend-guard.service';

@Module({
  controllers: [SpendGuardController],
  providers: [SpendGuardService],
  exports: [SpendGuardService],
})
export class SpendGuardModule {}
