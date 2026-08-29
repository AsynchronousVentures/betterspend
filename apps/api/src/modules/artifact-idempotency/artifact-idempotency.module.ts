import { Module } from '@nestjs/common';
import { ArtifactIdempotencyService } from './artifact-idempotency.service';

@Module({
  providers: [ArtifactIdempotencyService],
  exports: [ArtifactIdempotencyService],
})
export class ArtifactIdempotencyModule {}
