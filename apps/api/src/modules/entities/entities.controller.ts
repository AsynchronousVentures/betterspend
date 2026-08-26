import { Body, Controller, Delete, Get, Param, ParseBoolPipe, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CreateLegalEntityInput, EntitiesService, UpdateLegalEntityInput } from './entities.service';

@ApiTags('entities')
@Controller('entities')
export class EntitiesController {
  constructor(private readonly entitiesService: EntitiesService) {}

  @Get()
  @Permissions('settings:manage')
  @ApiOperation({ summary: 'List legal entities for the organization' })
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  findAll(
    @CurrentOrgId() organizationId: string,
    @Query('includeInactive', new ParseBoolPipe({ optional: true })) includeInactive?: boolean,
  ) {
    return this.entitiesService.findAll(organizationId, includeInactive ?? false);
  }

  @Get(':id')
  @Permissions('settings:manage')
  @ApiOperation({ summary: 'Get a legal entity by ID' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentOrgId() organizationId: string) {
    return this.entitiesService.findOne(id, organizationId);
  }

  @Post()
  @Permissions('settings:manage')
  @ApiOperation({ summary: 'Create a legal entity' })
  create(@Body() body: CreateLegalEntityInput, @CurrentOrgId() organizationId: string) {
    return this.entitiesService.create(organizationId, body);
  }

  @Patch(':id')
  @Permissions('settings:manage')
  @ApiOperation({ summary: 'Update a legal entity' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateLegalEntityInput,
    @CurrentOrgId() organizationId: string,
  ) {
    return this.entitiesService.update(id, organizationId, body);
  }

  @Delete(':id')
  @Permissions('settings:manage')
  @ApiOperation({ summary: 'Deactivate a legal entity' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentOrgId() organizationId: string) {
    return this.entitiesService.remove(id, organizationId);
  }
}
