import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { bootstrapInstanceSchema, type BootstrapInstanceInput } from '@betterspend/shared';
import { Public } from '../../common/decorators/public.decorator';
import { BootstrapService } from './bootstrap.service';

export function parseBootstrapInput(body: unknown): BootstrapInstanceInput {
  const parsed = bootstrapInstanceSchema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException(parsed.error.issues[0]?.message || 'Invalid bootstrap request');
  }
  return parsed.data;
}

@ApiTags('bootstrap')
@Public()
@Controller('bootstrap')
export class BootstrapController {
  constructor(private readonly bootstrapService: BootstrapService) {}

  @Post()
  @ApiOperation({ summary: 'Initialize a fresh BetterSpend instance and its first administrator' })
  initialize(@Body() body: unknown) {
    return this.bootstrapService.initialize(parseBootstrapInput(body));
  }
}
