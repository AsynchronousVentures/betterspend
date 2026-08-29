import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { xeroGrantQuerySchema, xeroTenantSelectionSchema } from '@betterspend/shared';
import { Response } from 'express';
import {
  GlMappingsService,
  CreateGlMappingInput,
  UpdateGlMappingInput,
} from './gl-mappings.service';
import { GlExportService } from './gl-export.service';
import { OAuthService } from './oauth.service';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import { CurrentSessionId } from '../../common/decorators/current-session-id.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentAccess } from '../auth/current-access.decorator';
import type { AccessPolicy } from '../auth/access-policy';

@ApiTags('gl')
@Controller('gl')
export class GlController {
  constructor(
    private readonly glMappingsService: GlMappingsService,
    private readonly glExportService: GlExportService,
    private readonly oauthService: OAuthService,
  ) {}

  // ── Mappings ───────────────────────────────────────────────────────────────

  @Get('mappings')
  @Permissions('reports:view')
  @ApiOperation({ summary: 'List GL account mappings' })
  @ApiQuery({ name: 'targetSystem', required: false, enum: ['qbo', 'xero'] })
  findAllMappings(@CurrentOrgId() orgId: string, @Query('targetSystem') targetSystem?: string) {
    return this.glMappingsService.findAll(orgId, targetSystem);
  }

  @Get('mappings/:id')
  @Permissions('reports:view')
  @ApiOperation({ summary: 'Get a GL mapping' })
  findOneMapping(@Param('id') id: string, @CurrentOrgId() orgId: string) {
    return this.glMappingsService.findOne(id, orgId);
  }

  @Post('mappings')
  @Permissions('reports:export')
  @ApiOperation({ summary: 'Create a GL account mapping' })
  createMapping(@Body() body: CreateGlMappingInput, @CurrentOrgId() orgId: string) {
    return this.glMappingsService.create(orgId, body);
  }

  @Patch('mappings/:id')
  @Permissions('reports:export')
  @ApiOperation({ summary: 'Update a GL mapping' })
  updateMapping(
    @Param('id') id: string,
    @Body() body: UpdateGlMappingInput,
    @CurrentOrgId() orgId: string,
  ) {
    return this.glMappingsService.update(id, orgId, body);
  }

  @Delete('mappings/:id')
  @Permissions('reports:export')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a GL mapping' })
  removeMapping(@Param('id') id: string, @CurrentOrgId() orgId: string) {
    return this.glMappingsService.remove(id, orgId);
  }

  // ── Export Jobs ────────────────────────────────────────────────────────────

  @Get('export-jobs')
  @Permissions('reports:view')
  @ApiOperation({ summary: 'List GL export jobs' })
  findAllJobs(@CurrentOrgId() orgId: string, @CurrentAccess() access?: AccessPolicy) {
    return this.glExportService.findAll(orgId, access?.scopeFor('report', 'reports:view'));
  }

  @Get('export-jobs/invoice/:invoiceId')
  @Permissions('reports:view')
  @ApiOperation({ summary: 'List GL export jobs for a specific invoice' })
  findJobsForInvoice(
    @Param('invoiceId') invoiceId: string,
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.glExportService.findJobsForInvoice(
      invoiceId,
      orgId,
      access?.scopeFor('report', 'reports:view'),
    );
  }

  @Post('export-jobs/:id/retry')
  @Permissions('reports:export')
  @ApiOperation({ summary: 'Retry a failed GL export job' })
  async retryJob(
    @Param('id') id: string,
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    await this.glExportService.retryJob(id, orgId, access?.scopeFor('report', 'reports:export'));
    return { queued: true };
  }

  @Post('export-jobs/trigger/:invoiceId')
  @Permissions('reports:export')
  @ApiOperation({ summary: 'Manually trigger GL export for an approved invoice' })
  @ApiQuery({ name: 'targetSystem', required: true, enum: ['qbo', 'xero'] })
  async triggerExport(
    @Param('invoiceId') invoiceId: string,
    @CurrentOrgId() orgId: string,
    @Query('targetSystem') targetSystem: 'qbo' | 'xero' = 'qbo',
    @CurrentAccess() access?: AccessPolicy,
  ) {
    await this.glExportService.enqueue(
      orgId,
      invoiceId,
      targetSystem,
      undefined,
      access?.scopeFor('report', 'reports:export'),
    );
    return { queued: true, invoiceId, targetSystem };
  }

  // ── OAuth — Connection Status ───────────────────────────────────────────────

  @Get('oauth/status')
  @Permissions('reports:view')
  @ApiOperation({ summary: 'Get QBO and Xero connection status using platform-managed OAuth apps' })
  getOAuthStatus(@CurrentOrgId() orgId: string) {
    return this.oauthService.getConnectionStatus(orgId);
  }

  // ── OAuth — QuickBooks Online ───────────────────────────────────────────────

  @Get('oauth/qbo/connect')
  @Permissions('reports:export')
  @ApiOperation({ summary: 'Get QBO OAuth authorize URL using the platform-managed app' })
  async getQboConnectUrl(
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @CurrentSessionId() sessionId?: string,
  ) {
    if (!sessionId)
      throw new UnauthorizedException('An authenticated session is required to connect QBO');
    const url = await this.oauthService.getQboAuthUrl(orgId, userId, sessionId);
    return { url };
  }

  @Get('oauth/qbo/callback')
  @Public()
  @ApiOperation({ summary: 'QBO OAuth callback — exchanges code for tokens' })
  async qboCallback(
    @Query('code') code: string,
    @Query('realmId') realmId: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const webUrl = process.env.WEB_URL || 'http://localhost:3100';
    try {
      await this.oauthService.completeQboOAuth(state, code, realmId);
      res.redirect(`${webUrl}/addons?connected=qbo`);
    } catch (err) {
      const message = encodeURIComponent(String(err));
      res.redirect(`${webUrl}/addons?error=qbo&message=${message}`);
    }
  }

  @Delete('oauth/qbo')
  @Permissions('reports:export')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Disconnect QBO' })
  async disconnectQbo(@CurrentOrgId() orgId: string, @CurrentUserId() userId: string) {
    await this.oauthService.disconnectQbo(orgId, userId);
  }

  // ── OAuth — Xero ────────────────────────────────────────────────────────────

  @Get('oauth/xero/connect')
  @Permissions('reports:export')
  @ApiOperation({ summary: 'Get Xero OAuth authorize URL using the platform-managed app' })
  async getXeroConnectUrl(
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @CurrentSessionId() sessionId?: string,
  ) {
    if (!sessionId)
      throw new UnauthorizedException('An authenticated session is required to connect Xero');
    const url = await this.oauthService.getXeroAuthUrl(orgId, userId, sessionId);
    return { url };
  }

  @Get('oauth/xero/callback')
  @Public()
  @ApiOperation({ summary: 'Xero OAuth callback — exchanges code for tokens' })
  async xeroCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const webUrl = process.env.WEB_URL || 'http://localhost:3100';
    try {
      const result = await this.oauthService.completeXeroOAuth(state, code);
      res.redirect(
        `${webUrl}/addons?connected=xero&xeroGrant=${encodeURIComponent(result.grantId)}`,
      );
    } catch (err) {
      const message = encodeURIComponent(String(err));
      res.redirect(`${webUrl}/addons?error=xero&message=${message}`);
    }
  }

  @Get('oauth/xero/connections')
  @Permissions('reports:export')
  @ApiOperation({ summary: 'List Xero tenants available to the current OAuth grant' })
  @ApiQuery({ name: 'grantId', required: true })
  getXeroConnections(
    @Query() query: unknown,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @CurrentSessionId() sessionId?: string,
  ) {
    const { grantId } = xeroGrantQuerySchema.parse(query);
    return this.oauthService.getXeroPendingTenants(grantId, orgId, userId, sessionId);
  }

  @Post('oauth/xero/connections')
  @Permissions('reports:export')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Select the Xero tenant for the current organization' })
  selectXeroConnection(
    @Body() body: unknown,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @CurrentSessionId() sessionId?: string,
  ) {
    const { grantId, tenantId } = xeroTenantSelectionSchema.parse(body);
    return this.oauthService.selectXeroTenant(grantId, tenantId, orgId, userId, sessionId);
  }

  @Delete('oauth/xero')
  @Permissions('reports:export')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Disconnect Xero' })
  async disconnectXero(@CurrentOrgId() orgId: string, @CurrentUserId() userId: string) {
    await this.oauthService.disconnectXero(orgId, userId);
  }
}
