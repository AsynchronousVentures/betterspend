import { Controller, Get, Post, Patch, Body, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ReceivingService, CreateGrnInput } from './receiving.service';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';

@ApiTags('receiving')
@ApiBearerAuth()
@Controller('receiving')
export class ReceivingController {
  constructor(private readonly receivingService: ReceivingService) {}

  @Get()
  @ApiOperation({ summary: 'List all goods receipts' })
  findAll(@CurrentOrgId() orgId: string) {
    return this.receivingService.findAll(orgId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a GRN by ID' })
  findOne(@Param('id') id: string, @CurrentOrgId() orgId: string) {
    return this.receivingService.findOne(id, orgId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a goods receipt (GRN)' })
  create(
    @Body() body: Omit<CreateGrnInput, 'receivedBy'> & { receivedBy?: string },
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.receivingService.create(orgId, { ...body, receivedBy: userId });
  }

  @Patch(':id/confirm')
  @ApiOperation({ summary: 'Confirm a draft GRN' })
  confirm(@Param('id') id: string, @CurrentOrgId() orgId: string) {
    return this.receivingService.confirm(id, orgId);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancel a GRN' })
  cancel(@Param('id') id: string, @CurrentOrgId() orgId: string) {
    return this.receivingService.cancelGrn(id, orgId);
  }
}
