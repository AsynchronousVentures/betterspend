import { Controller, Post, Get, Param, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PunchoutService } from './punchout.service';
import type { PunchOutSetupRequest, PunchOutOrderMessage } from './cxml.types';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';

@ApiTags('punchout')
@Controller('punchout')
export class PunchoutController {
  constructor(private readonly punchoutService: PunchoutService) {}

  /**
   * POST /punchout/vendors/:vendorId/setup
   * Receives a PunchOutSetupRequest (JSON representation of cXML).
   * Returns a PunchOutSetupResponse with a start-page URL.
   *
   * In production: receives raw cXML text/xml, parsed before reaching here.
   */
  @Post('vendors/:vendorId/setup')
  @ApiOperation({
    summary: 'Initiate a punchout session for a vendor',
    description:
      'Accepts JSON-shaped PunchOutSetupRequest. Full cXML XML parsing is wired in Phase 5b.',
  })
  setup(
    @Param('vendorId') vendorId: string,
    @Body() body: PunchOutSetupRequest,
    @CurrentOrgId() organizationId: string,
  ) {
    return this.punchoutService.handleSetupRequest(vendorId, organizationId, body);
  }

  /**
   * POST /punchout/return
   * Receives the OrderMessage when the buyer returns from the vendor catalog.
   * Returns the mapped requisition lines for the caller to create a requisition.
   */
  @Post('return')
  @ApiOperation({
    summary: 'Receive cart items from vendor punchout catalog',
    description: 'Call with session token and cart. Returns mapped requisition lines.',
  })
  orderReturn(@Query('session') session: string, @Body() body: PunchOutOrderMessage) {
    return this.punchoutService.handleOrderReturn(session, body);
  }

  /**
   * GET /punchout/session/:token
   * Retrieves session metadata (used by the catalog page to know which vendor/return URL to use).
   */
  @Get('session/:token')
  @ApiOperation({ summary: 'Get punchout session info (for the hosted catalog page)' })
  getSession(@Param('token') token: string) {
    const session = this.punchoutService.getSession(token);
    if (!session) return { valid: false };
    return { valid: true, vendorId: session.vendorId, createdAt: session.createdAt };
  }
}
