import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { BootstrapInstanceDto } from './bootstrap.dto';
import { BootstrapService } from './bootstrap.service';

@ApiTags('bootstrap')
@Public()
@Controller('bootstrap')
export class BootstrapController {
  constructor(private readonly bootstrapService: BootstrapService) {}

  @Post()
  @ApiOperation({ summary: 'Initialize a fresh BetterSpend instance and its first administrator' })
  initialize(@Body() body: BootstrapInstanceDto) {
    return this.bootstrapService.initialize(body);
  }
}
