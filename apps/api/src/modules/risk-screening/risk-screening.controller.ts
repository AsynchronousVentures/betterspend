import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RiskScreeningService } from './risk-screening.service';

@ApiTags('risk-screening')
@Controller('risk-screening')
export class RiskScreeningController {
  constructor(private readonly riskScreeningService: RiskScreeningService) {}

  @Get()
  @ApiOperation({ summary: 'Sanctions screening status for all vendors' })
  listStatus(@CurrentOrgId() orgId: string) {
    return this.riskScreeningService.listStatus(orgId);
  }

  @Post('vendors/:vendorId/screen')
  @Roles('admin', 'approver', 'finance')
  @ApiOperation({ summary: 'Re-screen a single vendor against sanctions entries' })
  screenVendor(
    @Param('vendorId', ParseUUIDPipe) vendorId: string,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.riskScreeningService.screenVendor(orgId, vendorId, userId);
  }

  @Post('screen-all')
  @Roles('admin', 'approver')
  @ApiOperation({ summary: 'Re-screen every active vendor' })
  screenAll(@CurrentOrgId() orgId: string, @CurrentUserId() userId: string) {
    return this.riskScreeningService.screenAllVendors(orgId, userId);
  }

  @Post('vendors/:vendorId/manual-review')
  @Roles('admin')
  @ApiOperation({ summary: 'Record a manual review decision for a flagged vendor' })
  manualReview(
    @Param('vendorId', ParseUUIDPipe) vendorId: string,
    @Body() body: { note?: string },
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.riskScreeningService.manualReview(orgId, vendorId, userId, String(body?.note ?? ''));
  }

  @Post('ingest')
  @Roles('admin')
  @ApiOperation({ summary: 'Download and replace the local sanctions list for a source' })
  ingest(
    @Body() body: { source?: string },
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    // URLs are server-controlled per source; request bodies cannot point the
    // fetch at arbitrary hosts.
    return this.riskScreeningService.ingest(orgId, userId, body?.source ?? 'ofac_sdn');
  }
}
