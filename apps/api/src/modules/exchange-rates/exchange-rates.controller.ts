import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ExchangeRatesService, UpsertExchangeRateInput } from './exchange-rates.service';

@ApiTags('exchange-rates')
@Controller('exchange-rates')
export class ExchangeRatesController {
  constructor(private readonly exchangeRatesService: ExchangeRatesService) {}

  @Get()
  @ApiOperation({ summary: 'List latest exchange rates for the organization' })
  list(@CurrentOrgId() orgId: string) {
    return this.exchangeRatesService.list(orgId);
  }

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Create or override an exchange rate' })
  create(@CurrentOrgId() orgId: string, @Body() body: UpsertExchangeRateInput) {
    return this.exchangeRatesService.upsert(orgId, body);
  }

  @Patch(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Update an exchange rate' })
  update(@CurrentOrgId() orgId: string, @Param('id') id: string, @Body() body: UpsertExchangeRateInput) {
    return this.exchangeRatesService.update(orgId, id, body);
  }

  @Delete(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Delete an exchange rate' })
  remove(@CurrentOrgId() orgId: string, @Param('id') id: string) {
    return this.exchangeRatesService.remove(orgId, id);
  }

  @Get('organization-base-currency')
  @ApiOperation({ summary: 'Get organization base currency' })
  async getBaseCurrency(@CurrentOrgId() orgId: string) {
    const baseCurrency = await this.exchangeRatesService.getOrganizationBaseCurrency(orgId);
    return { baseCurrency };
  }

  @Put('organization-base-currency')
  @Roles('admin')
  @ApiOperation({ summary: 'Update organization base currency' })
  updateBaseCurrency(@CurrentOrgId() orgId: string, @Body() body: { baseCurrency: string }) {
    return this.exchangeRatesService.updateOrganizationBaseCurrency(orgId, body.baseCurrency);
  }
}
