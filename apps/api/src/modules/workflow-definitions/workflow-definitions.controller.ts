import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createWorkflowDefinitionSchema,
  updateWorkflowDraftSchema,
  workflowDomainSchema,
} from '@betterspend/shared';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
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
    const { draft } = updateWorkflowDraftSchema.parse(body);
    return this.service.saveDraft(id, orgId, userId, draft);
  }

  @Post(':id/publish')
  @Permissions('settings:manage')
  @ApiOperation({ summary: 'Validate, compile, and publish an immutable workflow version' })
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.service.publish(id, orgId, userId);
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
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.service.restoreVersion(id, versionId, orgId, userId);
  }
}
