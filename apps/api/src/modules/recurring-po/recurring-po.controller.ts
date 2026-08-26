import { Controller, Get, Post, Patch, Delete, Param, Body } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RecurringPoService } from './recurring-po.service';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';

@ApiTags('recurring-po')
@Controller('recurring-po')
export class RecurringPoController {
  constructor(private readonly recurringPoService: RecurringPoService) {}

  @Get()
  @Permissions('purchase_orders:view_all')
  @ApiOperation({ summary: 'List all recurring PO schedules for the organization' })
  list(@CurrentOrgId() orgId: string) {
    return this.recurringPoService.findAll(orgId);
  }

  @Get(':id')
  @Permissions('purchase_orders:view_all')
  @ApiOperation({ summary: 'Get a single recurring PO schedule' })
  findOne(@CurrentOrgId() orgId: string, @Param('id') id: string) {
    return this.recurringPoService.findOne(id, orgId);
  }

  @Post()
  @Permissions('purchase_orders:create')
  @ApiOperation({ summary: 'Create a new recurring PO schedule' })
  create(
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @Body()
    dto: {
      title: string;
      description?: string;
      vendorId?: string;
      frequency: 'weekly' | 'monthly' | 'quarterly' | 'annually';
      dayOfMonth?: number;
      totalAmount: number;
      currency?: string;
      lines: Array<{
        description: string;
        quantity: number;
        unitPrice: number;
        unitOfMeasure?: string;
      }>;
      glAccount?: string;
      notes?: string;
      maxRuns?: number;
      startDate?: string;
    },
  ) {
    return this.recurringPoService.create(orgId, userId, dto);
  }

  @Patch(':id')
  @Permissions('purchase_orders:manage')
  @ApiOperation({ summary: 'Update a recurring PO schedule (pause/resume via active: false/true)' })
  update(
    @CurrentOrgId() orgId: string,
    @Param('id') id: string,
    @Body()
    dto: {
      title?: string;
      description?: string;
      vendorId?: string;
      active?: boolean;
      frequency?: 'weekly' | 'monthly' | 'quarterly' | 'annually';
      dayOfMonth?: number;
      totalAmount?: number;
      currency?: string;
      lines?: Array<{
        description: string;
        quantity: number;
        unitPrice: number;
        unitOfMeasure?: string;
      }>;
      glAccount?: string;
      notes?: string;
      maxRuns?: number;
    },
  ) {
    return this.recurringPoService.update(id, orgId, dto);
  }

  @Delete(':id')
  @Permissions('purchase_orders:manage')
  @ApiOperation({ summary: 'Delete a recurring PO schedule' })
  remove(@CurrentOrgId() orgId: string, @Param('id') id: string) {
    return this.recurringPoService.remove(id, orgId);
  }

  @Post(':id/run')
  @Permissions('purchase_orders:manage')
  @ApiOperation({ summary: 'Manually trigger a run — creates a draft PO from the template' })
  run(@CurrentOrgId() orgId: string, @CurrentUserId() userId: string, @Param('id') id: string) {
    return this.recurringPoService.triggerRun(id, orgId, userId);
  }

  @Post(':id/skip-next')
  @Permissions('purchase_orders:manage')
  @ApiOperation({ summary: 'Skip the next scheduled run for a recurring PO' })
  skipNext(@CurrentOrgId() orgId: string, @Param('id') id: string) {
    return this.recurringPoService.skipNext(id, orgId);
  }
}
