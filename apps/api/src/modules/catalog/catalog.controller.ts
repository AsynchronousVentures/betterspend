import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { CatalogService, CreateCatalogItemInput, UpdateCatalogItemInput } from './catalog.service';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import { OperationalPermissions } from '../../common/decorators/operational-permissions.decorator';
import { CurrentAccess } from '../auth/current-access.decorator';
import type { AccessPolicy } from '../auth/access-policy';

@ApiTags('catalog')
@Controller('catalog-items')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get()
  @OperationalPermissions('catalog:view')
  @ApiOperation({ summary: 'List catalog items' })
  @ApiQuery({ name: 'vendorId', required: false })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'activeOnly', required: false, type: Boolean })
  findAll(
    @CurrentOrgId() orgId: string,
    @Query('vendorId') vendorId?: string,
    @Query('category') category?: string,
    @Query('activeOnly') activeOnly?: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.catalogService.findAll(
      orgId,
      {
        vendorId,
        category,
        activeOnly: activeOnly === 'true',
      },
      access,
    );
  }

  @Get('search')
  @OperationalPermissions('catalog:view')
  @ApiOperation({ summary: 'Search catalog items by name, SKU, or description' })
  @ApiQuery({ name: 'q', required: true })
  search(
    @CurrentOrgId() orgId: string,
    @Query('q') q: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.catalogService.search(orgId, q ?? '', access);
  }

  @Get('categories')
  @OperationalPermissions('catalog:view')
  @ApiOperation({ summary: 'List all catalog categories' })
  getCategories(@CurrentOrgId() orgId: string, @CurrentAccess() access?: AccessPolicy) {
    return this.catalogService.getCategories(orgId, access);
  }

  @Get('price-proposals')
  @OperationalPermissions('catalog:view')
  @ApiOperation({ summary: 'List supplier price proposals' })
  @ApiQuery({ name: 'status', required: false })
  listPriceProposals(
    @CurrentOrgId() orgId: string,
    @Query('status') status?: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.catalogService.listPriceProposals(orgId, status, access);
  }

  @Get(':id')
  @OperationalPermissions('catalog:view')
  @ApiOperation({ summary: 'Get a catalog item' })
  findOne(
    @Param('id') id: string,
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.catalogService.findOne(id, orgId, access);
  }

  @Post()
  @OperationalPermissions('catalog:manage')
  @ApiOperation({ summary: 'Create a catalog item' })
  create(
    @Body() body: CreateCatalogItemInput,
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.catalogService.create(orgId, body, access);
  }

  @Patch(':id')
  @OperationalPermissions('catalog:manage')
  @ApiOperation({ summary: 'Update a catalog item' })
  update(
    @Param('id') id: string,
    @Body() body: UpdateCatalogItemInput,
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.catalogService.update(id, orgId, body, access);
  }

  @Patch(':id/price-proposals/:proposalId/review')
  @OperationalPermissions('catalog:manage')
  @ApiOperation({ summary: 'Approve or reject a supplier price proposal' })
  reviewPriceProposal(
    @Param('id') _id: string,
    @Param('proposalId') proposalId: string,
    @Body() body: { status: 'approved' | 'rejected'; reviewNote?: string },
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.catalogService.reviewPriceProposal(proposalId, orgId, userId, body, access);
  }

  @Delete(':id')
  @OperationalPermissions('catalog:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a catalog item' })
  remove(
    @Param('id') id: string,
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.catalogService.remove(id, orgId, access);
  }
}
