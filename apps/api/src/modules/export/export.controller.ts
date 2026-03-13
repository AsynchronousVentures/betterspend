import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Response } from 'express';
import { ExportService } from './export.service';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';

@ApiTags('export')
@ApiBearerAuth()
@Controller('export')
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  private async handleExport(
    res: Response,
    type: string,
    rows: Record<string, unknown>[],
    format: string | undefined,
  ) {
    if (format === 'csv') {
      const csv = this.exportService.buildCsvForType(type, rows);
      const date = new Date().toISOString().split('T')[0];
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="export-${type}-${date}.csv"`);
      return res.send(csv);
    }
    return res.json(rows);
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
  ) {
    const rows = await this.exportService.getPurchaseOrders(orgId, { from, to });
    if (format === 'csv') {
      return this.handleExport(res!, 'purchase-orders', rows, format);
    }
    const p = parseInt(page ?? '1', 10);
    const l = parseInt(limit ?? '500', 10);
    return res!.json(this.exportService.paginateRows(rows, p, l));
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
  ) {
    const rows = await this.exportService.getInvoices(orgId, { from, to });
    if (format === 'csv') {
      return this.handleExport(res!, 'invoices', rows, format);
    }
    const p = parseInt(page ?? '1', 10);
    const l = parseInt(limit ?? '500', 10);
    return res!.json(this.exportService.paginateRows(rows, p, l));
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
  ) {
    const rows = await this.exportService.getBudgets(orgId, { from, to });
    if (format === 'csv') {
      return this.handleExport(res!, 'budgets', rows, format);
    }
    const p = parseInt(page ?? '1', 10);
    const l = parseInt(limit ?? '500', 10);
    return res!.json(this.exportService.paginateRows(rows, p, l));
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
  ) {
    const rows = await this.exportService.getAuditLog(orgId, { from, to });
    if (format === 'csv') {
      return this.handleExport(res!, 'audit-log', rows, format);
    }
    const p = parseInt(page ?? '1', 10);
    const l = parseInt(limit ?? '500', 10);
    return res!.json(this.exportService.paginateRows(rows, p, l));
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
  ) {
    const rows = await this.exportService.getSpendByVendor(orgId, { from, to });
    if (format === 'csv') {
      return this.handleExport(res!, 'spend-by-vendor', rows, format);
    }
    const p = parseInt(page ?? '1', 10);
    const l = parseInt(limit ?? '500', 10);
    return res!.json(this.exportService.paginateRows(rows, p, l));
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
  ) {
    const rows = await this.exportService.getSpendByCategory(orgId, { from, to });
    if (format === 'csv') {
      return this.handleExport(res!, 'spend-by-category', rows, format);
    }
    const p = parseInt(page ?? '1', 10);
    const l = parseInt(limit ?? '500', 10);
    return res!.json(this.exportService.paginateRows(rows, p, l));
  }
}
