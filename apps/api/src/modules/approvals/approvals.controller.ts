import {
  Controller, Get, Post, Param, Body, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ApprovalEngineService } from './approval-engine.service';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';

@ApiTags('approvals')
@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly approvalEngineService: ApprovalEngineService) {}

  @Get()
  @ApiOperation({ summary: 'List pending approval requests' })
  listPending(@CurrentOrgId() orgId: string) {
    return this.approvalEngineService.listPending(orgId);
  }

  @Get('auto-approved-summary')
  @ApiOperation({ summary: 'Get count and total spend of auto-approved requisitions this month' })
  getAutoApprovedSummary(@CurrentOrgId() orgId: string) {
    return this.approvalEngineService.getAutoApprovedSummary(orgId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get approval request detail' })
  getRequest(@Param('id', ParseUUIDPipe) id: string) {
    return this.approvalEngineService.getRequest(id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve a request at the current step' })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { comment?: string },
    @CurrentUserId() userId: string,
    @CurrentOrgId() orgId: string,
  ) {
    return this.approvalEngineService.processAction(id, userId, 'approve', body?.comment, orgId);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a request' })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { comment?: string },
    @CurrentUserId() userId: string,
    @CurrentOrgId() orgId: string,
  ) {
    return this.approvalEngineService.processAction(id, userId, 'reject', body?.comment, orgId);
  }
}
