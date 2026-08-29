import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { softwareLicenseSchema } from '@betterspend/shared';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import { OperationalPermissions } from '../../common/decorators/operational-permissions.decorator';
import { CurrentAccess } from '../auth/current-access.decorator';
import type { AccessPolicy } from '../auth/access-policy';
import { SoftwareLicensesService } from './software-licenses.service';

@ApiTags('software-licenses')
@Controller('software-licenses')
export class SoftwareLicensesController {
  constructor(private readonly softwareLicensesService: SoftwareLicensesService) {}

  @Get()
  @OperationalPermissions('software_licenses:view')
  @ApiOperation({ summary: 'List software licenses' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'vendorId', required: false })
  @ApiQuery({ name: 'renewingWithinDays', required: false })
  findAll(
    @CurrentOrgId() orgId: string,
    @Query('status') status?: string,
    @Query('vendorId') vendorId?: string,
    @Query('renewingWithinDays') renewingWithinDays?: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.softwareLicensesService.findAll(
      orgId,
      {
        status,
        vendorId,
        renewingWithinDays: renewingWithinDays ? parseInt(renewingWithinDays, 10) : undefined,
      },
      access,
    );
  }

  @Get('renewal-calendar')
  @OperationalPermissions('software_licenses:view')
  @ApiOperation({ summary: 'Get upcoming license renewals' })
  @ApiQuery({ name: 'days', required: false })
  renewalCalendar(
    @CurrentOrgId() orgId: string,
    @Query('days') days?: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.softwareLicensesService.renewalCalendar(
      orgId,
      days ? parseInt(days, 10) : 90,
      access,
    );
  }

  @Get('utilization')
  @OperationalPermissions('software_licenses:view')
  @ApiOperation({ summary: 'Get software license utilization report' })
  utilization(@CurrentOrgId() orgId: string, @CurrentAccess() access?: AccessPolicy) {
    return this.softwareLicensesService.utilization(orgId, access);
  }

  @Get(':id')
  @OperationalPermissions('software_licenses:view')
  @ApiOperation({ summary: 'Get software license by ID' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.softwareLicensesService.findOne(id, orgId, access);
  }

  @Post()
  @OperationalPermissions('software_licenses:manage')
  @ApiOperation({ summary: 'Create a software license' })
  create(
    @Body() body: unknown,
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    const parsed = softwareLicenseSchema.parse(body);
    return this.softwareLicensesService.create(
      {
        organizationId: orgId,
        ...parsed,
        renewalDate: parsed.renewalDate ? new Date(parsed.renewalDate) : undefined,
        contractId: parsed.contractId ?? null,
        ownerUserId: parsed.ownerUserId ?? null,
        notes: parsed.notes ?? null,
      } as any,
      access,
    );
  }

  @Patch(':id')
  @OperationalPermissions('software_licenses:manage')
  @ApiOperation({ summary: 'Update a software license' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    const parsed = softwareLicenseSchema.partial().parse(body);
    return this.softwareLicensesService.update(
      id,
      orgId,
      {
        ...parsed,
        renewalDate: parsed.renewalDate ? new Date(parsed.renewalDate) : undefined,
      } as any,
      access,
    );
  }

  @Post(':id/renewal-action')
  @OperationalPermissions('software_licenses:manage')
  @ApiOperation({ summary: 'Apply a renewal action to a software license' })
  renewalAction(
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      action?: 'renew' | 'renegotiate' | 'cancel';
      note?: string;
      idempotencyKey?: string;
    },
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @CurrentAccess() access?: AccessPolicy,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const action = body?.action;
    if (!action || !['renew', 'renegotiate', 'cancel'].includes(action)) {
      throw new BadRequestException('Valid action is required');
    }
    return this.softwareLicensesService.applyRenewalAction(
      id,
      orgId,
      userId,
      action,
      body?.note,
      access,
      idempotencyKey ?? body?.idempotencyKey,
    );
  }
}
