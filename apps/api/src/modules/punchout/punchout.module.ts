import { Module } from '@nestjs/common';
import { PunchoutService } from './punchout.service';
import { PunchoutController } from './punchout.controller';
import { AiProvidersModule } from '../ai-providers/ai-providers.module';

@Module({
  imports: [AiProvidersModule],
  controllers: [PunchoutController],
  providers: [PunchoutService],
  exports: [PunchoutService],
})
export class PunchoutModule {}
