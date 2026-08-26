import {
  Controller, Get, Post, Patch, Delete, Param, Body, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { WebhooksService, CreateWebhookEndpointInput, UpdateWebhookEndpointInput } from './webhooks.service';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('webhooks')
@Permissions('settings:manage')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Get()
  @ApiOperation({ summary: 'List webhook endpoints' })
  findAll(@CurrentOrgId() orgId: string) {
    return this.webhooksService.findAll(orgId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get webhook endpoint with recent deliveries' })
  findOne(@Param('id') id: string, @CurrentOrgId() orgId: string) {
    return this.webhooksService.findOne(id, orgId);
  }

  @Post()
  @ApiOperation({ summary: 'Create webhook endpoint' })
  create(@Body() body: CreateWebhookEndpointInput, @CurrentOrgId() orgId: string) {
    return this.webhooksService.create(orgId, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update webhook endpoint' })
  update(@Param('id') id: string, @Body() body: UpdateWebhookEndpointInput, @CurrentOrgId() orgId: string) {
    return this.webhooksService.update(id, orgId, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete webhook endpoint' })
  remove(@Param('id') id: string, @CurrentOrgId() orgId: string) {
    return this.webhooksService.remove(id, orgId);
  }

  @Get(':id/deliveries')
  @ApiOperation({ summary: 'List deliveries for an endpoint' })
  listDeliveries(@Param('id') id: string, @CurrentOrgId() orgId: string) {
    return this.webhooksService.listDeliveries(id, orgId);
  }
}
