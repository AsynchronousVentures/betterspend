import { Controller, Get, Post, Patch, Delete, Param, Body } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { parseRecurringPoCreateInput, parseRecurringPoUpdateInput } from './recurring-po.input';
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
  create(@CurrentOrgId() orgId: string, @CurrentUserId() userId: string, @Body() body: unknown) {
    return this.recurringPoService.create(orgId, userId, parseRecurringPoCreateInput(body));
  }

  @Patch(':id')
  @Permissions('purchase_orders:manage')
  @ApiOperation({ summary: 'Update a recurring PO schedule (pause/resume via active: false/true)' })
  update(@CurrentOrgId() orgId: string, @Param('id') id: string, @Body() body: unknown) {
    return this.recurringPoService.update(id, orgId, parseRecurringPoUpdateInput(body));
  }

  @Delete(':id')
  @Permissions('purchase_orders:manage')
  @ApiOperation({ summary: 'Delete a recurring PO schedule' })
  remove(@CurrentOrgId() orgId: string, @CurrentUserId() userId: string, @Param('id') id: string) {
    return this.recurringPoService.remove(id, orgId, userId);
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
