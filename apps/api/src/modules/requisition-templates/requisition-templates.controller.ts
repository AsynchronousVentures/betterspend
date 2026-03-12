import {
  Controller, Get, Post, Patch, Delete, Param, Body, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RequisitionTemplatesService } from './requisition-templates.service';
import { createRequisitionTemplateSchema, createTemplateFromRequisitionSchema } from '@betterspend/shared';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';

@ApiTags('requisition-templates')
@Controller('requisition-templates')
export class RequisitionTemplatesController {
  constructor(private readonly service: RequisitionTemplatesService) {}

  @Get()
  @ApiOperation({ summary: 'List requisition templates visible to the current user' })
  findAll(@CurrentOrgId() orgId: string, @CurrentUserId() userId: string) {
    return this.service.findAll(orgId, userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single template' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.service.findOne(id, orgId, userId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a requisition template' })
  create(
    @Body() body: unknown,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    const parsed = createRequisitionTemplateSchema.parse(body);
    return this.service.create(orgId, userId, parsed);
  }

  @Post('from-requisition/:requisitionId')
  @ApiOperation({ summary: 'Save an existing requisition as a template' })
  createFromRequisition(
    @Param('requisitionId', ParseUUIDPipe) requisitionId: string,
    @Body() body: unknown,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    const parsed = createTemplateFromRequisitionSchema.parse(body);
    return this.service.createFromRequisition(requisitionId, orgId, userId, parsed);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a template (owner only)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    const parsed = createRequisitionTemplateSchema.partial().parse(body);
    return this.service.update(id, orgId, userId, parsed);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a template (owner only)' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.service.remove(id, orgId, userId);
  }

  @Get(':id/apply')
  @ApiOperation({ summary: 'Get the pre-filled requisition payload from a template' })
  apply(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.service.applyTemplate(id, orgId, userId);
  }
}
