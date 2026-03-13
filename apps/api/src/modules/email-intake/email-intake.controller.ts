import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { EmailIntakeService } from './email-intake.service';

@ApiTags('email-intake')
@Controller('email-intake')
export class EmailIntakeController {
  constructor(private readonly emailIntakeService: EmailIntakeService) {}

  @Get()
  @ApiOperation({ summary: 'List email intake items awaiting review' })
  list(@CurrentOrgId() orgId: string) {
    return this.emailIntakeService.list(orgId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a manual email intake item for review' })
  create(
    @CurrentOrgId() orgId: string,
    @Body() body: { sourceEmail: string; subject: string; body: string },
  ) {
    return this.emailIntakeService.create(orgId, body);
  }

  @Post(':id/discard')
  @ApiOperation({ summary: 'Discard an intake item' })
  discard(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrgId() orgId: string,
  ) {
    return this.emailIntakeService.discard(id, orgId);
  }
}
