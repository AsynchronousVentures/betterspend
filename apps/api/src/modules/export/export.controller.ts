import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Response } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ExportService, type ExportType, type ExportQuery } from './export.service';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { CurrentAccess } from '../auth/current-access.decorator';
import type { AccessPolicy } from '../auth/access-policy';
import { intersectScopes, type ScopeConstraint } from '../auth/scope-sql';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('export')
@ApiBearerAuth()
@Permissions('reports:export', 'reports:view')
@Controller('export')
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  private reportExportScope(access?: AccessPolicy): ScopeConstraint | undefined {
    return intersectScopes(
      access?.scopeFor('report', 'reports:view'),
      access?.scopeFor('report', 'reports:export'),
    );
  }

  private async handleExport(
    res: Response,
    type: ExportType,
    orgId: string,
    query: ExportQuery,
    format: string | undefined,
    access?: AccessPolicy,
  ) {
    const scope = this.reportExportScope(access);
    const normalized = this.exportService.normalizeQuery(query);
    if (format === 'csv') {
      const date = new Date().toISOString().split('T')[0];
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="export-${type}-${date}.csv"`);
      await pipeline(
        Readable.from(this.exportService.csvChunks(type, orgId, normalized, scope)),
        res,
      );
      return;
    }
    return res.json(await this.exportService.getPage(type, orgId, normalized, scope));
  }

  @Get('purchase-orders')
  @ApiOperation({ summary: 'Export purchase orders as JSON or CSV' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'format', required: false, enum: ['json', 'csv'] })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async exportPurchaseOrders(
    @CurrentOrgId() orgId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('format') format?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Res() res?: Response,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.handleExport(
      res!,
      'purchase-orders',
      orgId,
      {
        from,
        to,
        page: format === 'csv' || page === undefined ? undefined : Number(page),
        limit: format === 'csv' || limit === undefined ? undefined : Number(limit),
      },
      format,
      access,
    );
  }

  @Get('invoices')
  @ApiOperation({ summary: 'Export invoices as JSON or CSV' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'format', required: false, enum: ['json', 'csv'] })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async exportInvoices(
    @CurrentOrgId() orgId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('format') format?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Res() res?: Response,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.handleExport(
      res!,
      'invoices',
      orgId,
      {
        from,
        to,
        page: format === 'csv' || page === undefined ? undefined : Number(page),
        limit: format === 'csv' || limit === undefined ? undefined : Number(limit),
      },
      format,
      access,
    );
  }

  @Get('budgets')
  @ApiOperation({ summary: 'Export budgets as JSON or CSV' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'format', required: false, enum: ['json', 'csv'] })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async exportBudgets(
    @CurrentOrgId() orgId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('format') format?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Res() res?: Response,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.handleExport(
      res!,
      'budgets',
      orgId,
      {
        from,
        to,
        page: format === 'csv' || page === undefined ? undefined : Number(page),
        limit: format === 'csv' || limit === undefined ? undefined : Number(limit),
      },
      format,
      access,
    );
  }

  @Get('audit-log')
  @ApiOperation({ summary: 'Export audit log as JSON or CSV' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'format', required: false, enum: ['json', 'csv'] })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async exportAuditLog(
    @CurrentOrgId() orgId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('format') format?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Res() res?: Response,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.handleExport(
      res!,
      'audit-log',
      orgId,
      {
        from,
        to,
        page: format === 'csv' || page === undefined ? undefined : Number(page),
        limit: format === 'csv' || limit === undefined ? undefined : Number(limit),
      },
      format,
      access,
    );
  }

  @Get('spend-by-vendor')
  @ApiOperation({ summary: 'Export spend by vendor as JSON or CSV' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'format', required: false, enum: ['json', 'csv'] })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async exportSpendByVendor(
    @CurrentOrgId() orgId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('format') format?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Res() res?: Response,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.handleExport(
      res!,
      'spend-by-vendor',
      orgId,
      {
        from,
        to,
        page: format === 'csv' || page === undefined ? undefined : Number(page),
        limit: format === 'csv' || limit === undefined ? undefined : Number(limit),
      },
      format,
      access,
    );
  }

  @Get('spend-by-category')
  @ApiOperation({ summary: 'Export spend by GL account/category as JSON or CSV' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'format', required: false, enum: ['json', 'csv'] })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async exportSpendByCategory(
    @CurrentOrgId() orgId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('format') format?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Res() res?: Response,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.handleExport(
      res!,
      'spend-by-category',
      orgId,
      {
        from,
        to,
        page: format === 'csv' || page === undefined ? undefined : Number(page),
        limit: format === 'csv' || limit === undefined ? undefined : Number(limit),
      },
      format,
      access,
    );
  }
}
