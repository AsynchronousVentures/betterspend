import { Controller, Get, Post, Patch, Param, Body, Query, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { VendorsService } from './vendors.service';
import { vendorSchema } from '@betterspend/shared';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentAccess } from '../auth/current-access.decorator';
import type { AccessPolicy } from '../auth/access-policy';

@ApiTags('vendors')
@Controller('vendors')
export class VendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  @Get()
  @Permissions('vendors:view')
  @ApiOperation({ summary: 'List all vendors' })
  findAll(
    @CurrentOrgId() orgId: string,
    @Query('entityId') entityId?: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.vendorsService.findAll(orgId, entityId, access);
  }

  @Post()
  @Permissions('vendors:create')
  @ApiOperation({ summary: 'Create a vendor' })
  create(
    @Body() body: unknown,
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    const parsed = vendorSchema.parse(body);
    return this.vendorsService.create(
      {
        organizationId: orgId,
        entityId: (body as any)?.entityId ?? null,
        ...parsed,
      },
      access,
    );
  }

  @Get(':id/transactions')
  @Permissions('vendors:view')
  @ApiOperation({ summary: 'Get invoices and POs for a vendor' })
  transactions(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.vendorsService.getTransactions(id, orgId, access);
  }

  @Get('onboarding/questionnaires')
  @Permissions('vendors:view')
  @ApiOperation({ summary: 'List onboarding questionnaires' })
  onboardingQuestionnaires(@CurrentOrgId() orgId: string, @CurrentAccess() access?: AccessPolicy) {
    return this.vendorsService.listOnboardingQuestionnaires(orgId, access);
  }

  @Post('onboarding/questionnaires')
  @Permissions('vendors:edit')
  @ApiOperation({ summary: 'Create an onboarding questionnaire' })
  createOnboardingQuestionnaire(
    @Body() body: any,
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.vendorsService.createOnboardingQuestionnaire(orgId, body ?? {}, access);
  }

  @Get('onboarding/queue')
  @Permissions('vendors:view')
  @ApiOperation({ summary: 'List vendor onboarding submissions awaiting review' })
  onboardingQueue(@CurrentOrgId() orgId: string, @CurrentAccess() access?: AccessPolicy) {
    return this.vendorsService.listOnboardingQueue(orgId, access);
  }

  @Get(':id/onboarding')
  @Permissions('vendors:view')
  @ApiOperation({ summary: 'Get onboarding detail for a vendor' })
  onboardingDetail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.vendorsService.getOnboardingDetail(id, orgId, access);
  }

  @Post(':id/onboarding/review')
  @Permissions('vendors:edit')
  @ApiOperation({ summary: 'Approve onboarding or request changes' })
  reviewOnboarding(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { decision: 'approved' | 'changes_requested'; reviewNote?: string },
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.vendorsService.reviewOnboarding(id, orgId, body, access);
  }

  @Patch(':id')
  @Permissions('vendors:edit')
  @ApiOperation({ summary: 'Update a vendor' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    const parsed = vendorSchema.partial().parse(body);
    return this.vendorsService.update(
      id,
      orgId,
      { ...parsed, entityId: (body as any)?.entityId },
      access,
    );
  }

  @Patch(':id/esg')
  @Permissions('vendors:edit')
  @ApiOperation({ summary: 'Update vendor ESG and diversity data' })
  updateEsg(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.vendorsService.updateEsg(id, orgId, body as any, access);
  }

  @Get('diversity/summary')
  @Permissions('vendors:view')
  @ApiOperation({ summary: 'Get supplier diversity and ESG summary for the organization' })
  diversitySummary(@CurrentOrgId() orgId: string, @CurrentAccess() access?: AccessPolicy) {
    return this.vendorsService.getDiversitySummary(orgId, access);
  }

  @Get(':id')
  @Permissions('vendors:view')
  @ApiOperation({ summary: 'Get a vendor by ID' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.vendorsService.findOne(id, orgId, access);
  }
}
