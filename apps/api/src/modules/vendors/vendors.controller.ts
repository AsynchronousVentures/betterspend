import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { VendorsService } from './vendors.service';
import { vendorSchema } from '@betterspend/shared';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';

@ApiTags('vendors')
@Controller('vendors')
export class VendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  @Get()
  @ApiOperation({ summary: 'List all vendors' })
  findAll(@CurrentOrgId() orgId: string, @Query('entityId') entityId?: string) {
    return this.vendorsService.findAll(orgId, entityId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a vendor by ID' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentOrgId() orgId: string) {
    return this.vendorsService.findOne(id, orgId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a vendor' })
  create(@Body() body: unknown, @CurrentOrgId() orgId: string) {
    const parsed = vendorSchema.parse(body);
    return this.vendorsService.create({
      organizationId: orgId,
      entityId: (body as any)?.entityId ?? null,
      ...parsed,
    });
  }

  @Get(':id/transactions')
  @ApiOperation({ summary: 'Get invoices and POs for a vendor' })
  transactions(@Param('id', ParseUUIDPipe) id: string, @CurrentOrgId() orgId: string) {
    return this.vendorsService.getTransactions(id, orgId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a vendor' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentOrgId() orgId: string,
  ) {
    const parsed = vendorSchema.partial().parse(body);
    return this.vendorsService.update(id, orgId, { ...parsed, entityId: (body as any)?.entityId });
  }

  @Patch(':id/esg')
  @ApiOperation({ summary: 'Update vendor ESG and diversity data' })
  updateEsg(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentOrgId() orgId: string,
  ) {
    return this.vendorsService.updateEsg(id, orgId, body as any);
  }

  @Get('diversity/summary')
  @ApiOperation({ summary: 'Get supplier diversity and ESG summary for the organization' })
  diversitySummary(@CurrentOrgId() orgId: string) {
    return this.vendorsService.getDiversitySummary(orgId);
  }
}
