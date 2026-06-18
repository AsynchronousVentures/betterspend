import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { ContractsService } from './contracts.service';
import { contractSchema, contractLineSchema, contractAmendmentSchema } from '@betterspend/shared';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';

@ApiTags('contracts')
@Controller('contracts')
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  @Get()
  @ApiOperation({ summary: 'List all contracts' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'vendorId', required: false })
  @ApiQuery({ name: 'type', required: false })
  findAll(
    @CurrentOrgId() orgId: string,
    @Query('status') status?: string,
    @Query('vendorId') vendorId?: string,
    @Query('type') type?: string,
  ) {
    return this.contractsService.findAll(orgId, { status, vendorId, type });
  }

  @Get('expiring')
  @ApiOperation({ summary: 'Get contracts expiring within N days' })
  @ApiQuery({ name: 'days', required: false })
  expiring(@CurrentOrgId() orgId: string, @Query('days') days?: string) {
    return this.contractsService.getExpiringContracts(orgId, days ? parseInt(days) : 30);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a contract by ID' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentOrgId() orgId: string) {
    return this.contractsService.findOne(id, orgId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a contract' })
  create(@Body() body: unknown, @CurrentOrgId() orgId: string, @CurrentUserId() userId: string) {
    const parsed = contractSchema.parse(body);
    return this.contractsService.create({
      organizationId: orgId,
      createdBy: userId,
      contractNumber: '',
      ...parsed,
      startDate: parsed.startDate ? new Date(parsed.startDate) : undefined,
      endDate: parsed.endDate ? new Date(parsed.endDate) : undefined,
    } as any);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a contract' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    const parsed = contractSchema.partial().parse(body);
    return this.contractsService.update(id, orgId, userId, {
      ...parsed,
      startDate: parsed.startDate ? new Date(parsed.startDate) : undefined,
      endDate: parsed.endDate ? new Date(parsed.endDate) : undefined,
    });
  }

  @Post(':id/activate')
  @ApiOperation({ summary: 'Activate a contract' })
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.contractsService.activate(id, orgId, userId);
  }

  @Post(':id/intelligence/extract')
  @ApiOperation({ summary: 'Extract contract intelligence from terms or pasted document text' })
  processIntelligence(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { documentId?: string; documentText?: string; sourceName?: string },
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.contractsService.processIntelligence(id, orgId, userId, body ?? {});
  }

  @Post(':id/intelligence/extractions/:extractionId/review')
  @ApiOperation({ summary: 'Approve or reject an extracted contract intelligence run' })
  reviewExtraction(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('extractionId', ParseUUIDPipe) extractionId: string,
    @Body() body: { decision: 'approved' | 'rejected'; fields?: Record<string, unknown> },
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.contractsService.reviewExtraction(id, orgId, userId, extractionId, body);
  }

  @Patch(':id/intelligence/clauses/:clauseId')
  @ApiOperation({ summary: 'Review or override an extracted contract clause' })
  updateClause(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('clauseId', ParseUUIDPipe) clauseId: string,
    @Body() body: {
      status?: string;
      riskLevel?: 'low' | 'medium' | 'high';
      riskReason?: string;
      normalizedSummary?: string;
      extractedText?: string;
    },
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.contractsService.updateClause(id, orgId, userId, clauseId, body);
  }

  @Patch(':id/intelligence/obligations/:obligationId')
  @ApiOperation({ summary: 'Update a contract obligation review task' })
  updateObligation(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('obligationId', ParseUUIDPipe) obligationId: string,
    @Body() body: {
      status?: string;
      ownerId?: string | null;
      dueDate?: string | null;
      title?: string;
      description?: string;
      notificationLeadDays?: number;
    },
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.contractsService.updateObligation(id, orgId, userId, obligationId, body);
  }

  @Post(':id/terminate')
  @ApiOperation({ summary: 'Terminate a contract' })
  terminate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason: string },
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.contractsService.terminate(id, orgId, userId, body.reason ?? '');
  }

  @Post(':id/lines')
  @ApiOperation({ summary: 'Add a line to a contract' })
  addLine(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentOrgId() orgId: string,
  ) {
    const parsed = contractLineSchema.parse(body);
    return this.contractsService.addLine(id, orgId, parsed as any);
  }

  @Post(':id/amendments')
  @ApiOperation({ summary: 'Add an amendment to a contract' })
  addAmendment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    const parsed = contractAmendmentSchema.parse(body);
    return this.contractsService.addAmendment(id, orgId, userId, {
      ...parsed,
      effectiveDate: parsed.effectiveDate ? new Date(parsed.effectiveDate) : undefined,
      newEndDate: parsed.newEndDate ? new Date(parsed.newEndDate) : undefined,
    } as any);
  }

  @Post('sync-expiring')
  @ApiOperation({ summary: 'Sync expiring_soon and expired statuses' })
  syncExpiring(@CurrentOrgId() orgId: string) {
    return this.contractsService.syncExpiringStatus(orgId);
  }
}
