import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  ParseUUIDPipe,
  Query,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { postMessageSchema } from '@betterspend/shared';
import {
  VendorPortalService,
  SubmitInvoiceInput,
  SubmitCatalogPriceProposalInput,
  BulkCatalogPriceProposalRow,
} from './vendor-portal.service';
import { MessagesService, parseThreadType } from '../messages/messages.service';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';

@ApiTags('vendor-portal')
@Controller('vendor-portal')
export class VendorPortalController {
  constructor(
    private readonly vendorPortalService: VendorPortalService,
    private readonly messagesService: MessagesService,
  ) {}

  /** Admin: send portal access link to a vendor (requires auth) */
  @Post('access')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Send portal access link email to a vendor (admin use)' })
  @HttpCode(HttpStatus.OK)
  async sendAccess(@Body() body: { vendorId: string }, @CurrentOrgId() orgId: string) {
    return this.vendorPortalService.sendAccessLink(body.vendorId, orgId);
  }

  /** Public: get vendor dashboard via token */
  @Get('dashboard')
  @Public()
  @ApiOperation({ summary: 'Get vendor dashboard data via portal token' })
  async getDashboard(@Query('token') token: string) {
    if (!token) throw new UnauthorizedException('Token is required');
    const { vendorId, organizationId } = await this.vendorPortalService.validateTokenContext(token);
    return this.vendorPortalService.getVendorDashboard(vendorId, organizationId);
  }

  /** Public: get PO details for vendor */
  @Get('po/:poId')
  @Public()
  @ApiOperation({ summary: 'Get purchase order details for vendor via portal token' })
  async getPo(@Param('poId') poId: string, @Query('token') token: string) {
    if (!token) throw new UnauthorizedException('Token is required');
    const { vendorId, organizationId } = await this.vendorPortalService.validateTokenContext(token);
    return this.vendorPortalService.getPurchaseOrderForVendor(poId, vendorId, organizationId);
  }

  /** Public: submit invoice against a PO */
  @Post('invoice')
  @Public()
  @ApiOperation({ summary: 'Submit an invoice against a PO via portal token' })
  @HttpCode(HttpStatus.CREATED)
  async submitInvoice(@Query('token') token: string, @Body() body: SubmitInvoiceInput) {
    if (!token) throw new UnauthorizedException('Token is required');
    const { vendorId, organizationId } = await this.vendorPortalService.validateTokenContext(token);
    return this.vendorPortalService.submitInvoice(vendorId, organizationId, body);
  }

  /** Public: list vendor's invoices */
  @Get('invoices')
  @Public()
  @ApiOperation({ summary: 'List invoices for vendor via portal token' })
  async listInvoices(@Query('token') token: string) {
    if (!token) throw new UnauthorizedException('Token is required');
    const { vendorId, organizationId } = await this.vendorPortalService.validateTokenContext(token);
    return this.vendorPortalService.listVendorInvoices(vendorId, organizationId);
  }

  @Get('catalog')
  @Public()
  @ApiOperation({ summary: 'List vendor catalog items and price proposals via portal token' })
  async listCatalog(@Query('token') token: string) {
    if (!token) throw new UnauthorizedException('Token is required');
    const { vendorId, organizationId } = await this.vendorPortalService.validateTokenContext(token);
    return this.vendorPortalService.listVendorCatalog(vendorId, organizationId);
  }

  @Get('onboarding')
  @Public()
  @ApiOperation({
    summary: 'Get vendor onboarding questionnaire and latest submission via portal token',
  })
  async getOnboarding(@Query('token') token: string) {
    if (!token) throw new UnauthorizedException('Token is required');
    const { vendorId, organizationId } = await this.vendorPortalService.validateTokenContext(token);
    return this.vendorPortalService.getVendorOnboarding(vendorId, organizationId);
  }

  @Get('messages/:threadType/:threadId')
  @Public()
  @ApiOperation({ summary: 'List messages on a thread via portal token' })
  async listMessages(
    @Param('threadType') threadType: string,
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Query('token') token: string,
  ) {
    if (!token) throw new UnauthorizedException('Token is required');
    const { vendorId, organizationId } = await this.vendorPortalService.validateTokenContext(token);
    return this.messagesService.listAsVendor(
      organizationId,
      vendorId,
      parseThreadType(threadType),
      threadId,
    );
  }

  @Post('messages/:threadType/:threadId')
  @Public()
  @ApiOperation({ summary: 'Post a message to a thread as the vendor via portal token' })
  @HttpCode(HttpStatus.CREATED)
  async postMessage(
    @Param('threadType') threadType: string,
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Query('token') token: string,
    @Body() body: unknown,
  ) {
    if (!token) throw new UnauthorizedException('Token is required');
    const { vendorId, organizationId } = await this.vendorPortalService.validateTokenContext(token);
    const parsed = postMessageSchema.omit({ recipientVendorId: true }).parse(body);
    return this.messagesService.postAsVendor(
      organizationId,
      vendorId,
      parseThreadType(threadType),
      threadId,
      parsed,
    );
  }

  @Post('onboarding')
  @Public()
  @ApiOperation({ summary: 'Save or submit vendor onboarding via portal token' })
  @HttpCode(HttpStatus.CREATED)
  async submitOnboarding(
    @Query('token') token: string,
    @Body()
    body: {
      questionnaireId?: string;
      companyInfo?: Record<string, unknown>;
      responses?: Record<string, unknown>;
      documentLinks?: Record<string, unknown>;
      bankingDetails?: Record<string, unknown>;
      submit?: boolean;
    },
  ) {
    if (!token) throw new UnauthorizedException('Token is required');
    const { vendorId, organizationId } = await this.vendorPortalService.validateTokenContext(token);
    return this.vendorPortalService.submitVendorOnboarding(vendorId, organizationId, body ?? {});
  }

  @Post('catalog/price-proposals')
  @Public()
  @ApiOperation({ summary: 'Submit catalog price proposal via portal token' })
  @HttpCode(HttpStatus.CREATED)
  async submitCatalogPriceProposal(
    @Query('token') token: string,
    @Body() body: SubmitCatalogPriceProposalInput,
  ) {
    if (!token) throw new UnauthorizedException('Token is required');
    const { vendorId, organizationId } = await this.vendorPortalService.validateTokenContext(token);
    return this.vendorPortalService.submitCatalogPriceProposal(vendorId, organizationId, body);
  }

  @Post('catalog/price-proposals/bulk')
  @Public()
  @ApiOperation({ summary: 'Submit bulk catalog price proposals via portal token' })
  @HttpCode(HttpStatus.CREATED)
  async submitBulkCatalogPriceProposal(
    @Query('token') token: string,
    @Body() body: { rows?: BulkCatalogPriceProposalRow[] },
  ) {
    if (!token) throw new UnauthorizedException('Token is required');
    const { vendorId, organizationId } = await this.vendorPortalService.validateTokenContext(token);
    return this.vendorPortalService.submitBulkCatalogPriceProposals(
      vendorId,
      organizationId,
      Array.isArray(body?.rows) ? body.rows : [],
    );
  }
}
