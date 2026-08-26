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
  Res,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  PurchaseOrdersService,
  createPoSchema,
  changeOrderSchema,
} from './purchase-orders.service';
import { PdfService } from './pdf.service';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import { CurrentAccess } from '../auth/current-access.decorator';
import type { AccessPolicy } from '../auth/access-policy';

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
  @ApiQuery({ name: 'entityId', required: false })
  findAll(
    @CurrentOrgId() orgId: string,
    @Query('status') status?: string,
    @Query('vendorId') vendorId?: string,
    @Query('entityId') entityId?: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.purchaseOrdersService.findAll(orgId, { status, vendorId, entityId }, access);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get PO detail' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.purchaseOrdersService.findOne(id, orgId, access);
  }

  @Get(':id/versions')
  @ApiOperation({ summary: 'Get PO version history' })
  getVersionHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.purchaseOrdersService.getVersionHistory(id, orgId, access);
  }

  @Get(':id/receiving-summary')
  @ApiOperation({ summary: 'Get receiving progress per PO line' })
  getReceivingSummary(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.purchaseOrdersService.getReceivingSummary(id, orgId, access);
  }

  @Get(':id/compliance-report')
  @ApiOperation({ summary: 'Get contract compliance report for PO' })
  getComplianceReport(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.purchaseOrdersService.getComplianceReport(id, orgId, access);
  }

  @Post('check-compliance')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check contract compliance for a line item (does not modify data)' })
  checkCompliance(
    @Body()
    body: { vendorId: string; unitPrice: number; catalogItemId?: string; description?: string },
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    if (!body.vendorId) throw new BadRequestException('vendorId is required');
    if (body.unitPrice == null) throw new BadRequestException('unitPrice is required');
    return this.purchaseOrdersService.checkLineCompliance(
      orgId,
      body.vendorId,
      body.unitPrice,
      body.catalogItemId,
      body.description,
      access,
    );
  }

  @Get(':id/pdf')
  @ApiOperation({ summary: 'Download PO as PDF' })
  async getPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrgId() orgId: string,
    @Res() res: Response,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    const po = await this.purchaseOrdersService.findOne(id, orgId, access);
    const pdf = await this.pdfService.generatePoPdf(po as any);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${po.number}.pdf"`);
    res.send(pdf);
  }

  @Post()
  @ApiOperation({ summary: 'Create a purchase order' })
  create(
    @Body() body: unknown,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    const parsed = createPoSchema.parse(body);
    return this.purchaseOrdersService.create(orgId, userId, parsed, access);
  }

  @Post(':id/issue')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Issue a PO (send to vendor)' })
  issue(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.purchaseOrdersService.issue(id, orgId, userId, access);
  }

  @Post(':id/change-order')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create a change order (bumps version)' })
  changeOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    const parsed = changeOrderSchema.parse(body);
    return this.purchaseOrdersService.createChangeOrder(id, orgId, userId, parsed, access);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a PO' })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.purchaseOrdersService.cancel(id, orgId, userId, access);
  }

  @Get(':id/releases')
  @ApiOperation({ summary: 'List blanket PO releases' })
  listReleases(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.purchaseOrdersService.listReleases(id, orgId, access);
  }

  @Post(':id/releases')
  @ApiOperation({ summary: 'Create a blanket PO release' })
  createRelease(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { amount: number; description?: string },
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.purchaseOrdersService.createRelease(id, orgId, userId, body, access);
  }

  @Delete(':id/releases/:releaseId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a blanket PO release' })
  cancelRelease(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('releaseId', ParseUUIDPipe) releaseId: string,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.purchaseOrdersService.cancelRelease(id, releaseId, orgId, userId, access);
  }
}
