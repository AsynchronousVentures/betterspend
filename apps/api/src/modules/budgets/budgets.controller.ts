import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { BudgetsService, CreateBudgetInput } from './budgets.service';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';

@ApiTags('budgets')
@Controller('budgets')
export class BudgetsController {
  constructor(private readonly budgetsService: BudgetsService) {}

  @Get('forecast/summary')
  @ApiOperation({ summary: 'Org-level budget forecast summary' })
  @ApiQuery({ name: 'fiscalYear', required: false, type: Number })
  getForecastSummary(
    @CurrentOrgId() orgId: string,
    @Query('fiscalYear') fiscalYear?: string,
  ) {
    const year = fiscalYear ? parseInt(fiscalYear, 10) : new Date().getFullYear();
    return this.budgetsService.getForecastSummary(orgId, year);
  }

  @Get('forecast')
  @ApiOperation({ summary: 'Per-budget consumption forecast with linear regression' })
  @ApiQuery({ name: 'fiscalYear', required: false, type: Number })
  getForecast(
    @CurrentOrgId() orgId: string,
    @Query('fiscalYear') fiscalYear?: string,
  ) {
    const year = fiscalYear ? parseInt(fiscalYear, 10) : new Date().getFullYear();
    return this.budgetsService.getForecast(orgId, year);
  }

  @Get('check')
  @ApiOperation({ summary: 'Check budget availability for a department' })
  @ApiQuery({ name: 'departmentId', required: true })
  @ApiQuery({ name: 'amount', required: true })
  @ApiQuery({ name: 'fiscalYear', required: true })
  checkBudget(
    @CurrentOrgId() orgId: string,
    @Query('departmentId') departmentId: string,
    @Query('amount') amount: string,
    @Query('fiscalYear') fiscalYear: string,
  ) {
    return this.budgetsService.checkBudget(
      orgId, departmentId, parseFloat(amount), parseInt(fiscalYear, 10),
    );
  }

  @Get()
  @ApiOperation({ summary: 'List all budgets' })
  findAll(@CurrentOrgId() orgId: string, @Query('entityId') entityId?: string) {
    return this.budgetsService.findAll(orgId, entityId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get budget detail' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentOrgId() orgId: string) {
    return this.budgetsService.findOne(id, orgId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a budget with optional periods' })
  create(@Body() body: CreateBudgetInput, @CurrentOrgId() orgId: string) {
    return this.budgetsService.create(orgId, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a budget' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { name?: string; totalAmount?: number; currency?: string; entityId?: string },
    @CurrentOrgId() orgId: string,
  ) {
    return this.budgetsService.update(id, orgId, body);
  }

  @Post(':id/periods')
  @ApiOperation({ summary: 'Add a budget period' })
  addPeriod(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { periodStart: string; periodEnd: string; allocatedAmount: number },
    @CurrentOrgId() orgId: string,
  ) {
    return this.budgetsService.addPeriod(id, orgId, body);
  }

  @Delete(':id/periods/:periodId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a budget period' })
  removePeriod(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('periodId', ParseUUIDPipe) periodId: string,
    @CurrentOrgId() orgId: string,
  ) {
    return this.budgetsService.removePeriod(id, periodId, orgId);
  }
}
