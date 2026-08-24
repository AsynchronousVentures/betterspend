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
import { Roles } from '../../common/decorators/roles.decorator';

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
  updateMapping(
    @Param('id') id: string,
    @Body() body: UpdateGlMappingInput,
    @CurrentOrgId() orgId: string,
  ) {
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
  findJobsForInvoice(@Param('invoiceId') invoiceId: string, @CurrentOrgId() orgId: string) {
    return this.glExportService.findJobsForInvoice(invoiceId, orgId);
  }

  @Post('export-jobs/:id/retry')
  @ApiOperation({ summary: 'Retry a failed GL export job' })
  async retryJob(@Param('id') id: string, @CurrentOrgId() orgId: string) {
    await this.glExportService.retryJob(id, orgId);
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
  @ApiOperation({ summary: 'QBO OAuth callback — exchanges code for tokens' })
  async qboCallback(
    @Query('code') code: string,
    @Query('realmId') realmId: string,
    @Query('state') state: string,
    @CurrentUserId() userId: string,
    @CurrentSessionId() sessionId: string | undefined,
    @Res() res: Response,
  ) {
    const webUrl = process.env.WEB_URL || 'http://localhost:3100';
    try {
      if (!sessionId) throw new UnauthorizedException('The OAuth session is no longer available');
      await this.oauthService.completeQboOAuth(state, code, realmId, userId, sessionId);
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
  @ApiOperation({ summary: 'Xero OAuth callback — exchanges code for tokens' })
  async xeroCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @CurrentUserId() userId: string,
    @CurrentSessionId() sessionId: string | undefined,
    @Res() res: Response,
  ) {
    const webUrl = process.env.WEB_URL || 'http://localhost:3100';
    try {
      if (!sessionId) throw new UnauthorizedException('The OAuth session is no longer available');
      await this.oauthService.completeXeroOAuth(state, code, userId, sessionId);
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
