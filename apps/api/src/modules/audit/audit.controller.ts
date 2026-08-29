import { BadRequestException, Controller, ForbiddenException, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentAccess } from '../auth/current-access.decorator';
import type { AccessPolicy } from '../auth/access-policy';

@ApiTags('audit')
@Permissions('reports:view')
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'List audit log entries' })
  @ApiQuery({ name: 'entityType', required: false })
  @ApiQuery({ name: 'entityId', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  findAll(
    @CurrentOrgId() orgId: string,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('limit') limit?: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    const reportScope = access?.scopeFor('report', 'reports:view');
    if (!reportScope?.unrestricted) {
      throw new ForbiddenException('Audit log access requires a global grant');
    }

    return this.auditService.findAll(orgId, {
      entityType,
      entityId,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('verify')
  @ApiOperation({ summary: 'Verify the audit hash chain' })
  @ApiQuery({ name: 'from', required: false, type: String })
  @ApiQuery({ name: 'to', required: false, type: String })
  verify(
    @CurrentOrgId() orgId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    const reportScope = access?.scopeFor('report', 'reports:view');
    if (!reportScope?.unrestricted) {
      throw new ForbiddenException('Audit log access requires a global grant');
    }

    const range = {
      from: parseDateQuery('from', from),
      to: parseDateQuery('to', to),
    };
    if (range.from && range.to && range.from > range.to) {
      throw new BadRequestException('Audit verification from must be before to');
    }
    return this.auditService.verifyChain(orgId, range);
  }
}

function parseDateQuery(name: string, value?: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`Invalid audit ${name} date`);
  return date;
}
