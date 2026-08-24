import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createWorkflowDefinitionSchema,
  updateWorkflowDraftSchema,
  workflowDomainSchema,
} from '@betterspend/shared';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { WorkflowDefinitionsService } from './workflow-definitions.service';

@ApiTags('workflow-definitions')
@Controller('workflow-definitions')
export class WorkflowDefinitionsController {
  constructor(private readonly service: WorkflowDefinitionsService) {}

  @Get()
  @ApiOperation({ summary: 'List workflow definitions' })
  findAll(@CurrentOrgId() orgId: string, @Query('domain') domain?: string) {
    return this.service.findAll(orgId, domain ? workflowDomainSchema.parse(domain) : undefined);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a workflow definition and its current published version' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentOrgId() orgId: string) {
    return this.service.findOne(id, orgId);
  }

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Create a workflow definition draft' })
  create(@Body() body: unknown, @CurrentOrgId() orgId: string, @CurrentUserId() userId: string) {
    return this.service.create(orgId, userId, createWorkflowDefinitionSchema.parse(body));
  }

  @Patch(':id/draft')
  @Roles('admin')
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
  @Roles('admin')
  @ApiOperation({ summary: 'Validate, compile, and publish an immutable workflow version' })
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.service.publish(id, orgId, userId);
  }

  @Get(':id/versions')
  @ApiOperation({ summary: 'List immutable published versions' })
  listVersions(@Param('id', ParseUUIDPipe) id: string, @CurrentOrgId() orgId: string) {
    return this.service.listVersions(id, orgId);
  }

  @Post(':id/versions/:versionId/restore')
  @Roles('admin')
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
