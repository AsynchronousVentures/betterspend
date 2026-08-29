import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { z } from 'zod';
import { RfqService } from './rfq.service';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import { OperationalPermissions } from '../../common/decorators/operational-permissions.decorator';

@ApiTags('rfq')
@Controller('rfq')
export class RfqController {
  constructor(private readonly rfqService: RfqService) {}

  @Get()
  @OperationalPermissions('rfqs:view')
  @ApiOperation({ summary: 'List all RFQs for the organization' })
  list(@CurrentOrgId() orgId: string) {
    return this.rfqService.list(orgId);
  }

  @Get(':id')
  @OperationalPermissions('rfqs:view')
  @ApiOperation({ summary: 'Get a single RFQ with lines, invitations, and responses' })
  findOne(@CurrentOrgId() orgId: string, @Param('id') id: string) {
    return this.rfqService.findOne(orgId, id);
  }

  @Post()
  @OperationalPermissions('rfqs:manage')
  @ApiOperation({ summary: 'Create a new RFQ' })
  create(
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @Body()
    body: unknown,
  ) {
    return this.rfqService.create(orgId, userId, parseCreateRfqBody(body));
  }

  @Patch(':id')
  @OperationalPermissions('rfqs:manage')
  @ApiOperation({ summary: 'Update an RFQ' })
  update(
    @CurrentOrgId() orgId: string,
    @Param('id') id: string,
    @Body() dto: { title?: string; description?: string; dueDate?: string; notes?: string },
  ) {
    return this.rfqService.update(orgId, id, dto);
  }

  @Post(':id/open')
  @OperationalPermissions('rfqs:manage')
  @ApiOperation({ summary: 'Open an RFQ for vendor responses' })
  open(@CurrentOrgId() orgId: string, @CurrentUserId() userId: string, @Param('id') id: string) {
    return this.rfqService.open(orgId, id, userId);
  }

  @Post(':id/close')
  @OperationalPermissions('rfqs:manage')
  @ApiOperation({ summary: 'Close an RFQ' })
  close(@CurrentOrgId() orgId: string, @Param('id') id: string) {
    return this.rfqService.close(orgId, id);
  }

  @Post(':id/award')
  @OperationalPermissions('rfqs:manage')
  @ApiOperation({ summary: 'Award an RFQ to a vendor response' })
  award(
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Body('responseId') responseId: string,
  ) {
    return this.rfqService.award(orgId, id, responseId, userId);
  }

  @Post(':id/reject')
  @OperationalPermissions('rfqs:manage')
  @ApiOperation({ summary: 'Reject an RFQ response with a reason' })
  reject(
    @CurrentOrgId() orgId: string,
    @Param('id') id: string,
    @Body() dto: { responseId: string; reason: string },
  ) {
    return this.rfqService.rejectResponse(orgId, id, dto.responseId, dto.reason);
  }

  @Post(':id/responses')
  @OperationalPermissions('rfqs:manage')
  @ApiOperation({ summary: 'Submit a vendor quote/response to an RFQ' })
  submitResponse(
    @CurrentOrgId() orgId: string,
    @Param('id') id: string,
    @Body()
    dto: {
      vendorId: string;
      notes?: string;
      validUntil?: string;
      lines: Array<{ rfqLineId: string; unitPrice: number; leadTimeDays?: number; notes?: string }>;
    },
  ) {
    return this.rfqService.submitResponse(orgId, id, dto);
  }
}

const createRfqBodySchema = z.preprocess(
  (body) => {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return body;
    const record = body as Record<string, unknown>;
    if (record.dueDate !== '') return body;
    const { dueDate: _dueDate, ...withoutEmptyDueDate } = record;
    return withoutEmptyDueDate;
  },
  z
    .object({
      title: z.string().min(1),
      description: z.string().optional(),
      dueDate: z.union([z.iso.datetime({ offset: true }), z.iso.date()]).optional(),
      currency: z.string().optional(),
      notes: z.string().optional(),
      lines: z.array(
        z
          .object({
            description: z.string().min(1),
            quantity: z.number().positive(),
            unitOfMeasure: z.string().optional(),
            targetPrice: z.number().nonnegative().optional(),
          })
          .strict(),
      ),
      vendorIds: z.array(z.string().uuid()).optional(),
    })
    .strict(),
);

export function parseCreateRfqBody(body: unknown) {
  const parsed = createRfqBodySchema.safeParse(body);
  if (!parsed.success) throw new BadRequestException('Invalid RFQ request body');
  return parsed.data;
}
