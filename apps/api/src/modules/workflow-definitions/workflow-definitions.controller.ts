import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createWorkflowDefinitionSchema,
  leasedWorkflowDraftUpdateSchema,
  workflowAssistantProposalRequestSchema,
  workflowDomainSchema,
  workflowDraftLeaseMutationSchema,
} from '@betterspend/shared';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import type { AuthUser } from '../../auth/auth.instance';
import { WorkflowDefinitionsService } from './workflow-definitions.service';

@ApiTags('workflow-definitions')
@Controller('workflow-definitions')
export class WorkflowDefinitionsController {
  constructor(private readonly service: WorkflowDefinitionsService) {}

  @Get()
  @Permissions('settings:manage')
  @ApiOperation({ summary: 'List workflow definitions' })
  findAll(@CurrentOrgId() orgId: string, @Query('domain') domain?: string) {
    return this.service.findAll(orgId, domain ? workflowDomainSchema.parse(domain) : undefined);
  }

  @Get(':id')
  @Permissions('settings:manage')
  @ApiOperation({ summary: 'Get a workflow definition and its current published version' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentOrgId() orgId: string) {
    return this.service.findOne(id, orgId);
  }

  @Post()
  @Permissions('settings:manage')
  @ApiOperation({ summary: 'Create a workflow definition draft' })
  create(@Body() body: unknown, @CurrentOrgId() orgId: string, @CurrentUserId() userId: string) {
    return this.service.create(orgId, userId, createWorkflowDefinitionSchema.parse(body));
  }

  @Patch(':id/draft')
  @Permissions('settings:manage')
  @ApiOperation({ summary: 'Autosave a mutable workflow definition draft' })
  saveDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    const { draft, leaseToken } = leasedWorkflowDraftUpdateSchema.parse(body);
    return this.service.saveDraft(id, orgId, userId, draft, leaseToken);
  }

  @Get(':id/draft-lease')
  @Permissions('settings:manage')
  @ApiOperation({ summary: 'Get the current mutable workflow draft lease' })
  getDraftLease(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.service.getDraftLease(id, orgId, userId);
  }

  @Post(':id/draft-lease')
  @Permissions('settings:manage')
  @ApiOperation({ summary: 'Acquire the mutable workflow draft lease' })
  acquireDraftLease(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @CurrentUser() currentUser?: AuthUser,
  ) {
    return this.service.acquireDraftLease(id, orgId, userId, currentUser?.name);
  }

  @Post(':id/draft-lease/renew')
  @Permissions('settings:manage')
  @ApiOperation({ summary: 'Renew the mutable workflow draft lease' })
  renewDraftLease(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    const { leaseToken } = workflowDraftLeaseMutationSchema.parse(body);
    return this.service.renewDraftLease(id, orgId, userId, leaseToken);
  }

  @Delete(':id/draft-lease')
  @Permissions('settings:manage')
  @ApiOperation({ summary: 'Release the mutable workflow draft lease' })
  releaseDraftLease(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    const { leaseToken } = workflowDraftLeaseMutationSchema.parse(body);
    return this.service.releaseDraftLease(id, orgId, userId, leaseToken);
  }

  @Post(':id/draft-lease/takeover')
  @Permissions('settings:manage')
  @ApiOperation({ summary: 'Explicitly take over the mutable workflow draft lease' })
  takeoverDraftLease(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @CurrentUser() currentUser?: AuthUser,
  ) {
    return this.service.takeoverDraftLease(id, orgId, userId, currentUser?.name);
  }

  @Post(':id/publish')
  @Permissions('settings:manage')
  @ApiOperation({ summary: 'Validate, compile, and publish an immutable workflow version' })
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    const { leaseToken } = workflowDraftLeaseMutationSchema.parse(body);
    return this.service.publish(id, orgId, userId, leaseToken);
  }

  @Get(':id/versions')
  @Permissions('settings:manage')
  @ApiOperation({ summary: 'List immutable published versions' })
  listVersions(@Param('id', ParseUUIDPipe) id: string, @CurrentOrgId() orgId: string) {
    return this.service.listVersions(id, orgId);
  }

  @Post(':id/versions/:versionId/restore')
  @Permissions('settings:manage')
  @ApiOperation({ summary: 'Restore a published version as the mutable draft' })
  restoreVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Body() body: unknown,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    const { leaseToken } = workflowDraftLeaseMutationSchema.parse(body);
    return this.service.restoreVersion(id, versionId, orgId, userId, leaseToken);
  }

  @Post(':id/assistant/proposals')
  @Permissions('settings:manage')
  @ApiOperation({ summary: 'Generate a read-only workflow assistant proposal' })
  proposeAssistant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentOrgId() orgId: string,
  ) {
    return this.service.proposeAssistant(
      id,
      orgId,
      workflowAssistantProposalRequestSchema.parse(body),
    );
  }
}
