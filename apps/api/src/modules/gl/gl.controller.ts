import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, HttpCode, HttpStatus, Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Response } from 'express';
import { GlMappingsService, CreateGlMappingInput, UpdateGlMappingInput } from './gl-mappings.service';
import { GlExportService } from './gl-export.service';
import { OAuthService } from './oauth.service';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';

const DEMO_ORG_ID = '00000000-0000-0000-0000-000000000001';

@ApiTags('gl')
@Roles('finance', 'admin')
@Controller('gl')
export class GlController {
  constructor(
    private readonly glMappingsService: GlMappingsService,
    private readonly glExportService: GlExportService,
    private readonly oauthService: OAuthService,
  ) {}

  // ── Mappings ───────────────────────────────────────────────────────────────

  @Get('mappings')
  @ApiOperation({ summary: 'List GL account mappings' })
  @ApiQuery({ name: 'targetSystem', required: false, enum: ['qbo', 'xero'] })
  findAllMappings(@CurrentOrgId() orgId: string, @Query('targetSystem') targetSystem?: string) {
    return this.glMappingsService.findAll(orgId, targetSystem);
  }

  @Get('mappings/:id')
  @ApiOperation({ summary: 'Get a GL mapping' })
  findOneMapping(@Param('id') id: string, @CurrentOrgId() orgId: string) {
    return this.glMappingsService.findOne(id, orgId);
  }

  @Post('mappings')
  @ApiOperation({ summary: 'Create a GL account mapping' })
  createMapping(@Body() body: CreateGlMappingInput, @CurrentOrgId() orgId: string) {
    return this.glMappingsService.create(orgId, body);
  }

  @Patch('mappings/:id')
  @ApiOperation({ summary: 'Update a GL mapping' })
  updateMapping(@Param('id') id: string, @Body() body: UpdateGlMappingInput, @CurrentOrgId() orgId: string) {
    return this.glMappingsService.update(id, orgId, body);
  }

  @Delete('mappings/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a GL mapping' })
  removeMapping(@Param('id') id: string, @CurrentOrgId() orgId: string) {
    return this.glMappingsService.remove(id, orgId);
  }

  // ── Export Jobs ────────────────────────────────────────────────────────────

  @Get('export-jobs')
  @ApiOperation({ summary: 'List GL export jobs' })
  findAllJobs(@CurrentOrgId() orgId: string) {
    return this.glExportService.findAll(orgId);
  }

  @Get('export-jobs/invoice/:invoiceId')
  @ApiOperation({ summary: 'List GL export jobs for a specific invoice' })
  findJobsForInvoice(@Param('invoiceId') invoiceId: string) {
    return this.glExportService.findJobsForInvoice(invoiceId);
  }

  @Post('export-jobs/:id/retry')
  @ApiOperation({ summary: 'Retry a failed GL export job' })
  retryJob(@Param('id') id: string, @CurrentOrgId() orgId: string) {
    this.glExportService.retryJob(id, orgId).catch(() => {});
    return { queued: true };
  }

  @Post('export-jobs/trigger/:invoiceId')
  @ApiOperation({ summary: 'Manually trigger GL export for an approved invoice' })
  @ApiQuery({ name: 'targetSystem', required: true, enum: ['qbo', 'xero'] })
  triggerExport(
    @Param('invoiceId') invoiceId: string,
    @CurrentOrgId() orgId: string,
    @Query('targetSystem') targetSystem: 'qbo' | 'xero' = 'qbo',
  ) {
    this.glExportService.enqueue(orgId, invoiceId, targetSystem);
    return { queued: true, invoiceId, targetSystem };
  }

  // ── OAuth — Connection Status ───────────────────────────────────────────────

  @Get('oauth/status')
  @ApiOperation({ summary: 'Get QBO and Xero connection status using platform-managed OAuth apps' })
  getOAuthStatus(@CurrentOrgId() orgId: string) {
    return this.oauthService.getConnectionStatus(orgId);
  }

  // ── OAuth — QuickBooks Online ───────────────────────────────────────────────

  @Get('oauth/qbo/connect')
  @ApiOperation({ summary: 'Get QBO OAuth authorize URL using the platform-managed app' })
  getQboConnectUrl(@CurrentOrgId() orgId: string) {
    const url = this.oauthService.getQboAuthUrl(orgId);
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
      let organizationId = DEMO_ORG_ID;
      try {
        const parsed = JSON.parse(Buffer.from(state, 'base64').toString('utf8')) as { organizationId?: string };
        if (parsed.organizationId) organizationId = parsed.organizationId;
      } catch {
        // state parse failure — fall back to demo org
      }
      await this.oauthService.exchangeQboCode(organizationId, code, realmId);
      res.redirect(`${webUrl}/addons?connected=qbo`);
    } catch (err) {
      const message = encodeURIComponent(String(err));
      res.redirect(`${webUrl}/addons?error=qbo&message=${message}`);
    }
  }

  @Delete('oauth/qbo')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Disconnect QBO' })
  async disconnectQbo(@CurrentOrgId() orgId: string) {
    await this.oauthService.disconnectQbo(orgId);
  }

  // ── OAuth — Xero ────────────────────────────────────────────────────────────

  @Get('oauth/xero/connect')
  @ApiOperation({ summary: 'Get Xero OAuth authorize URL using the platform-managed app' })
  getXeroConnectUrl(@CurrentOrgId() orgId: string) {
    const url = this.oauthService.getXeroAuthUrl(orgId);
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
      let organizationId = DEMO_ORG_ID;
      try {
        const parsed = JSON.parse(Buffer.from(state, 'base64').toString('utf8')) as { organizationId?: string };
        if (parsed.organizationId) organizationId = parsed.organizationId;
      } catch {
        // state parse failure — fall back to demo org
      }
      await this.oauthService.exchangeXeroCode(organizationId, code);
      res.redirect(`${webUrl}/addons?connected=xero`);
    } catch (err) {
      const message = encodeURIComponent(String(err));
      res.redirect(`${webUrl}/addons?error=xero&message=${message}`);
    }
  }

  @Delete('oauth/xero')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Disconnect Xero' })
  async disconnectXero(@CurrentOrgId() orgId: string) {
    await this.oauthService.disconnectXero(orgId);
  }
}
