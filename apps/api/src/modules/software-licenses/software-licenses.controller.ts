import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { softwareLicenseSchema } from '@betterspend/shared';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { SoftwareLicensesService } from './software-licenses.service';

@ApiTags('software-licenses')
@Controller('software-licenses')
export class SoftwareLicensesController {
  constructor(private readonly softwareLicensesService: SoftwareLicensesService) {}

  @Get()
  @ApiOperation({ summary: 'List software licenses' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'vendorId', required: false })
  @ApiQuery({ name: 'renewingWithinDays', required: false })
  findAll(
    @CurrentOrgId() orgId: string,
    @Query('status') status?: string,
    @Query('vendorId') vendorId?: string,
    @Query('renewingWithinDays') renewingWithinDays?: string,
  ) {
    return this.softwareLicensesService.findAll(orgId, {
      status,
      vendorId,
      renewingWithinDays: renewingWithinDays ? parseInt(renewingWithinDays, 10) : undefined,
    });
  }

  @Get('renewal-calendar')
  @ApiOperation({ summary: 'Get upcoming license renewals' })
  @ApiQuery({ name: 'days', required: false })
  renewalCalendar(@CurrentOrgId() orgId: string, @Query('days') days?: string) {
    return this.softwareLicensesService.renewalCalendar(orgId, days ? parseInt(days, 10) : 90);
  }

  @Get('utilization')
  @ApiOperation({ summary: 'Get software license utilization report' })
  utilization(@CurrentOrgId() orgId: string) {
    return this.softwareLicensesService.utilization(orgId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get software license by ID' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentOrgId() orgId: string) {
    return this.softwareLicensesService.findOne(id, orgId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a software license' })
  create(@Body() body: unknown, @CurrentOrgId() orgId: string) {
    const parsed = softwareLicenseSchema.parse(body);
    return this.softwareLicensesService.create({
      organizationId: orgId,
      ...parsed,
      renewalDate: parsed.renewalDate ? new Date(parsed.renewalDate) : undefined,
      contractId: parsed.contractId ?? null,
      ownerUserId: parsed.ownerUserId ?? null,
      notes: parsed.notes ?? null,
    } as any);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a software license' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentOrgId() orgId: string,
  ) {
    const parsed = softwareLicenseSchema.partial().parse(body);
    return this.softwareLicensesService.update(id, orgId, {
      ...parsed,
      renewalDate: parsed.renewalDate ? new Date(parsed.renewalDate) : undefined,
    } as any);
  }

  @Post(':id/renewal-action')
  @ApiOperation({ summary: 'Apply a renewal action to a software license' })
  renewalAction(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { action?: 'renew' | 'renegotiate' | 'cancel'; note?: string },
    @CurrentOrgId() orgId: string,
  ) {
    const action = body?.action;
    if (!action || !['renew', 'renegotiate', 'cancel'].includes(action)) {
      throw new BadRequestException('Valid action is required');
    }
    return this.softwareLicensesService.applyRenewalAction(id, orgId, action, body.note);
  }
}
