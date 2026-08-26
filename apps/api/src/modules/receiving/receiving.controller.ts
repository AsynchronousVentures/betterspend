import { Controller, Get, Post, Patch, Body, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import {
  ReceivingService,
  CreateGrnInput,
  ReceivingDetail,
  ReceivingListItem,
} from './receiving.service';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import { CurrentAccess } from '../auth/current-access.decorator';
import type { AccessPolicy } from '../auth/access-policy';

@ApiTags('receiving')
@ApiBearerAuth()
@Controller('receiving')
export class ReceivingController {
  constructor(private readonly receivingService: ReceivingService) {}

  @Get()
  @ApiOperation({ summary: 'List all goods receipts' })
  findAll(
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ): Promise<ReceivingListItem[]> {
    return this.receivingService.findAll(orgId, access);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a GRN by ID' })
  findOne(
    @Param('id') id: string,
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ): Promise<ReceivingDetail> {
    return this.receivingService.findOne(id, orgId, access);
  }

  @Post()
  @ApiOperation({ summary: 'Create a goods receipt (GRN)' })
  create(
    @Body() body: Omit<CreateGrnInput, 'receivedBy'> & { receivedBy?: string },
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.receivingService.create(orgId, { ...body, receivedBy: userId }, access);
  }

  @Patch(':id/confirm')
  @ApiOperation({ summary: 'Confirm a draft GRN' })
  confirm(
    @Param('id') id: string,
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.receivingService.confirm(id, orgId, access);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancel a GRN' })
  cancel(
    @Param('id') id: string,
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.receivingService.cancelGrn(id, orgId, access);
  }
}
