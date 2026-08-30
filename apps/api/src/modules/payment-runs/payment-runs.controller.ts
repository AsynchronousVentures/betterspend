import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Authenticated } from '../../common/decorators/authenticated.decorator';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import {
  CreatePaymentRunInput,
  CreateVendorPaymentAccountInput,
  PaymentRunsService,
  SubmitPaymentRunInput,
} from './payment-runs.service';
import { CurrentAccess } from '../auth/current-access.decorator';
import type { AccessPolicy } from '../auth/access-policy';

@ApiTags('payment-runs')
@ApiBearerAuth()
@Authenticated()
@Controller('payment-runs')
export class PaymentRunsController {
  constructor(private readonly paymentRunsService: PaymentRunsService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Payment run summary' })
  summary(@CurrentOrgId() orgId: string, @CurrentAccess() access?: AccessPolicy) {
    return this.paymentRunsService.summary(orgId, access);
  }

  @Get('eligible-invoices')
  @ApiOperation({ summary: 'Approved unpaid invoices eligible for payment runs' })
  eligibleInvoices(@CurrentOrgId() orgId: string, @CurrentAccess() access?: AccessPolicy) {
    return this.paymentRunsService.eligibleInvoices(orgId, access);
  }

  @Get('vendor-accounts')
  @ApiOperation({ summary: 'List vendor payment accounts' })
  @ApiQuery({ name: 'vendorId', required: false })
  vendorAccounts(
    @CurrentOrgId() orgId: string,
    @Query('vendorId') vendorId?: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.paymentRunsService.vendorAccounts(orgId, vendorId, access);
  }

  @Post('vendor-accounts')
  @Permissions('vendors:edit_payment_details')
  @ApiOperation({ summary: 'Create a tokenized/masked vendor payment account' })
  createVendorAccount(
    @CurrentOrgId() orgId: string,
    @Body() body: CreateVendorPaymentAccountInput,
    @CurrentUserId() userId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.paymentRunsService.createVendorAccount(orgId, body, userId, access);
  }

  @Patch('vendor-accounts/:id/verify')
  @Permissions('vendors:edit_payment_details')
  @ApiOperation({ summary: 'Mark a vendor payment account as verified' })
  verifyVendorAccount(
    @Param('id') id: string,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.paymentRunsService.verifyVendorAccount(id, orgId, userId, access);
  }

  @Patch('invoices/:invoiceId/release')
  @Permissions('payments:release')
  @ApiOperation({ summary: 'Release an approved invoice for payment' })
  releaseInvoice(
    @Param('invoiceId') invoiceId: string,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.paymentRunsService.releaseInvoice(invoiceId, orgId, userId, access);
  }

  @Get()
  @ApiOperation({ summary: 'List payment runs' })
  @ApiQuery({ name: 'status', required: false })
  findAll(
    @CurrentOrgId() orgId: string,
    @Query('status') status?: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.paymentRunsService.findAll(orgId, status, access);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get payment run by ID' })
  findOne(
    @Param('id') id: string,
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.paymentRunsService.findOne(id, orgId, access);
  }

  @Post()
  @ApiOperation({ summary: 'Create a draft payment run from approved invoices' })
  create(
    @Body() body: CreatePaymentRunInput,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.paymentRunsService.create(orgId, userId, body, access);
  }

  @Patch(':id/approve')
  @ApiOperation({ summary: 'Approve a payment run for submission' })
  approve(
    @Param('id') id: string,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.paymentRunsService.approve(id, orgId, userId, access);
  }

  @Patch(':id/submit')
  @ApiOperation({ summary: 'Submit a payment run and mark invoices paid' })
  submit(
    @Param('id') id: string,
    @Body() body: SubmitPaymentRunInput,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.paymentRunsService.submit(id, orgId, userId, body, access);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancel a draft or approved payment run' })
  cancel(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.paymentRunsService.cancel(id, orgId, userId, body?.reason, access);
  }
}
