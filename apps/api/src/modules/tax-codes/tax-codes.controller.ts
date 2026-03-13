import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { TaxCodesService } from './tax-codes.service';

const createTaxCodeSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1).max(20),
  ratePercent: z.number().min(0).max(100),
  taxType: z.enum(['VAT', 'GST', 'SALES_TAX', 'EXEMPT']),
  isRecoverable: z.boolean().optional(),
  glAccountCode: z.string().max(50).optional(),
});

const updateTaxCodeSchema = createTaxCodeSchema.partial();

@ApiTags('tax-codes')
@Controller('tax-codes')
export class TaxCodesController {
  constructor(private readonly taxCodesService: TaxCodesService) {}

  @Get()
  @ApiOperation({ summary: 'List organization tax codes' })
  findAll(@CurrentOrgId() orgId: string) {
    return this.taxCodesService.findAll(orgId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get tax code detail' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentOrgId() orgId: string) {
    return this.taxCodesService.findOne(id, orgId);
  }

  @Post()
  @ApiOperation({ summary: 'Create tax code' })
  create(@Body() body: unknown, @CurrentOrgId() orgId: string) {
    return this.taxCodesService.create(orgId, createTaxCodeSchema.parse(body));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update tax code' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentOrgId() orgId: string) {
    return this.taxCodesService.update(id, orgId, updateTaxCodeSchema.parse(body));
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete tax code' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentOrgId() orgId: string) {
    return this.taxCodesService.remove(id, orgId);
  }
}
