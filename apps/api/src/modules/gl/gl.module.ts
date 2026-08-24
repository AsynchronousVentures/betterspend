import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { GlMappingsService } from './gl-mappings.service';
import { GlExportService } from './gl-export.service';
import { GlController } from './gl.controller';
import { GlExportProcessor } from './gl-export.processor';
import { OAuthService } from './oauth.service';
import { AiProvidersModule } from '../ai-providers/ai-providers.module';
import { OAuthRedisService } from './oauth-redis.service';

@Global()
@Module({
  imports: [BullModule.registerQueue({ name: 'gl-export' }), AiProvidersModule],
  controllers: [GlController],
  providers: [GlMappingsService, GlExportService, GlExportProcessor, OAuthService, OAuthRedisService],
  exports: [GlExportService, OAuthService],
})
export class GlModule {}
