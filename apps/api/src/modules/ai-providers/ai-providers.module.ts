import { Module } from '@nestjs/common';
import { AiProvidersController } from './ai-providers.controller';
import { AiProvidersService } from './ai-providers.service';
import { AiRuntimeService } from './ai-runtime.service';
import { CredentialCryptoService } from './credential-crypto.service';

@Module({
  controllers: [AiProvidersController],
  providers: [AiProvidersService, AiRuntimeService, CredentialCryptoService],
  exports: [AiRuntimeService, AiProvidersService],
})
export class AiProvidersModule {}
