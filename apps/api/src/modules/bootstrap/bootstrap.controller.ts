import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { bootstrapInstanceSchema } from '@betterspend/shared';
import { Public } from '../../common/decorators/public.decorator';
import { BootstrapService } from './bootstrap.service';

@ApiTags('bootstrap')
@Public()
@Controller('bootstrap')
export class BootstrapController {
  constructor(private readonly bootstrapService: BootstrapService) {}

  @Post()
  @ApiOperation({ summary: 'Initialize a fresh BetterSpend instance and its first administrator' })
  initialize(@Body() body: unknown) {
    return this.bootstrapService.initialize(bootstrapInstanceSchema.parse(body));
  }
}
