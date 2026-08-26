import { Controller, Get, Post, Patch, Param, Body, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { InventoryService } from './inventory.service';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { OperationalPermissions } from '../../common/decorators/operational-permissions.decorator';
import { CurrentAccess } from '../auth/current-access.decorator';
import type { AccessPolicy } from '../auth/access-policy';

@ApiTags('inventory')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  @OperationalPermissions('inventory:view')
  @ApiOperation({ summary: 'List inventory items' })
  @ApiQuery({ name: 'lowStockOnly', required: false })
  async findAll(
    @CurrentOrgId() orgId: string,
    @Query('lowStockOnly') lowStockOnly?: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    const items = await this.inventoryService.list(orgId, {}, access);
    if (lowStockOnly === 'true') {
      return items.filter((i) => i.stockStatus === 'low_stock' || i.stockStatus === 'out_of_stock');
    }
    return items;
  }

  @Get('low-stock')
  @OperationalPermissions('inventory:view')
  @ApiOperation({ summary: 'Get low-stock items' })
  getLowStock(@CurrentOrgId() orgId: string, @CurrentAccess() access?: AccessPolicy) {
    return this.inventoryService.getLowStockItems(orgId, access);
  }

  @Post()
  @OperationalPermissions('inventory:manage')
  @ApiOperation({ summary: 'Create an inventory item' })
  create(
    @Body() body: unknown,
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    const data = body as any;
    return this.inventoryService.create(
      orgId,
      {
        sku: data.sku,
        name: data.name,
        description: data.description,
        unit: data.unit,
        reorderPoint: data.reorderPoint != null ? Number(data.reorderPoint) : undefined,
        reorderQuantity: data.reorderQuantity != null ? Number(data.reorderQuantity) : undefined,
        location: data.location,
        metadata: data.metadata,
      },
      access,
    );
  }

  @Get(':id')
  @OperationalPermissions('inventory:view')
  @ApiOperation({ summary: 'Get an inventory item with recent movements' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.inventoryService.get(orgId, id, access);
  }

  @Patch(':id')
  @OperationalPermissions('inventory:manage')
  @ApiOperation({ summary: 'Update an inventory item' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    const data = body as any;
    return this.inventoryService.update(
      orgId,
      id,
      {
        name: data.name,
        description: data.description,
        unit: data.unit,
        reorderPoint:
          data.reorderPoint !== undefined
            ? data.reorderPoint != null
              ? Number(data.reorderPoint)
              : null
            : undefined,
        reorderQuantity:
          data.reorderQuantity !== undefined
            ? data.reorderQuantity != null
              ? Number(data.reorderQuantity)
              : null
            : undefined,
        location: data.location,
        metadata: data.metadata,
      },
      access,
    );
  }

  @Post(':id/adjust')
  @OperationalPermissions('inventory:manage')
  @ApiOperation({ summary: 'Manually adjust inventory quantity' })
  adjust(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { quantity: number; notes?: string },
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.inventoryService.adjust(
      orgId,
      id,
      {
        quantity: Number(body.quantity),
        notes: body.notes,
      },
      access,
    );
  }

  @Get(':id/movements')
  @OperationalPermissions('inventory:view')
  @ApiOperation({ summary: 'Get movement history for an inventory item' })
  movements(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrgId() orgId: string,
    @CurrentAccess() access?: AccessPolicy,
  ) {
    return this.inventoryService.movements(orgId, id, access);
  }
}
