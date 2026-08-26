import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Authenticated } from '../../common/decorators/authenticated.decorator';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { IntakeConciergeService } from './intake-concierge.service';

@ApiTags('intake-concierge')
@Authenticated()
@Controller('intake/concierge')
export class IntakeConciergeController {
  constructor(private readonly conciergeService: IntakeConciergeService) {}

  @Get('policies')
  @Permissions('settings:manage')
  @ApiOperation({ summary: 'List admin-managed procurement concierge policies' })
  listPolicies(@CurrentOrgId() orgId: string) {
    return this.conciergeService.listPolicies(orgId);
  }

  @Post('policies')
  @Permissions('settings:manage')
  @ApiOperation({ summary: 'Create an admin-managed procurement concierge policy' })
  createPolicy(
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @Body()
    body: {
      title?: string;
      policyType?: string;
      body?: string;
      rules?: Record<string, unknown>;
      status?: string;
    },
  ) {
    return this.conciergeService.createPolicy(orgId, userId, body);
  }

  @Patch('policies/:id')
  @Permissions('settings:manage')
  @ApiOperation({ summary: 'Update an admin-managed procurement concierge policy' })
  updatePolicy(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @Body()
    body: {
      title?: string;
      policyType?: string;
      body?: string;
      rules?: Record<string, unknown>;
      status?: string;
    },
  ) {
    return this.conciergeService.updatePolicy(id, orgId, userId, body);
  }

  @Post('sessions')
  @ApiOperation({ summary: 'Start a procurement concierge session from plain-language intake' })
  createSession(
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @Body() body: { text?: string },
  ) {
    return this.conciergeService.createSession(orgId, userId, body);
  }

  @Get('sessions/:id')
  @ApiOperation({ summary: 'Get a procurement concierge session' })
  findSession(@Param('id', ParseUUIDPipe) id: string, @CurrentOrgId() orgId: string) {
    return this.conciergeService.findSession(id, orgId);
  }

  @Post('sessions/:id/messages')
  @ApiOperation({
    summary: 'Add information to a procurement concierge session and refresh guidance',
  })
  addMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @Body() body: { message?: string },
  ) {
    return this.conciergeService.addMessage(id, orgId, userId, body);
  }

  @Post('sessions/:id/convert')
  @ApiOperation({ summary: 'Convert an accepted concierge plan into the routed workflow' })
  convertSession(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @Body()
    body: {
      workflow?: 'requisition' | 'rfq' | 'vendor_onboarding' | 'software_license';
      acceptedValues?: Record<string, unknown>;
    },
  ) {
    return this.conciergeService.convertSession(id, orgId, userId, body ?? {});
  }
}
