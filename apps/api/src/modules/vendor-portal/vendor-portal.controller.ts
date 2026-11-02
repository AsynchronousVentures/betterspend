import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { postMessageSchema } from '@betterspend/shared';
import { IsEmail, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import {
  BulkCatalogPriceProposalRow,
  SubmitCatalogPriceProposalInput,
  SubmitInvoiceInput,
  VendorPortalService,
} from './vendor-portal.service';
import { MessagesService, parseThreadType } from '../messages/messages.service';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { CurrentAccess } from '../auth/current-access.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import type { AccessPolicy } from '../auth/access-policy';
import {
  PORTAL_SESSION_COOKIE,
  portalSessionCookieOptions,
  readPortalSessionCookie,
} from './vendor-portal-session';
import { VendorPortalUsersService } from './vendor-portal-users.service';

class PortalLoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password: string;
}

class PortalPasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(256)
  password: string;
}

class CreatePortalLoginDto extends PortalPasswordDto {
  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;
}

class CreatePortalUserDto extends CreatePortalLoginDto {
  @IsUUID()
  vendorId: string;
}

class ChangePortalPasswordDto {
  @IsString()
  currentPassword: string;

  @IsString()
  @MinLength(8)
  @MaxLength(256)
  newPassword: string;
}

class PortalUserStatusDto {
  @IsIn(['active', 'disabled'])
  status: 'active' | 'disabled';
}

const LOGIN_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('vendor-portal')
@Controller('vendor-portal')
export class VendorPortalController {
  constructor(
    private readonly vendorPortalService: VendorPortalService,
    private readonly messagesService: MessagesService,
    private readonly portalUsersService?: VendorPortalUsersService,
  ) {}

  /** Public: sign in with a vendor portal email/password login. */
  @Post('login')
  @Public()
  @Throttle(LOGIN_THROTTLE)
  @ApiOperation({ summary: 'Sign in to the vendor portal with email and password' })
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: PortalLoginDto, @Res({ passthrough: true }) response: Response) {
    const { sessionToken } = await this.vendorPortalService.loginWithPassword(
      body.email,
      body.password,
    );
    response.cookie(PORTAL_SESSION_COOKIE, sessionToken, portalSessionCookieOptions());
    return { success: true };
  }

  /** Public (portal session): the signed-in login and every login for this vendor. */
  @Get('account')
  @Public()
  @ApiOperation({ summary: 'Get the vendor portal account and its logins via portal session' })
  async getAccount(@Req() request: Request) {
    const { vendorId, organizationId, portalUserId } = await this.getSessionContext(request);
    const users = this.requirePortalUsers();
    const [user, logins] = await Promise.all([
      portalUserId ? users.findSummary(portalUserId, organizationId) : null,
      users.listByVendor(vendorId, organizationId),
    ]);
    return { user, logins };
  }

  /** Public (portal session): add an email/password login for this vendor. */
  @Post('account/logins')
  @Public()
  @ApiOperation({ summary: 'Create a vendor portal login for the current vendor' })
  async createOwnLogin(@Req() request: Request, @Body() body: CreatePortalLoginDto) {
    const { vendorId, organizationId } = await this.getSessionContext(request);
    return this.requirePortalUsers().createForVendor(vendorId, organizationId, body);
  }

  /** Public (portal session bound to a login): change that login's password. */
  @Post('account/password')
  @Public()
  @Throttle(LOGIN_THROTTLE)
  @ApiOperation({ summary: 'Change the signed-in vendor portal password' })
  @HttpCode(HttpStatus.OK)
  async changeOwnPassword(@Req() request: Request, @Body() body: ChangePortalPasswordDto) {
    const { portalUserId } = await this.getSessionContext(request);
    if (!portalUserId) {
      throw new UnauthorizedException('Sign in with your email and password to change it');
    }
    return this.requirePortalUsers().changePassword(
      portalUserId,
      body.currentPassword,
      body.newPassword,
    );
  }

  /** Admin: list portal logins for a vendor. */
  @Get('users')
  @Permissions('vendors:view')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List vendor portal logins for a vendor (admin use)' })
  listUsers(
    @Query('vendorId', new ParseUUIDPipe()) vendorId: string,
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.requirePortalUsers().listForVendor(vendorId, orgId, access);
  }

  /** Admin: create a portal login for a vendor contact. */
  @Post('users')
  @Permissions('vendors:edit')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a vendor portal login (admin use)' })
  createUser(
    @Body() body: CreatePortalUserDto,
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.requirePortalUsers().create(body, orgId, access);
  }

  /** Admin: set a new password on a portal login. */
  @Post('users/:userId/password')
  @Permissions('vendors:edit')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reset a vendor portal login password (admin use)' })
  @HttpCode(HttpStatus.OK)
  resetUserPassword(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() body: PortalPasswordDto,
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.requirePortalUsers().resetPassword(userId, body.password, orgId, access);
  }

  /** Admin: enable or disable a portal login. */
  @Patch('users/:userId')
  @Permissions('vendors:edit')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Enable or disable a vendor portal login (admin use)' })
  updateUser(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() body: PortalUserStatusDto,
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.requirePortalUsers().setStatus(userId, body.status, orgId, access);
  }

  /** Admin: delete a portal login. */
  @Delete('users/:userId')
  @Permissions('vendors:edit')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a vendor portal login (admin use)' })
  removeUser(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.requirePortalUsers().remove(userId, orgId, access);
  }

  /** Admin: send portal access link to a vendor (requires auth). */
  @Post('access')
  @Permissions('vendors:edit')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Send portal access link email to a vendor (admin use)' })
  @HttpCode(HttpStatus.OK)
  async sendAccess(
    @Body() body: { vendorId: string },
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.vendorPortalService.sendAccessLink(body.vendorId, orgId, access);
  }

  /** Public: exchange a one-time emailed credential for a scoped browser session. */
  @Post('session')
  @Public()
  @ApiOperation({ summary: 'Exchange a vendor portal link for a session cookie' })
  @HttpCode(HttpStatus.OK)
  async exchangeSession(
    @Body() body: { token?: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    const { sessionToken } = await this.vendorPortalService.exchangeLinkToken(body?.token ?? '');
    response.cookie(PORTAL_SESSION_COOKIE, sessionToken, portalSessionCookieOptions());
    return { success: true };
  }

  /** Public: revoke the current vendor portal session. */
  @Post('session/revoke')
  @Public()
  @ApiOperation({ summary: 'Revoke the current vendor portal session' })
  @HttpCode(HttpStatus.OK)
  async revokeSession(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const sessionToken = this.getSessionToken(request);
    await this.vendorPortalService.revokeSession(sessionToken);
    const { maxAge: _maxAge, ...cookieOptions } = portalSessionCookieOptions();
    response.clearCookie(PORTAL_SESSION_COOKIE, cookieOptions);
    return { success: true };
  }

  /** Public: get vendor dashboard via portal session. */
  @Get('dashboard')
  @Public()
  @ApiOperation({ summary: 'Get vendor dashboard data via portal session' })
  async getDashboard(@Req() request: Request) {
    const { vendorId, organizationId } = await this.getSessionContext(request);
    return this.vendorPortalService.getVendorDashboard(vendorId, organizationId);
  }

  /** Public: get PO details for vendor. */
  @Get('po/:poId')
  @Public()
  @ApiOperation({ summary: 'Get purchase order details for vendor via portal session' })
  async getPo(@Param('poId') poId: string, @Req() request: Request) {
    const { vendorId, organizationId } = await this.getSessionContext(request);
    return this.vendorPortalService.getPurchaseOrderForVendor(poId, vendorId, organizationId);
  }

  /** Public: submit invoice against a PO. */
  @Post('invoice')
  @Public()
  @ApiOperation({ summary: 'Submit an invoice against a PO via portal session' })
  @HttpCode(HttpStatus.CREATED)
  async submitInvoice(@Req() request: Request, @Body() body: SubmitInvoiceInput) {
    const { vendorId, organizationId } = await this.getSessionContext(request);
    return this.vendorPortalService.submitInvoice(vendorId, organizationId, body);
  }

  /** Public: list vendor's invoices. */
  @Get('invoices')
  @Public()
  @ApiOperation({ summary: 'List invoices for vendor via portal session' })
  async listInvoices(@Req() request: Request) {
    const { vendorId, organizationId } = await this.getSessionContext(request);
    return this.vendorPortalService.listVendorInvoices(vendorId, organizationId);
  }

  @Get('catalog')
  @Public()
  @ApiOperation({ summary: 'List vendor catalog items and price proposals via portal session' })
  async listCatalog(@Req() request: Request) {
    const { vendorId, organizationId } = await this.getSessionContext(request);
    return this.vendorPortalService.listVendorCatalog(vendorId, organizationId);
  }

  @Get('onboarding')
  @Public()
  @ApiOperation({
    summary: 'Get vendor onboarding questionnaire and latest submission via portal session',
  })
  async getOnboarding(@Req() request: Request) {
    const { vendorId, organizationId } = await this.getSessionContext(request);
    return this.vendorPortalService.getVendorOnboarding(vendorId, organizationId);
  }

  @Get('messages/:threadType/:threadId')
  @Public()
  @ApiOperation({ summary: 'List messages on a thread via portal session' })
  async listMessages(
    @Param('threadType') threadType: string,
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Req() request: Request,
  ) {
    const { vendorId, organizationId } = await this.getSessionContext(request);
    return this.messagesService.listAsVendor(
      organizationId,
      vendorId,
      parseThreadType(threadType),
      threadId,
    );
  }

  @Post('messages/:threadType/:threadId')
  @Public()
  @ApiOperation({ summary: 'Post a message to a thread as the vendor via portal session' })
  @HttpCode(HttpStatus.CREATED)
  async postMessage(
    @Param('threadType') threadType: string,
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Req() request: Request,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const { vendorId, organizationId } = await this.getSessionContext(request);
    const parsed = postMessageSchema.omit({ recipientVendorId: true }).parse({
      ...(body && typeof body === 'object' ? body : {}),
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
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
  @ApiOperation({ summary: 'Save or submit vendor onboarding via portal session' })
  @HttpCode(HttpStatus.CREATED)
  async submitOnboarding(
    @Req() request: Request,
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
    const { vendorId, organizationId } = await this.getSessionContext(request);
    return this.vendorPortalService.submitVendorOnboarding(vendorId, organizationId, body ?? {});
  }

  @Post('catalog/price-proposals')
  @Public()
  @ApiOperation({ summary: 'Submit catalog price proposal via portal session' })
  @HttpCode(HttpStatus.CREATED)
  async submitCatalogPriceProposal(
    @Req() request: Request,
    @Body() body: SubmitCatalogPriceProposalInput,
  ) {
    const { vendorId, organizationId } = await this.getSessionContext(request);
    return this.vendorPortalService.submitCatalogPriceProposal(vendorId, organizationId, body);
  }

  @Post('catalog/price-proposals/bulk')
  @Public()
  @ApiOperation({ summary: 'Submit bulk catalog price proposals via portal session' })
  @HttpCode(HttpStatus.CREATED)
  async submitBulkCatalogPriceProposal(
    @Req() request: Request,
    @Body() body: { rows?: BulkCatalogPriceProposalRow[] },
  ) {
    const { vendorId, organizationId } = await this.getSessionContext(request);
    return this.vendorPortalService.submitBulkCatalogPriceProposals(
      vendorId,
      organizationId,
      Array.isArray(body?.rows) ? body.rows : [],
    );
  }

  private requirePortalUsers(): VendorPortalUsersService {
    if (!this.portalUsersService) throw new UnauthorizedException('Portal logins are unavailable');
    return this.portalUsersService;
  }

  private getSessionToken(request: Request): string {
    const sessionToken = readPortalSessionCookie(request.headers.cookie);
    if (!sessionToken) throw new UnauthorizedException('Vendor portal session is required');
    return sessionToken;
  }

  private getSessionContext(request: Request) {
    return this.vendorPortalService.validateSessionContext(this.getSessionToken(request));
  }
}
