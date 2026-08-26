import {
  Controller, Get, Post, Patch, Delete, Param, Body, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ProjectsService, CreateProjectInput, UpdateProjectInput } from './projects.service';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentAccess } from '../auth/current-access.decorator';
import type { AccessPolicy } from '../auth/access-policy';

@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  @Permissions('reports:view')
  @ApiOperation({ summary: 'List all projects' })
  findAll(@CurrentOrgId() orgId: string, @CurrentAccess() access?: AccessPolicy) {
    return this.projectsService.findAll(orgId, access?.scopeFor('report', 'reports:view'));
  }

  @Get(':id')
  @Permissions('reports:view')
  @ApiOperation({ summary: 'Get a project' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.projectsService.findOne(id, orgId, access?.scopeFor('report', 'reports:view'));
  }

  @Post()
  @Permissions('settings:manage')
  @ApiOperation({ summary: 'Create a project' })
  create(@Body() body: CreateProjectInput, @CurrentOrgId() orgId: string) {
    return this.projectsService.create(orgId, body);
  }

  @Patch(':id')
  @Permissions('settings:manage')
  @ApiOperation({ summary: 'Update a project' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateProjectInput,
    @CurrentOrgId() orgId: string,
  ) {
    return this.projectsService.update(id, orgId, body);
  }

  @Delete(':id')
  @Permissions('settings:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a project' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentOrgId() orgId: string) {
    return this.projectsService.remove(id, orgId);
  }
}
