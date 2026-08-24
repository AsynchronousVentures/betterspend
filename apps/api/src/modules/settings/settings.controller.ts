import { Body, Controller, Get, Put, Req, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Request } from 'express';
import { SettingsService } from './settings.service';
import {
  brandingSettingsSchema,
  smtpSettingsSchema,
  approvalPolicySettingsSchema,
  contractComplianceSettingsSchema,
  riskScreeningSettingsSchema,
} from '@betterspend/shared';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all settings for the organization' })
  getAll(@CurrentOrgId() orgId: string) {
    return this.settingsService.getAll(orgId);
  }

  @Get('branding')
  @Public()
  @ApiOperation({ summary: 'Get public branding settings (no auth required)' })
  getBranding(@CurrentOrgId() orgId: string) {
    return this.settingsService.getBranding(orgId);
  }

  @Put('branding')
  @Roles('admin')
  @ApiOperation({ summary: 'Update branding settings' })
  updateBranding(@Body() body: unknown, @CurrentOrgId() orgId: string) {
    const parsed = brandingSettingsSchema.parse(body);
    return this.settingsService.updateMany(orgId, parsed as Record<string, string>);
  }

  @Put('smtp')
  @Roles('admin')
  @ApiOperation({ summary: 'Update SMTP / email settings' })
  updateSmtp(@Body() body: unknown, @CurrentOrgId() orgId: string) {
    const parsed = smtpSettingsSchema.parse(body);
    return this.settingsService.updateMany(orgId, parsed as Record<string, string>);
  }

  @Put('approval-policy')
  @Roles('admin')
  @ApiOperation({ summary: 'Update approval policy settings (auto-approval threshold)' })
  updateApprovalPolicy(@Body() body: unknown, @CurrentOrgId() orgId: string) {
    const parsed = approvalPolicySettingsSchema.parse(body);
    return this.settingsService.updateMany(orgId, parsed as Record<string, string>);
  }

  @Put('contract-compliance')
  @Roles('admin')
  @ApiOperation({ summary: 'Update contract compliance settings' })
  updateContractCompliance(@Body() body: unknown, @CurrentOrgId() orgId: string) {
    const parsed = contractComplianceSettingsSchema.parse(body);
    return this.settingsService.updateMany(orgId, parsed as Record<string, string>);
  }

  @Put('risk-screening')
  @Roles('admin')
  @ApiOperation({ summary: 'Update supplier risk screening policy' })
  updateRiskScreening(
    @Body() body: unknown,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @Req() request: Request,
  ) {
    if (!request.authUser) {
      throw new UnauthorizedException('Authentication is required');
    }
    const parsed = riskScreeningSettingsSchema.parse(body);
    return this.settingsService.updateManyWithAudit(
      orgId,
      userId,
      parsed as Record<string, string>,
      'risk_screening_policy_updated',
    );
  }
}
