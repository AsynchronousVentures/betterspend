import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AiProvidersService } from './ai-providers.service';

interface SaveApiKeyDto {
  apiKey?: string;
  defaultModel?: string;
  organizationId?: string;
  projectId?: string;
}

interface UpdateProviderDto {
  defaultModel?: string;
  enabled?: boolean;
  isDefault?: boolean;
}

@ApiTags('ai-providers')
@Controller('ai-providers')
export class AiProvidersController {
  constructor(private readonly aiProvidersService: AiProvidersService) {}

  @Get('status')
  @Permissions('settings:manage')
  @ApiOperation({ summary: 'List AI provider connection status for this workspace' })
  status(@CurrentOrgId() orgId: string) {
    return this.aiProvidersService.getStatus(orgId);
  }

  @Get('openrouter/oauth/connect')
  @Permissions('settings:manage')
  @ApiOperation({ summary: 'Create an OpenRouter OAuth PKCE authorize URL' })
  connectOpenRouter(@CurrentOrgId() orgId: string, @CurrentUserId() userId: string) {
    return this.aiProvidersService.createOpenRouterConnectUrl(orgId, userId);
  }

  @Get('openrouter/oauth/callback')
  @Public()
  @ApiOperation({ summary: 'OpenRouter OAuth callback' })
  async openRouterCallback(
    @Query('state') state: string,
    @Query('code') code: string,
    @Query('error') error: string | undefined,
    @Query('error_description') errorDescription: string | undefined,
    @Res() res: Response,
  ) {
    const webUrl = process.env.WEB_URL || 'http://localhost:3100';
    try {
      if (error) throw new Error(errorDescription || error);
      await this.aiProvidersService.completeOpenRouterOAuth(state, code);
      res.redirect(`${webUrl}/addons?aiConnected=openrouter`);
    } catch (err) {
      const message = encodeURIComponent(err instanceof Error ? err.message : String(err));
      res.redirect(`${webUrl}/addons?aiError=openrouter&message=${message}`);
    }
  }

  @Put(':provider/api-key')
  @Permissions('settings:manage')
  @ApiOperation({ summary: 'Connect or update an AI provider using a manual API key' })
  saveApiKey(
    @Param('provider') provider: string,
    @Body() body: SaveApiKeyDto,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.aiProvidersService.saveApiKey(orgId, userId, provider, body);
  }

  @Patch(':provider')
  @Permissions('settings:manage')
  @ApiOperation({ summary: 'Update AI provider defaults and enabled state' })
  updateProvider(
    @Param('provider') provider: string,
    @Body() body: UpdateProviderDto,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.aiProvidersService.updateProvider(orgId, userId, provider, body);
  }

  @Post(':provider/test')
  @HttpCode(HttpStatus.OK)
  @Permissions('settings:manage')
  @ApiOperation({ summary: 'Validate a stored AI provider credential' })
  testProvider(
    @Param('provider') provider: string,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.aiProvidersService.testProvider(orgId, userId, provider);
  }

  @Delete(':provider')
  @Permissions('settings:manage')
  @ApiOperation({ summary: 'Disconnect an AI provider and remove its stored credential' })
  disconnect(
    @Param('provider') provider: string,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.aiProvidersService.disconnectProvider(orgId, userId, provider);
  }
}
