import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import {
  CreatePaymentRunInput,
  CreateVendorPaymentAccountInput,
  PaymentRunsService,
  SubmitPaymentRunInput,
} from './payment-runs.service';

@ApiTags('payment-runs')
@ApiBearerAuth()
@Controller('payment-runs')
export class PaymentRunsController {
  constructor(private readonly paymentRunsService: PaymentRunsService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Payment run summary' })
  summary(@CurrentOrgId() orgId: string) {
    return this.paymentRunsService.summary(orgId);
  }

  @Get('eligible-invoices')
  @ApiOperation({ summary: 'Approved unpaid invoices eligible for payment runs' })
  eligibleInvoices(@CurrentOrgId() orgId: string) {
    return this.paymentRunsService.eligibleInvoices(orgId);
  }

  @Get('vendor-accounts')
  @ApiOperation({ summary: 'List vendor payment accounts' })
  @ApiQuery({ name: 'vendorId', required: false })
  vendorAccounts(@CurrentOrgId() orgId: string, @Query('vendorId') vendorId?: string) {
    return this.paymentRunsService.vendorAccounts(orgId, vendorId);
  }

  @Post('vendor-accounts')
  @ApiOperation({ summary: 'Create a tokenized/masked vendor payment account' })
  createVendorAccount(@CurrentOrgId() orgId: string, @Body() body: CreateVendorPaymentAccountInput) {
    return this.paymentRunsService.createVendorAccount(orgId, body);
  }

  @Patch('vendor-accounts/:id/verify')
  @ApiOperation({ summary: 'Mark a vendor payment account as verified' })
  verifyVendorAccount(
    @Param('id') id: string,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.paymentRunsService.verifyVendorAccount(id, orgId, userId);
  }

  @Get()
  @ApiOperation({ summary: 'List payment runs' })
  @ApiQuery({ name: 'status', required: false })
  findAll(@CurrentOrgId() orgId: string, @Query('status') status?: string) {
    return this.paymentRunsService.findAll(orgId, status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get payment run by ID' })
  findOne(@Param('id') id: string, @CurrentOrgId() orgId: string) {
    return this.paymentRunsService.findOne(id, orgId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a draft payment run from approved invoices' })
  create(
    @Body() body: CreatePaymentRunInput,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.paymentRunsService.create(orgId, userId, body);
  }

  @Patch(':id/approve')
  @ApiOperation({ summary: 'Approve a payment run for submission' })
  approve(@Param('id') id: string, @CurrentOrgId() orgId: string, @CurrentUserId() userId: string) {
    return this.paymentRunsService.approve(id, orgId, userId);
  }

  @Patch(':id/submit')
  @ApiOperation({ summary: 'Submit a payment run and mark invoices paid' })
  submit(
    @Param('id') id: string,
    @Body() body: SubmitPaymentRunInput,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.paymentRunsService.submit(id, orgId, userId, body);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancel a draft or approved payment run' })
  cancel(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.paymentRunsService.cancel(id, orgId, userId, body?.reason);
  }
}
