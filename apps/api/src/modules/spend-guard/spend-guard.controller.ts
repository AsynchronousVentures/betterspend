import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import { SpendGuardService } from './spend-guard.service';

@ApiTags('spend-guard')
@Controller('spend-guard')
export class SpendGuardController {
  constructor(private readonly spendGuardService: SpendGuardService) {}

  @Get('alerts')
  @ApiOperation({ summary: 'List spend guard alerts' })
  list(
    @CurrentOrgId() orgId: string,
    @Query('status') status?: 'open' | 'dismissed' | 'escalated' | 'all',
  ) {
    return this.spendGuardService.list(orgId, status ?? 'open');
  }

  @Patch('alerts/:id')
  @ApiOperation({ summary: 'Dismiss or escalate a spend guard alert' })
  update(
    @Param('id') id: string,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @Body() body: { status: 'dismissed' | 'escalated'; note?: string },
  ) {
    return this.spendGuardService.updateStatus(id, orgId, userId, body.status, body.note);
  }
}
