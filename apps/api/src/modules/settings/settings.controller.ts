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
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @Permissions('settings:manage')
  @ApiOperation({ summary: 'Get all settings for the organization' })
  getAll(@CurrentOrgId() orgId: string) {
    return this.settingsService.getAll(orgId);
  }

  @Get('branding')
  @Public()
  @ApiOperation({ summary: 'Get public branding settings (no auth required)' })
  getBranding() {
    return this.settingsService.getPublicBranding();
  }

  @Put('branding')
  @Permissions('settings:manage')
  @ApiOperation({ summary: 'Update branding settings' })
  updateBranding(@Body() body: unknown, @CurrentOrgId() orgId: string) {
    const parsed = brandingSettingsSchema.parse(body);
    return this.settingsService.updateMany(orgId, parsed as Record<string, string>);
  }

  @Put('smtp')
  @Permissions('settings:manage')
  @ApiOperation({ summary: 'Update SMTP / email settings' })
  updateSmtp(@Body() body: unknown, @CurrentOrgId() orgId: string) {
    const parsed = smtpSettingsSchema.parse(body);
    return this.settingsService.updateMany(orgId, parsed as Record<string, string>);
  }

  @Put('approval-policy')
  @Permissions('settings:manage')
  @ApiOperation({ summary: 'Update approval and budget enforcement policy settings' })
  updateApprovalPolicy(
    @Body() body: unknown,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    const parsed = approvalPolicySettingsSchema.parse(body);
    return this.settingsService.updateManyWithAudit(
      orgId,
      userId,
      parsed as Record<string, string>,
      'approval_policy_updated',
    );
  }

  @Put('contract-compliance')
  @Permissions('settings:manage')
  @ApiOperation({ summary: 'Update contract compliance settings' })
  updateContractCompliance(@Body() body: unknown, @CurrentOrgId() orgId: string) {
    const parsed = contractComplianceSettingsSchema.parse(body);
    return this.settingsService.updateMany(orgId, parsed as Record<string, string>);
  }

  @Put('risk-screening')
  @Permissions('settings:manage')
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
