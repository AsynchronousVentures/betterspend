import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { ApprovalDelegationsService } from './approval-delegations.service';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import { Authenticated } from '../../common/decorators/authenticated.decorator';

@ApiTags('approval-delegations')
@Authenticated()
@Controller('approval-delegations')
export class ApprovalDelegationsController {
  constructor(private readonly service: ApprovalDelegationsService) {}

  @Get()
  @ApiOperation({ summary: 'List delegations for org' })
  @ApiQuery({ name: 'active', required: false, type: Boolean })
  list(@CurrentOrgId() orgId: string, @Query('active') active?: string) {
    const activeOnly = active === 'true' || active === '1';
    return this.service.list(orgId, activeOnly || undefined);
  }

  @Get('my')
  @ApiOperation({ summary: 'Get delegations I set up (as delegator)' })
  my(@CurrentOrgId() orgId: string, @CurrentUserId() userId: string) {
    return this.service.myDelegations(orgId, userId);
  }

  @Get('delegate-for-me')
  @ApiOperation({ summary: 'Get delegations where I am the delegatee' })
  delegateForMe(@CurrentOrgId() orgId: string, @CurrentUserId() userId: string) {
    return this.service.delegateForMe(orgId, userId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new delegation' })
  create(
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @Body() body: { delegateeId: string; startDate: string; endDate: string; reason?: string },
  ) {
    return this.service.create(orgId, userId, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel / deactivate a delegation' })
  cancel(
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.cancel(orgId, id, userId);
  }
}
