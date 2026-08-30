import { Controller, Get, Post, Patch, Param, Body, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { ContractsService } from './contracts.service';
import {
  contractSchema,
  contractLineSchema,
  contractAmendmentSchema,
  updateContractObligationSchema,
} from '@betterspend/shared';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import { OperationalPermissions } from '../../common/decorators/operational-permissions.decorator';
import { CurrentAccess } from '../auth/current-access.decorator';
import type { AccessPolicy } from '../auth/access-policy';

@ApiTags('contracts')
@Controller('contracts')
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  @Get()
  @OperationalPermissions('contracts:view')
  @ApiOperation({ summary: 'List all contracts' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'vendorId', required: false })
  @ApiQuery({ name: 'type', required: false })
  findAll(
    @CurrentOrgId() orgId: string,
    @Query('status') status?: string,
    @Query('vendorId') vendorId?: string,
    @Query('type') type?: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.contractsService.findAll(orgId, { status, vendorId, type }, access);
  }

  @Get('expiring')
  @OperationalPermissions('contracts:view')
  @ApiOperation({ summary: 'Get contracts expiring within N days' })
  @ApiQuery({ name: 'days', required: false })
  expiring(
    @CurrentOrgId() orgId: string,
    @Query('days') days?: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.contractsService.getExpiringContracts(orgId, days ? parseInt(days) : 30, access);
  }

  @Get(':id')
  @OperationalPermissions('contracts:view')
  @ApiOperation({ summary: 'Get a contract by ID' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.contractsService.findOne(id, orgId, access);
  }

  @Post()
  @OperationalPermissions('contracts:manage')
  @ApiOperation({ summary: 'Create a contract' })
  create(
    @Body() body: unknown,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    const parsed = contractSchema.parse(body);
    return this.contractsService.create(
      {
        organizationId: orgId,
        createdBy: userId,
        contractNumber: '',
        ...parsed,
        startDate: parsed.startDate ? new Date(parsed.startDate) : undefined,
        endDate: parsed.endDate ? new Date(parsed.endDate) : undefined,
      } as any,
      access,
    );
  }

  @Patch(':id')
  @OperationalPermissions('contracts:manage')
  @ApiOperation({ summary: 'Update a contract' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    const parsed = contractSchema.partial().parse(body);
    return this.contractsService.update(
      id,
      orgId,
      userId,
      {
        ...parsed,
        startDate: parsed.startDate ? new Date(parsed.startDate) : undefined,
        endDate: parsed.endDate ? new Date(parsed.endDate) : undefined,
      },
      access,
    );
  }

  @Post(':id/activate')
  @OperationalPermissions('contracts:manage')
  @ApiOperation({ summary: 'Activate a contract' })
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.contractsService.activate(id, orgId, userId, access);
  }

  @Post(':id/intelligence/extract')
  @OperationalPermissions('contracts:manage')
  @ApiOperation({ summary: 'Extract contract intelligence from terms or pasted document text' })
  processIntelligence(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { documentId?: string; documentText?: string; sourceName?: string },
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.contractsService.processIntelligence(id, orgId, userId, body ?? {}, access);
  }

  @Post(':id/intelligence/extractions/:extractionId/review')
  @OperationalPermissions('contracts:manage')
  @ApiOperation({ summary: 'Approve or reject an extracted contract intelligence run' })
  reviewExtraction(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('extractionId', ParseUUIDPipe) extractionId: string,
    @Body() body: { decision: 'approved' | 'rejected'; fields?: Record<string, unknown> },
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.contractsService.reviewExtraction(id, orgId, userId, extractionId, body, access);
  }

  @Patch(':id/intelligence/clauses/:clauseId')
  @OperationalPermissions('contracts:manage')
  @ApiOperation({ summary: 'Review or override an extracted contract clause' })
  updateClause(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('clauseId', ParseUUIDPipe) clauseId: string,
    @Body()
    body: {
      status?: string;
      riskLevel?: 'low' | 'medium' | 'high';
      riskReason?: string;
      normalizedSummary?: string;
      extractedText?: string;
    },
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.contractsService.updateClause(id, orgId, userId, clauseId, body, access);
  }

  @Patch(':id/intelligence/obligations/:obligationId')
  @OperationalPermissions('contracts:manage')
  @ApiOperation({ summary: 'Update a contract obligation review task' })
  updateObligation(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('obligationId', ParseUUIDPipe) obligationId: string,
    @Body() body: unknown,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    const parsed = updateContractObligationSchema.parse(body);
    return this.contractsService.updateObligation(id, orgId, userId, obligationId, parsed, access);
  }

  @Post(':id/terminate')
  @OperationalPermissions('contracts:manage')
  @ApiOperation({ summary: 'Terminate a contract' })
  terminate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason: string },
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.contractsService.terminate(id, orgId, userId, body.reason ?? '', access);
  }

  @Post(':id/lines')
  @OperationalPermissions('contracts:manage')
  @ApiOperation({ summary: 'Add a line to a contract' })
  addLine(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    const parsed = contractLineSchema.parse(body);
    return this.contractsService.addLine(id, orgId, parsed as any, access);
  }

  @Post(':id/amendments')
  @OperationalPermissions('contracts:manage')
  @ApiOperation({ summary: 'Add an amendment to a contract' })
  addAmendment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    const parsed = contractAmendmentSchema.parse(body);
    return this.contractsService.addAmendment(
      id,
      orgId,
      userId,
      {
        ...parsed,
        effectiveDate: parsed.effectiveDate ? new Date(parsed.effectiveDate) : undefined,
        newEndDate: parsed.newEndDate ? new Date(parsed.newEndDate) : undefined,
      } as any,
      access,
    );
  }

  @Post('sync-expiring')
  @OperationalPermissions('contracts:manage')
  @ApiOperation({ summary: 'Sync expiring_soon and expired statuses' })
  syncExpiring(@CurrentOrgId() orgId: string, @CurrentAccess() access?: AccessPolicy) {
    return this.contractsService.syncExpiringStatus(orgId, access);
  }
}
