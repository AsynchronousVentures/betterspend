import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, ParseUUIDPipe,
  HttpCode, HttpStatus, Res, BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import type { Response } from 'express';
import { PurchaseOrdersService, createPoSchema, changeOrderSchema } from './purchase-orders.service';
import { PdfService } from './pdf.service';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';

@ApiTags('purchase-orders')
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(
    private readonly purchaseOrdersService: PurchaseOrdersService,
    private readonly pdfService: PdfService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List purchase orders' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'vendorId', required: false })
  findAll(
    @CurrentOrgId() orgId: string,
    @Query('status') status?: string,
    @Query('vendorId') vendorId?: string,
  ) {
    return this.purchaseOrdersService.findAll(orgId, { status, vendorId });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get PO detail' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentOrgId() orgId: string) {
    return this.purchaseOrdersService.findOne(id, orgId);
  }

  @Get(':id/versions')
  @ApiOperation({ summary: 'Get PO version history' })
  getVersionHistory(@Param('id', ParseUUIDPipe) id: string, @CurrentOrgId() orgId: string) {
    return this.purchaseOrdersService.getVersionHistory(id, orgId);
  }

  @Get(':id/receiving-summary')
  @ApiOperation({ summary: 'Get receiving progress per PO line' })
  getReceivingSummary(@Param('id', ParseUUIDPipe) id: string, @CurrentOrgId() orgId: string) {
    return this.purchaseOrdersService.getReceivingSummary(id, orgId);
  }

  @Get(':id/compliance-report')
  @ApiOperation({ summary: 'Get contract compliance report for PO' })
  getComplianceReport(@Param('id', ParseUUIDPipe) id: string, @CurrentOrgId() orgId: string) {
    return this.purchaseOrdersService.getComplianceReport(id, orgId);
  }

  @Post('check-compliance')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check contract compliance for a line item (does not modify data)' })
  checkCompliance(
    @Body() body: { vendorId: string; unitPrice: number; catalogItemId?: string; description?: string },
    @CurrentOrgId() orgId: string,
  ) {
    if (!body.vendorId) throw new BadRequestException('vendorId is required');
    if (body.unitPrice == null) throw new BadRequestException('unitPrice is required');
    return this.purchaseOrdersService.checkLineCompliance(
      orgId,
      body.vendorId,
      body.unitPrice,
      body.catalogItemId,
      body.description,
    );
  }

  @Get(':id/pdf')
  @ApiOperation({ summary: 'Download PO as PDF' })
  async getPdf(@Param('id', ParseUUIDPipe) id: string, @CurrentOrgId() orgId: string, @Res() res: Response) {
    const po = await this.purchaseOrdersService.findOne(id, orgId);
    const pdf = await this.pdfService.generatePoPdf(po as any);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${po.number}.pdf"`);
    res.send(pdf);
  }

  @Post()
  @ApiOperation({ summary: 'Create a purchase order' })
  create(@Body() body: unknown, @CurrentOrgId() orgId: string, @CurrentUserId() userId: string) {
    const parsed = createPoSchema.parse(body);
    return this.purchaseOrdersService.create(orgId, userId, parsed);
  }

  @Post(':id/issue')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Issue a PO (send to vendor)' })
  issue(@Param('id', ParseUUIDPipe) id: string, @CurrentOrgId() orgId: string, @CurrentUserId() userId: string) {
    return this.purchaseOrdersService.issue(id, orgId, userId);
  }

  @Post(':id/change-order')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create a change order (bumps version)' })
  changeOrder(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentOrgId() orgId: string, @CurrentUserId() userId: string) {
    const parsed = changeOrderSchema.parse(body);
    return this.purchaseOrdersService.createChangeOrder(id, orgId, userId, parsed);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a PO' })
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentOrgId() orgId: string) {
    return this.purchaseOrdersService.cancel(id, orgId);
  }

  @Get(':id/releases')
  @ApiOperation({ summary: 'List blanket PO releases' })
  listReleases(@Param('id', ParseUUIDPipe) id: string, @CurrentOrgId() orgId: string) {
    return this.purchaseOrdersService.listReleases(id, orgId);
  }

  @Post(':id/releases')
  @ApiOperation({ summary: 'Create a blanket PO release' })
  createRelease(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { amount: number; description?: string },
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.purchaseOrdersService.createRelease(id, orgId, userId, body);
  }

  @Delete(':id/releases/:releaseId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a blanket PO release' })
  cancelRelease(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('releaseId', ParseUUIDPipe) releaseId: string,
    @CurrentOrgId() orgId: string,
  ) {
    return this.purchaseOrdersService.cancelRelease(id, releaseId, orgId);
  }
}
