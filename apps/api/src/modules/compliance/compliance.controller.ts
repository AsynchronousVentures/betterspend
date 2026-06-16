import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ComplianceService, ComplianceFramework } from './compliance.service';

@ApiTags('compliance')
@Roles('admin')
@Controller('compliance')
export class ComplianceController {
  constructor(private readonly complianceService: ComplianceService) {}

  @Get('audit-package/preview')
  @ApiOperation({ summary: 'Preview audit evidence package contents' })
  @ApiQuery({ name: 'framework', required: false, enum: ['soc2', 'iso27001', 'custom'] })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  previewAuditPackage(
    @CurrentOrgId() orgId: string,
    @Query('framework') framework?: ComplianceFramework,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.complianceService.previewAuditPackage(orgId, { framework, from, to });
  }

  @Post('audit-package')
  @ApiOperation({ summary: 'Generate an audit evidence ZIP package' })
  async generateAuditPackage(
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @Body() body: { framework?: ComplianceFramework; from?: string; to?: string },
    @Res() res: Response,
  ) {
    const file = await this.complianceService.generateAuditPackage(orgId, userId, body);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.buffer);
  }

  @Get('gdpr/export/:userId')
  @ApiOperation({ summary: 'Export personal data for a user' })
  exportUserData(
    @Param('userId', ParseUUIDPipe) subjectUserId: string,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() actorUserId: string,
  ) {
    return this.complianceService.exportUserData(orgId, actorUserId, subjectUserId);
  }

  @Post('gdpr/delete/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pseudonymize a departed user in non-audit records' })
  pseudonymizeUser(
    @Param('userId', ParseUUIDPipe) subjectUserId: string,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() actorUserId: string,
  ) {
    return this.complianceService.pseudonymizeUser(orgId, actorUserId, subjectUserId);
  }
}
