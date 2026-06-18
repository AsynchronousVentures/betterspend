import {
  Controller, Get, Post, Patch, Param, Body, Query, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { RequisitionsService } from './requisitions.service';
import { AiRequisitionService } from './ai-requisition.service';
import { createRequisitionSchema } from '@betterspend/shared';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';

@ApiTags('requisitions')
@Controller('requisitions')
export class RequisitionsController {
  constructor(
    private readonly requisitionsService: RequisitionsService,
    private readonly aiRequisitionService: AiRequisitionService,
  ) {}

  @Post('ai-parse')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Parse plain-language text into a structured requisition draft using AI' })
  async aiParse(@Body('text') text: string, @CurrentOrgId() orgId: string) {
    if (!text?.trim()) return { error: 'text is required' };
    return this.aiRequisitionService.parseFromText(orgId, text.trim());
  }

  @Get()
  @ApiOperation({ summary: 'List requisitions' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'departmentId', required: false })
  findAll(
    @CurrentOrgId() orgId: string,
    @Query('status') status?: string,
    @Query('departmentId') departmentId?: string,
  ) {
    return this.requisitionsService.findAll(orgId, { status, departmentId });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get requisition detail' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentOrgId() orgId: string) {
    return this.requisitionsService.findOne(id, orgId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a requisition' })
  create(@Body() body: unknown, @CurrentOrgId() orgId: string, @CurrentUserId() userId: string) {
    const parsed = createRequisitionSchema.parse(body);
    return this.requisitionsService.create(orgId, userId, parsed);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a draft requisition' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentOrgId() orgId: string) {
    const parsed = createRequisitionSchema.partial().parse(body);
    return this.requisitionsService.update(id, orgId, parsed);
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit requisition for approval' })
  submit(@Param('id', ParseUUIDPipe) id: string, @CurrentOrgId() orgId: string, @CurrentUserId() userId: string) {
    return this.requisitionsService.submit(id, orgId, userId);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a requisition' })
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentOrgId() orgId: string) {
    return this.requisitionsService.cancel(id, orgId);
  }
}
