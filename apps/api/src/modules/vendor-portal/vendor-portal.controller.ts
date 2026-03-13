import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import {
  VendorPortalService,
  SubmitInvoiceInput,
  SubmitCatalogPriceProposalInput,
  BulkCatalogPriceProposalRow,
} from './vendor-portal.service';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';

const DEMO_ORG_ID = '00000000-0000-0000-0000-000000000001';

@ApiTags('vendor-portal')
@Controller('vendor-portal')
export class VendorPortalController {
  constructor(private readonly vendorPortalService: VendorPortalService) {}

  /** Admin: send portal access link to a vendor (requires auth) */
  @Post('access')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Send portal access link email to a vendor (admin use)' })
  @HttpCode(HttpStatus.OK)
  async sendAccess(
    @Body() body: { vendorId: string },
    @CurrentOrgId() orgId: string,
  ) {
    return this.vendorPortalService.sendAccessLink(body.vendorId, orgId);
  }

  /** Public: get vendor dashboard via token */
  @Get('dashboard')
  @Public()
  @ApiOperation({ summary: 'Get vendor dashboard data via portal token' })
  async getDashboard(@Query('token') token: string) {
    if (!token) throw new UnauthorizedException('Token is required');
    const vendorId = await this.vendorPortalService.validateToken(token);
    return this.vendorPortalService.getVendorDashboard(vendorId, DEMO_ORG_ID);
  }

  /** Public: get PO details for vendor */
  @Get('po/:poId')
  @Public()
  @ApiOperation({ summary: 'Get purchase order details for vendor via portal token' })
  async getPo(@Param('poId') poId: string, @Query('token') token: string) {
    if (!token) throw new UnauthorizedException('Token is required');
    const vendorId = await this.vendorPortalService.validateToken(token);
    return this.vendorPortalService.getPurchaseOrderForVendor(poId, vendorId, DEMO_ORG_ID);
  }

  /** Public: submit invoice against a PO */
  @Post('invoice')
  @Public()
  @ApiOperation({ summary: 'Submit an invoice against a PO via portal token' })
  @HttpCode(HttpStatus.CREATED)
  async submitInvoice(
    @Query('token') token: string,
    @Body() body: SubmitInvoiceInput,
  ) {
    if (!token) throw new UnauthorizedException('Token is required');
    const vendorId = await this.vendorPortalService.validateToken(token);
    return this.vendorPortalService.submitInvoice(vendorId, DEMO_ORG_ID, body);
  }

  /** Public: list vendor's invoices */
  @Get('invoices')
  @Public()
  @ApiOperation({ summary: 'List invoices for vendor via portal token' })
  async listInvoices(@Query('token') token: string) {
    if (!token) throw new UnauthorizedException('Token is required');
    const vendorId = await this.vendorPortalService.validateToken(token);
    return this.vendorPortalService.listVendorInvoices(vendorId, DEMO_ORG_ID);
  }

  @Get('catalog')
  @Public()
  @ApiOperation({ summary: 'List vendor catalog items and price proposals via portal token' })
  async listCatalog(@Query('token') token: string) {
    if (!token) throw new UnauthorizedException('Token is required');
    const vendorId = await this.vendorPortalService.validateToken(token);
    return this.vendorPortalService.listVendorCatalog(vendorId, DEMO_ORG_ID);
  }

  @Get('onboarding')
  @Public()
  @ApiOperation({ summary: 'Get vendor onboarding questionnaire and latest submission via portal token' })
  async getOnboarding(@Query('token') token: string) {
    if (!token) throw new UnauthorizedException('Token is required');
    const vendorId = await this.vendorPortalService.validateToken(token);
    return this.vendorPortalService.getVendorOnboarding(vendorId, DEMO_ORG_ID);
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
    const vendorId = await this.vendorPortalService.validateToken(token);
    return this.vendorPortalService.submitVendorOnboarding(vendorId, DEMO_ORG_ID, body ?? {});
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
    const vendorId = await this.vendorPortalService.validateToken(token);
    return this.vendorPortalService.submitCatalogPriceProposal(vendorId, DEMO_ORG_ID, body);
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
    const vendorId = await this.vendorPortalService.validateToken(token);
    return this.vendorPortalService.submitBulkCatalogPriceProposals(
      vendorId,
      DEMO_ORG_ID,
      Array.isArray(body?.rows) ? body.rows : [],
    );
  }
}
