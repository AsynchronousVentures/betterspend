import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { BudgetsService, CreateBudgetInput } from './budgets.service';
import type { BudgetEnforcementMode, PendingRequisitionPolicy } from './budget-enforcement';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import { CurrentAccess } from '../auth/current-access.decorator';
import type { AccessPolicy } from '../auth/access-policy';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('budgets')
@Controller('budgets')
export class BudgetsController {
  constructor(private readonly budgetsService: BudgetsService) {}

  @Get('forecast/summary')
  @Permissions('budgets:view')
  @ApiOperation({ summary: 'Org-level budget forecast summary' })
  @ApiQuery({ name: 'fiscalYear', required: false, type: Number })
  getForecastSummary(
    @CurrentOrgId() orgId: string,
    @Query('fiscalYear') fiscalYear?: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    const year = fiscalYear ? parseInt(fiscalYear, 10) : new Date().getFullYear();
    return this.budgetsService.getForecastSummary(
      orgId,
      year,
      access?.scopeFor('budget', 'budgets:view'),
    );
  }

  @Get('forecast')
  @Permissions('budgets:view')
  @ApiOperation({ summary: 'Per-budget consumption forecast with linear regression' })
  @ApiQuery({ name: 'fiscalYear', required: false, type: Number })
  getForecast(
    @CurrentOrgId() orgId: string,
    @Query('fiscalYear') fiscalYear?: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    const year = fiscalYear ? parseInt(fiscalYear, 10) : new Date().getFullYear();
    return this.budgetsService.getForecast(
      orgId,
      year,
      access?.scopeFor('budget', 'budgets:view'),
    );
  }

  @Get('check')
  @Permissions('budgets:view')
  @ApiOperation({ summary: 'Check budget availability for a department' })
  @ApiQuery({ name: 'departmentId', required: true })
  @ApiQuery({ name: 'amount', required: true })
  @ApiQuery({ name: 'fiscalYear', required: true })
  checkBudget(
    @CurrentOrgId() orgId: string,
    @Query('departmentId') departmentId: string,
    @Query('amount') amount: string,
    @Query('fiscalYear') fiscalYear: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.budgetsService.checkBudget(
      orgId,
      departmentId,
      parseFloat(amount),
      parseInt(fiscalYear, 10),
      access?.scopeFor('budget', 'budgets:view'),
    );
  }

  @Get()
  @Permissions('budgets:view')
  @ApiOperation({ summary: 'List all budgets' })
  findAll(
    @CurrentOrgId() orgId: string,
    @Query('entityId') entityId?: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.budgetsService.findAll(
      orgId,
      entityId,
      access?.scopeFor('budget', 'budgets:view'),
    );
  }

  @Get(':id')
  @Permissions('budgets:view')
  @ApiOperation({ summary: 'Get budget detail' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.budgetsService.findOne(id, orgId, access?.scopeFor('budget', 'budgets:view'));
  }

  @Post()
  @Permissions('budgets:manage')
  @ApiOperation({ summary: 'Create a budget with optional periods' })
  create(
    @Body() body: CreateBudgetInput,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.budgetsService.create(
      orgId,
      userId,
      body,
      access?.scopeFor('budget', 'budgets:manage'),
    );
  }

  @Patch(':id')
  @Permissions('budgets:manage')
  @ApiOperation({ summary: 'Update a budget' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      name?: string;
      totalAmount?: number;
      currency?: string;
      entityId?: string;
      enforcementMode?: BudgetEnforcementMode | null;
      pendingRequisitionPolicy?: PendingRequisitionPolicy | null;
    },
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.budgetsService.update(
      id,
      orgId,
      userId,
      body,
      access?.scopeFor('budget', 'budgets:manage'),
    );
  }

  @Post(':id/periods')
  @Permissions('budgets:manage')
  @ApiOperation({ summary: 'Add a budget period' })
  addPeriod(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { periodStart: string; periodEnd: string; allocatedAmount: number },
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.budgetsService.addPeriod(
      id,
      orgId,
      body,
      access?.scopeFor('budget', 'budgets:manage'),
    );
  }

  @Delete(':id/periods/:periodId')
  @Permissions('budgets:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a budget period' })
  removePeriod(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('periodId', ParseUUIDPipe) periodId: string,
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.budgetsService.removePeriod(
      id,
      periodId,
      orgId,
      access?.scopeFor('budget', 'budgets:manage'),
    );
  }
}
