import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { CatalogService, CreateCatalogItemInput, UpdateCatalogItemInput } from './catalog.service';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';

@ApiTags('catalog')
@Controller('catalog-items')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get()
  @ApiOperation({ summary: 'List catalog items' })
  @ApiQuery({ name: 'vendorId', required: false })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'activeOnly', required: false, type: Boolean })
  findAll(
    @CurrentOrgId() orgId: string,
    @Query('vendorId') vendorId?: string,
    @Query('category') category?: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.catalogService.findAll(orgId, {
      vendorId,
      category,
      activeOnly: activeOnly === 'true',
    });
  }

  @Get('search')
  @ApiOperation({ summary: 'Search catalog items by name, SKU, or description' })
  @ApiQuery({ name: 'q', required: true })
  search(@CurrentOrgId() orgId: string, @Query('q') q: string) {
    return this.catalogService.search(orgId, q ?? '');
  }

  @Get('categories')
  @ApiOperation({ summary: 'List all catalog categories' })
  getCategories(@CurrentOrgId() orgId: string) {
    return this.catalogService.getCategories(orgId);
  }

  @Get('price-proposals')
  @ApiOperation({ summary: 'List supplier price proposals' })
  @ApiQuery({ name: 'status', required: false })
  listPriceProposals(@CurrentOrgId() orgId: string, @Query('status') status?: string) {
    return this.catalogService.listPriceProposals(orgId, status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a catalog item' })
  findOne(@Param('id') id: string, @CurrentOrgId() orgId: string) {
    return this.catalogService.findOne(id, orgId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a catalog item' })
  create(@Body() body: CreateCatalogItemInput, @CurrentOrgId() orgId: string) {
    return this.catalogService.create(orgId, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a catalog item' })
  update(@Param('id') id: string, @Body() body: UpdateCatalogItemInput, @CurrentOrgId() orgId: string) {
    return this.catalogService.update(id, orgId, body);
  }

  @Patch(':id/price-proposals/:proposalId/review')
  @ApiOperation({ summary: 'Approve or reject a supplier price proposal' })
  reviewPriceProposal(
    @Param('id') _id: string,
    @Param('proposalId') proposalId: string,
    @Body() body: { status: 'approved' | 'rejected'; reviewNote?: string },
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.catalogService.reviewPriceProposal(proposalId, orgId, userId, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a catalog item' })
  remove(@Param('id') id: string, @CurrentOrgId() orgId: string) {
    return this.catalogService.remove(id, orgId);
  }
}
