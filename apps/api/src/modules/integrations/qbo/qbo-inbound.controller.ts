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
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentOrgId } from '../../../common/decorators/current-org-id.decorator';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import {
  QBO_CATALOG_ENTITY_TYPES,
  QBO_TAX_ENTITY_TYPES,
  QboInboundService,
  type QboSyncEntity,
} from './qbo-inbound.service';

const syncRequestSchema = z.object({
  entityTypes: z
    .array(z.enum([...QBO_CATALOG_ENTITY_TYPES, ...QBO_TAX_ENTITY_TYPES]))
    .min(1)
    .optional(),
});

const mappingLinkSchema = z.object({
  localId: z.string().uuid().nullable(),
  autoCreated: z.boolean().optional(),
});

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
  linkMapping(
    @Param('id', ParseUUIDPipe) mappingId: string,
    @CurrentOrgId() organizationId: string,
    @Body() body: unknown,
  ) {
    const input = mappingLinkSchema.parse(body);
    return this.qboInboundService.linkMapping(mappingId, organizationId, input);
  }

  @Post('sync')
  @Permissions('reports:export')
  @ApiOperation({ summary: 'Queue a QuickBooks Online master-data sync' })
  async enqueueSync(@CurrentOrgId() organizationId: string, @Body() body: unknown) {
    const input = syncRequestSchema.parse(body ?? {});
    return this.qboInboundService.enqueueInitialSync(
      organizationId,
      (input.entityTypes ?? [
        ...QBO_CATALOG_ENTITY_TYPES,
        ...QBO_TAX_ENTITY_TYPES,
      ]) as QboSyncEntity[],
    );
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
