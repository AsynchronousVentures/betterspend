import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import { Public } from '../../common/decorators/public.decorator';
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

  @Get('address')
  @ApiOperation({ summary: 'Get the organization inbound email address' })
  address(@CurrentOrgId() orgId: string, @CurrentUserId() userId: string) {
    return this.emailIntakeService.getInboundAddress(orgId, userId);
  }

  @Public()
  @Post('ses-receipt')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Queue a secret-authenticated SES receipt notification' })
  sesReceipt(@Body() body: unknown, @Headers('x-email-intake-secret') secret: string | undefined) {
    return this.emailIntakeService.enqueueSesReceipt(body, secret);
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
  discard(@Param('id', ParseUUIDPipe) id: string, @CurrentOrgId() orgId: string) {
    return this.emailIntakeService.discard(id, orgId);
  }
}
