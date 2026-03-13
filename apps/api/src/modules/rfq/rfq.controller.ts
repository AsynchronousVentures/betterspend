import { Controller, Get, Post, Patch, Param, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RfqService } from './rfq.service';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';

@ApiTags('rfq')
@Controller('rfq')
export class RfqController {
  constructor(private readonly rfqService: RfqService) {}

  @Get()
  @ApiOperation({ summary: 'List all RFQs for the organization' })
  list(@CurrentOrgId() orgId: string) {
    return this.rfqService.list(orgId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single RFQ with lines, invitations, and responses' })
  findOne(@CurrentOrgId() orgId: string, @Param('id') id: string) {
    return this.rfqService.findOne(orgId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new RFQ' })
  create(
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @Body() dto: {
      title: string;
      description?: string;
      dueDate?: string;
      currency?: string;
      notes?: string;
      lines: Array<{ description: string; quantity: number; unitOfMeasure?: string; targetPrice?: number }>;
      vendorIds?: string[];
    },
  ) {
    return this.rfqService.create(orgId, userId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an RFQ' })
  update(
    @CurrentOrgId() orgId: string,
    @Param('id') id: string,
    @Body() dto: { title?: string; description?: string; dueDate?: string; notes?: string },
  ) {
    return this.rfqService.update(orgId, id, dto);
  }

  @Post(':id/open')
  @ApiOperation({ summary: 'Open an RFQ for vendor responses' })
  open(@CurrentOrgId() orgId: string, @Param('id') id: string) {
    return this.rfqService.open(orgId, id);
  }

  @Post(':id/close')
  @ApiOperation({ summary: 'Close an RFQ' })
  close(@CurrentOrgId() orgId: string, @Param('id') id: string) {
    return this.rfqService.close(orgId, id);
  }

  @Post(':id/award')
  @ApiOperation({ summary: 'Award an RFQ to a vendor response' })
  award(
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Body('responseId') responseId: string,
  ) {
    return this.rfqService.award(orgId, id, responseId, userId);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject an RFQ response with a reason' })
  reject(
    @CurrentOrgId() orgId: string,
    @Param('id') id: string,
    @Body() dto: { responseId: string; reason: string },
  ) {
    return this.rfqService.rejectResponse(orgId, id, dto.responseId, dto.reason);
  }

  @Post(':id/responses')
  @ApiOperation({ summary: 'Submit a vendor quote/response to an RFQ' })
  submitResponse(
    @CurrentOrgId() orgId: string,
    @Param('id') id: string,
    @Body() dto: {
      vendorId: string;
      notes?: string;
      validUntil?: string;
      lines: Array<{ rfqLineId: string; unitPrice: number; leadTimeDays?: number; notes?: string }>;
    },
  ) {
    return this.rfqService.submitResponse(orgId, id, dto);
  }
}
