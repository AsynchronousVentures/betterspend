import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

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
  ) {
    return this.auditService.findAll(orgId, {
      entityType,
      entityId,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
