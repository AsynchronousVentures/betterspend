import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { manualSanctionsReviewSchema, sanctionsIngestRequestSchema } from '@betterspend/shared';
import type { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { RiskScreeningService } from './risk-screening.service';

@ApiTags('risk-screening')
@Controller('risk-screening')
export class RiskScreeningController {
  constructor(private readonly riskScreeningService: RiskScreeningService) {}

  /**
   * Screening status is sensitive compliance data. Unlike the demo-friendly
   * org/user header fallbacks used elsewhere, every route here requires a
   * real session and derives identity from it.
   */
  private requireSession(req: Request): { organizationId: string; userId: string } {
    if (!req.authUser?.organizationId || !req.authUser.id) {
      throw new UnauthorizedException('Authentication required');
    }
    return { organizationId: req.authUser.organizationId, userId: req.authUser.id };
  }

  @Get()
  @Roles('admin', 'approver', 'finance')
  @ApiOperation({ summary: 'Sanctions screening status for all vendors' })
  listStatus(@Req() req: Request) {
    const { organizationId } = this.requireSession(req);
    return this.riskScreeningService.listStatus(organizationId);
  }

  @Post('vendors/:vendorId/screen')
  @Roles('admin', 'approver', 'finance')
  @ApiOperation({ summary: 'Re-screen a single vendor against sanctions entries' })
  screenVendor(@Param('vendorId', ParseUUIDPipe) vendorId: string, @Req() req: Request) {
    const { organizationId, userId } = this.requireSession(req);
    return this.riskScreeningService.screenVendor(organizationId, vendorId, userId);
  }

  @Post('screen-all')
  @Roles('admin', 'approver')
  @ApiOperation({ summary: 'Re-screen every active vendor' })
  screenAll(@Req() req: Request) {
    const { organizationId, userId } = this.requireSession(req);
    return this.riskScreeningService.screenAllVendors(organizationId, userId);
  }

  @Post('vendors/:vendorId/manual-review')
  @Roles('admin')
  @ApiOperation({ summary: 'Record a manual review decision for a flagged vendor' })
  manualReview(
    @Param('vendorId', ParseUUIDPipe) vendorId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const { organizationId, userId } = this.requireSession(req);
    const { note } = manualSanctionsReviewSchema.parse(body);
    return this.riskScreeningService.manualReview(organizationId, vendorId, userId, note);
  }

  @Post('ingest')
  @Roles('admin')
  @ApiOperation({ summary: 'Download and replace the local sanctions list for a source' })
  ingest(@Body() body: unknown, @Req() req: Request) {
    // URLs are server-controlled per source; request bodies cannot point the
    // fetch at arbitrary hosts.
    const { organizationId, userId } = this.requireSession(req);
    const { source = 'ofac_sdn' } = sanctionsIngestRequestSchema.parse(body);
    return this.riskScreeningService.ingest(organizationId, userId, source);
  }
}
