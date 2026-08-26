import { Controller, ForbiddenException, Get, Post, Delete, Res, Query, Body, Param, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Response } from 'express';
import { ReportsService } from './reports.service';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { CurrentAccess } from '../auth/current-access.decorator';
import type { AccessPolicy } from '../auth/access-policy';
import { intersectScopes, type ScopeConstraint } from '../auth/scope-sql';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('reports')
@Permissions('reports:view')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  private reportExportScope(access?: AccessPolicy): ScopeConstraint | undefined {
    return intersectScopes(
      access?.scopeFor('report', 'reports:view'),
      access?.scopeFor('report', 'reports:export'),
    );
  }

  // ─── Custom Report Builder ──────────────────────────────────────────────

  @Get('custom')
  @ApiOperation({ summary: 'Run a custom report' })
  @ApiQuery({ name: 'reportType', required: true, enum: ['spend_by_vendor', 'spend_by_department', 'spend_by_category', 'po_status_summary', 'invoice_aging', 'approval_cycle_time'] })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'groupBy', required: false, enum: ['month', 'quarter', 'vendor', 'department'] })
  @ApiQuery({ name: 'format', required: false, enum: ['json', 'csv'] })
  async runCustomReport(
    @CurrentOrgId() orgId: string,
    @Res() res: Response,
    @Query('reportType') reportType: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('groupBy') groupBy?: string,
    @Query('format') format?: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    const isCsv = format === 'csv';
    if (isCsv && !access?.can('reports:export')) {
      throw new ForbiddenException('CSV report export requires reports:export permission');
    }
    const reportScope = isCsv
      ? this.reportExportScope(access)
      : access?.scopeFor('report', 'reports:view');
    const rows = await this.reportsService.runCustomReport(orgId, {
      reportType,
      startDate,
      endDate,
      groupBy,
    }, reportScope);

    if (isCsv) {
      const csv = this.reportsService.toCsvPublic(rows);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${reportType}-${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.send(csv);
    }

    return res.json(rows);
  }

  // ─── Saved Reports ──────────────────────────────────────────────────────

  @Get('saved')
  @Permissions('reports:view')
  @ApiOperation({ summary: 'List saved report configurations' })
  async listSavedReports(@CurrentOrgId() orgId: string) {
    return this.reportsService.listSavedReports(orgId);
  }

  @Post('saved')
  @Permissions('reports:view')
  @ApiOperation({ summary: 'Save a report configuration' })
  async saveReport(
    @Body() body: { name: string; reportType: string; filters: Record<string, unknown>; groupBy?: string },
    @CurrentOrgId() orgId: string,
  ) {
    return this.reportsService.saveReport(orgId, body);
  }

  @Delete('saved/:id')
  @Permissions('reports:view')
  @ApiOperation({ summary: 'Delete a saved report configuration' })
  async deleteSavedReport(@Param('id') id: string, @CurrentOrgId() orgId: string) {
    const deleted = await this.reportsService.deleteSavedReport(orgId, id);
    if (!deleted) throw new NotFoundException('Saved report not found');
    return { success: true };
  }

  // ─── Existing CSV exports (preserved) ───────────────────────────────────

  @Get('purchase-orders/csv')
  @Permissions('reports:export', 'reports:view')
  @ApiOperation({ summary: 'Export purchase orders as CSV' })
  @ApiQuery({ name: 'status', required: false })
  async exportPOs(
    @CurrentOrgId() orgId: string,
    @Res() res: Response,
    @Query('status') status?: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    const csv = await this.reportsService.exportPOs(
      orgId,
      status,
      this.reportExportScope(access),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="purchase-orders.csv"');
    res.send(csv);
  }

  @Get('invoices/csv')
  @Permissions('reports:export', 'reports:view')
  @ApiOperation({ summary: 'Export invoices as CSV' })
  @ApiQuery({ name: 'status', required: false })
  async exportInvoices(
    @CurrentOrgId() orgId: string,
    @Res() res: Response,
    @Query('status') status?: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    const csv = await this.reportsService.exportInvoices(
      orgId,
      status,
      this.reportExportScope(access),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="invoices.csv"');
    res.send(csv);
  }

  @Get('requisitions/csv')
  @Permissions('reports:export', 'reports:view')
  @ApiOperation({ summary: 'Export requisitions as CSV' })
  async exportRequisitions(
    @CurrentOrgId() orgId: string,
    @Res() res: Response,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    const csv = await this.reportsService.exportRequisitions(
      orgId,
      this.reportExportScope(access),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="requisitions.csv"');
    res.send(csv);
  }

  @Get('spend-summary/csv')
  @Permissions('reports:export', 'reports:view')
  @ApiOperation({ summary: 'Export spend summary by vendor as CSV' })
  async exportSpendSummary(
    @CurrentOrgId() orgId: string,
    @Res() res: Response,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    const csv = await this.reportsService.exportSpendSummary(
      orgId,
      this.reportExportScope(access),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="spend-summary.csv"');
    res.send(csv);
  }

  @Get('budgets/csv')
  @Permissions('reports:export', 'reports:view')
  @ApiOperation({ summary: 'Export budget utilization as CSV' })
  async exportBudgets(
    @CurrentOrgId() orgId: string,
    @Res() res: Response,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    const csv = await this.reportsService.exportBudgets(
      orgId,
      this.reportExportScope(access),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="budgets.csv"');
    res.send(csv);
  }

  @Get('department-spend/csv')
  @Permissions('reports:export', 'reports:view')
  @ApiOperation({ summary: 'Export department spend summary as CSV' })
  async exportDepartmentSpend(
    @CurrentOrgId() orgId: string,
    @Res() res: Response,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    const csv = await this.reportsService.exportDepartmentSpend(
      orgId,
      this.reportExportScope(access),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="department-spend.csv"');
    res.send(csv);
  }

  @Get('ap-aging/csv')
  @Permissions('reports:export', 'reports:view')
  @ApiOperation({ summary: 'Export AP aging report as CSV' })
  async exportApAging(
    @CurrentOrgId() orgId: string,
    @Res() res: Response,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    const csv = await this.reportsService.exportApAging(
      orgId,
      this.reportExportScope(access),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="ap-aging.csv"');
    res.send(csv);
  }

  @Get('goods-receipts/csv')
  @Permissions('reports:export', 'reports:view')
  @ApiOperation({ summary: 'Export goods receipts summary as CSV' })
  async exportGrnSummary(
    @CurrentOrgId() orgId: string,
    @Res() res: Response,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    const csv = await this.reportsService.exportGrnSummary(
      orgId,
      this.reportExportScope(access),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="goods-receipts.csv"');
    res.send(csv);
  }
}
