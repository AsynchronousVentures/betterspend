import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Authenticated } from '../../common/decorators/authenticated.decorator';
import { SearchService } from './search.service';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';

@ApiTags('search')
@Authenticated()
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @ApiOperation({ summary: 'Global search across entities' })
  search(@Query('q') q: string, @CurrentOrgId() orgId: string) {
    if (!q || q.trim().length < 2) return { requisitions: [], purchaseOrders: [], invoices: [], vendors: [], catalogItems: [] };
    return this.searchService.search(q.trim(), orgId);
  }
}
