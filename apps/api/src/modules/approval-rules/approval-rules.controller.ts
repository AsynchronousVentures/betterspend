import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ApprovalRulesService, CreateApprovalRuleInput, UpdateApprovalRuleInput, ApprovalRuleSimulationInput } from './approval-rules.service';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('approval-rules')
@Controller('approval-rules')
export class ApprovalRulesController {
  constructor(private readonly approvalRulesService: ApprovalRulesService) {}

  @Get()
  @ApiOperation({ summary: 'List all approval rules' })
  findAll(@CurrentOrgId() orgId: string, @Query('entityId') entityId?: string) {
    return this.approvalRulesService.findAll(orgId, entityId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get approval rule detail' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentOrgId() orgId: string) {
    return this.approvalRulesService.findOne(id, orgId);
  }

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Create an approval rule with steps' })
  create(@Body() body: CreateApprovalRuleInput, @CurrentOrgId() orgId: string) {
    return this.approvalRulesService.create(orgId, body);
  }

  @Post('simulate')
  @Roles('admin')
  @ApiOperation({ summary: 'Simulate approval rule matching for a hypothetical request' })
  simulate(@Body() body: ApprovalRuleSimulationInput, @CurrentOrgId() orgId: string) {
    return this.approvalRulesService.simulate(orgId, body);
  }

  @Patch(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Update approval rule metadata' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateApprovalRuleInput,
    @CurrentOrgId() orgId: string,
  ) {
    return this.approvalRulesService.update(id, orgId, body);
  }

  @Delete(':id')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate an approval rule' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentOrgId() orgId: string) {
    return this.approvalRulesService.remove(id, orgId);
  }
}
