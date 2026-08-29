import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import {
  QBO_SYNC_ENTITY_TYPES,
  qboMappingLinkInputSchema,
  qboSyncRequestSchema,
} from '@betterspend/shared';
import { CurrentOrgId } from '../../../common/decorators/current-org-id.decorator';
import { CurrentUserId } from '../../../common/decorators/current-user-id.decorator';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { QboInboundService } from './qbo-inbound.service';

@ApiTags('integrations/qbo')
@Controller('integrations/qbo')
export class QboInboundController {
  constructor(private readonly qboInboundService: QboInboundService) {}

  @Get('mappings')
  @Permissions('reports:view')
  @ApiOperation({ summary: 'List cached QuickBooks Online master-data mappings' })
  @ApiQuery({ name: 'externalEntity', required: false })
  listMappings(
    @CurrentOrgId() organizationId: string,
    @Query('externalEntity') externalEntity?: string,
  ) {
    return this.qboInboundService.listMappings(organizationId, externalEntity);
  }

  @Patch('mappings/:id')
  @Permissions('reports:export')
  @ApiOperation({ summary: 'Link a cached QuickBooks Online row to a local record' })
  @ApiBody({
    description: 'Set or clear the local record linked to this cached QBO entity.',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['localId'],
      properties: {
        localId: { type: 'string', format: 'uuid', nullable: true },
        autoCreated: {
          type: 'boolean',
          description: 'Whether BetterSpend created the linked local record during mapping.',
        },
      },
    },
  })
  linkMapping(
    @Param('id', ParseUUIDPipe) mappingId: string,
    @CurrentOrgId() organizationId: string,
    @CurrentUserId() userId: string,
    @Body() body: unknown,
  ) {
    const input = qboMappingLinkInputSchema.parse(body);
    return this.qboInboundService.linkMapping(mappingId, organizationId, input, userId);
  }

  @Post('sync')
  @Permissions('reports:export')
  @ApiOperation({ summary: 'Queue a QuickBooks Online master-data sync' })
  @ApiBody({
    required: false,
    description: 'Optionally limit the queued import to selected QBO entity types.',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        entityTypes: {
          type: 'array',
          minItems: 1,
          items: { type: 'string', enum: [...QBO_SYNC_ENTITY_TYPES] },
        },
      },
    },
  })
  async enqueueSync(@CurrentOrgId() organizationId: string, @Body() body: unknown) {
    const input = qboSyncRequestSchema.parse(body ?? {});
    return this.qboInboundService.enqueueInitialSync(organizationId, input.entityTypes);
  }

  @Post('cdc')
  @Permissions('reports:export')
  @ApiOperation({ summary: 'Queue a QuickBooks Online CDC sweep' })
  async enqueueCdc(@CurrentOrgId() organizationId: string) {
    return this.qboInboundService.enqueueCdcSweep(organizationId);
  }

  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Accept a signed QuickBooks Online webhook notification' })
  receiveWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('intuit-signature') signature?: string,
  ) {
    if (!request.rawBody) {
      throw new BadRequestException('QBO webhook raw body is unavailable');
    }
    return this.qboInboundService.receiveWebhook(request.rawBody, signature);
  }
}
