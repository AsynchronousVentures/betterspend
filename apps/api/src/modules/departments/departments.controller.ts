import {
  Controller, Get, Post, Patch, Delete, Param, Body, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { DepartmentsService, CreateDepartmentInput, UpdateDepartmentInput } from './departments.service';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentAccess } from '../auth/current-access.decorator';
import type { AccessPolicy } from '../auth/access-policy';

@ApiTags('departments')
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  @Get()
  @Permissions('reports:view')
  @ApiOperation({ summary: 'List all departments' })
  findAll(@CurrentOrgId() orgId: string, @CurrentAccess() access?: AccessPolicy) {
    return this.departmentsService.findAll(orgId, access?.scopeFor('report', 'reports:view'));
  }

  @Get(':id')
  @Permissions('reports:view')
  @ApiOperation({ summary: 'Get a department' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.departmentsService.findOne(
      id,
      orgId,
      access?.scopeFor('report', 'reports:view'),
    );
  }

  @Post()
  @Permissions('settings:manage')
  @ApiOperation({ summary: 'Create a department' })
  create(@Body() body: CreateDepartmentInput, @CurrentOrgId() orgId: string) {
    return this.departmentsService.create(orgId, body);
  }

  @Patch(':id')
  @Permissions('settings:manage')
  @ApiOperation({ summary: 'Update a department' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateDepartmentInput,
    @CurrentOrgId() orgId: string,
  ) {
    return this.departmentsService.update(id, orgId, body);
  }

  @Delete(':id')
  @Permissions('settings:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a department' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentOrgId() orgId: string) {
    return this.departmentsService.remove(id, orgId);
  }
}
