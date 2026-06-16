import {
  Controller, Get, Post, Patch, Delete, Param, Body, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('users')
@Permissions('users:manage')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'List all users' })
  findAll(@CurrentOrgId() orgId: string) {
    return this.usersService.findAll(orgId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new user (admin)' })
  create(
    @Body() body: { name: string; email: string; password: string; role?: string },
    @CurrentOrgId() orgId: string,
  ) {
    return this.usersService.create(orgId, body);
  }

  @Get('roles/permissions')
  @ApiOperation({ summary: 'List assignable permission keys for custom roles' })
  permissionsCatalog() {
    return this.usersService.permissionsCatalog();
  }

  @Get('roles/custom')
  @ApiOperation({ summary: 'List custom roles' })
  customRoles(@CurrentOrgId() orgId: string) {
    return this.usersService.listCustomRoles(orgId);
  }

  @Post('roles/custom')
  @ApiOperation({ summary: 'Create a custom role' })
  createCustomRole(
    @Body() body: { name?: string; description?: string; permissions?: string[] },
    @CurrentOrgId() orgId: string,
  ) {
    return this.usersService.createCustomRole(orgId, body);
  }

  @Patch('roles/custom/:roleId')
  @ApiOperation({ summary: 'Update a custom role' })
  updateCustomRole(
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() body: { name?: string; description?: string | null; permissions?: string[] },
    @CurrentOrgId() orgId: string,
  ) {
    return this.usersService.updateCustomRole(roleId, orgId, body);
  }

  @Delete('roles/custom/:roleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a custom role and its assignments' })
  deleteCustomRole(
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @CurrentOrgId() orgId: string,
  ) {
    return this.usersService.deleteCustomRole(roleId, orgId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a user by ID' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentOrgId() orgId: string) {
    return this.usersService.findOne(id, orgId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update user (name, department, active)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { name?: string; departmentId?: string; isActive?: boolean },
    @CurrentOrgId() orgId: string,
  ) {
    return this.usersService.update(id, orgId, body);
  }

  @Post(':id/roles')
  @ApiOperation({ summary: 'Add a role to a user' })
  addRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { role?: string; customRoleId?: string; scopeType?: string; scopeId?: string },
    @CurrentOrgId() orgId: string,
  ) {
    return this.usersService.addRole(id, orgId, body);
  }

  @Delete(':id/roles/:roleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a role from a user' })
  removeRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @CurrentOrgId() orgId: string,
  ) {
    return this.usersService.removeRole(id, roleId, orgId);
  }

  @Patch(':id/deactivate')
  @ApiOperation({ summary: 'Deactivate a user' })
  deactivate(@Param('id', ParseUUIDPipe) id: string, @CurrentOrgId() orgId: string) {
    return this.usersService.update(id, orgId, { isActive: false });
  }

  @Patch(':id/activate')
  @ApiOperation({ summary: 'Activate a user' })
  activate(@Param('id', ParseUUIDPipe) id: string, @CurrentOrgId() orgId: string) {
    return this.usersService.update(id, orgId, { isActive: true });
  }
}
