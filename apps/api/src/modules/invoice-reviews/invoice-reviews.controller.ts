import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Authenticated } from '../../common/decorators/authenticated.decorator';
import { CurrentAccess } from '../auth/current-access.decorator';
import type { AccessPolicy } from '../auth/access-policy';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { InvoiceReviewsService } from './invoice-reviews.service';

@ApiTags('invoice-reviews')
@ApiBearerAuth()
@Authenticated()
@Controller('invoice-reviews')
export class InvoiceReviewsController {
  constructor(private readonly invoiceReviewsService: InvoiceReviewsService) {}

  @Get()
  @Permissions('invoices:view_all')
  @ApiOperation({ summary: 'List invoice review cases' })
  @ApiQuery({ name: 'state', required: false })
  @ApiQuery({ name: 'signalType', required: false })
  @ApiQuery({ name: 'severity', required: false })
  @ApiQuery({ name: 'ownerId', required: false })
  @ApiQuery({ name: 'vendorId', required: false })
  @ApiQuery({ name: 'entityId', required: false })
  @ApiQuery({ name: 'minAgeDays', required: false, type: Number })
  @ApiQuery({ name: 'sort', required: false, enum: ['oldest_signal', 'due_date'] })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  list(
    @CurrentOrgId() organizationId: string,
    @Query() query: unknown,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.invoiceReviewsService.listCases(organizationId, query, access);
  }

  @Get(':invoiceId')
  @Permissions('invoices:view_all')
  @ApiOperation({ summary: 'Get the invoice review projection' })
  get(
    @Param('invoiceId') invoiceId: string,
    @CurrentOrgId() organizationId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.invoiceReviewsService.getProjection(invoiceId, organizationId, access);
  }
}
