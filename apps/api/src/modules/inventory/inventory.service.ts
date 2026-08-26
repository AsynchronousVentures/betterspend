import { Injectable, Inject, NotFoundException, ForbiddenException } from '@nestjs/common';
import { eq, and, lte, desc } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db } from '@betterspend/db';
import { inventoryItems, inventoryMovements } from '@betterspend/db';
import type { AccessPolicy } from '../auth/access-policy';
import { hasUnrestrictedOperationalAccess } from '../auth/operational-access';

export interface CreateInventoryItemInput {
  sku: string;
  name: string;
  description?: string;
  unit?: string;
  reorderPoint?: number;
  reorderQuantity?: number;
  location?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateInventoryItemInput {
  name?: string;
  description?: string;
  unit?: string;
  reorderPoint?: number | null;
  reorderQuantity?: number | null;
  location?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AdjustInventoryInput {
  quantity: number;
  notes?: string;
}

@Injectable()
export class InventoryService {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  async list(orgId: string, params: { lowStockOnly?: boolean } = {}, access?: AccessPolicy) {
    this.assertGlobal(access, 'inventory:view');
    const items = await this.db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.organizationId, orgId))
      .orderBy(inventoryItems.name);

    return items.map((item) => this.enrichItem(item));
  }

  async get(orgId: string, id: string, access?: AccessPolicy) {
    this.assertGlobal(access, 'inventory:view');
    const item = await this.db.query.inventoryItems.findFirst({
      where: (t, { and, eq }) => and(eq(t.id, id), eq(t.organizationId, orgId)),
    });
    if (!item) throw new NotFoundException(`Inventory item ${id} not found`);

    const movements = await this.db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.inventoryItemId, id))
      .orderBy(desc(inventoryMovements.createdAt))
      .limit(50);

    return { ...this.enrichItem(item), movements };
  }

  async create(orgId: string, data: CreateInventoryItemInput, access?: AccessPolicy) {
    this.assertGlobal(access, 'inventory:manage');
    const [item] = await this.db
      .insert(inventoryItems)
      .values({
        organizationId: orgId,
        sku: data.sku,
        name: data.name,
        description: data.description ?? null,
        unit: data.unit ?? 'each',
        reorderPoint: data.reorderPoint != null ? String(data.reorderPoint) : null,
        reorderQuantity: data.reorderQuantity != null ? String(data.reorderQuantity) : null,
        location: data.location ?? null,
        metadata: data.metadata ?? null,
      })
      .returning();

    return this.enrichItem(item);
  }

  async update(orgId: string, id: string, data: UpdateInventoryItemInput, access?: AccessPolicy) {
    this.assertGlobal(access, 'inventory:manage');
    const existing = await this.db.query.inventoryItems.findFirst({
      where: (t, { and, eq }) => and(eq(t.id, id), eq(t.organizationId, orgId)),
    });
    if (!existing) throw new NotFoundException(`Inventory item ${id} not found`);

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.unit !== undefined) updateData.unit = data.unit;
    if (data.reorderPoint !== undefined)
      updateData.reorderPoint = data.reorderPoint != null ? String(data.reorderPoint) : null;
    if (data.reorderQuantity !== undefined)
      updateData.reorderQuantity =
        data.reorderQuantity != null ? String(data.reorderQuantity) : null;
    if (data.location !== undefined) updateData.location = data.location;
    if (data.metadata !== undefined) updateData.metadata = data.metadata;

    const [updated] = await this.db
      .update(inventoryItems)
      .set(updateData)
      .where(and(eq(inventoryItems.id, id), eq(inventoryItems.organizationId, orgId)))
      .returning();

    return this.enrichItem(updated);
  }

  async adjust(orgId: string, id: string, input: AdjustInventoryInput, access?: AccessPolicy) {
    this.assertGlobal(access, 'inventory:manage');
    const item = await this.db.query.inventoryItems.findFirst({
      where: (t, { and, eq }) => and(eq(t.id, id), eq(t.organizationId, orgId)),
    });
    if (!item) throw new NotFoundException(`Inventory item ${id} not found`);

    const quantityBefore = parseFloat(item.quantityOnHand as string);
    const quantityAfter = quantityBefore + input.quantity;

    const [updated] = await this.db
      .update(inventoryItems)
      .set({ quantityOnHand: String(quantityAfter), updatedAt: new Date() })
      .where(and(eq(inventoryItems.id, id), eq(inventoryItems.organizationId, orgId)))
      .returning();

    await this.db.insert(inventoryMovements).values({
      organizationId: orgId,
      inventoryItemId: id,
      movementType: 'adjustment',
      quantity: String(input.quantity),
      quantityBefore: String(quantityBefore),
      quantityAfter: String(quantityAfter),
      notes: input.notes ?? null,
    });

    return this.enrichItem(updated);
  }

  async movements(orgId: string, itemId: string, access?: AccessPolicy) {
    this.assertGlobal(access, 'inventory:view');
    const item = await this.db.query.inventoryItems.findFirst({
      where: (t, { and, eq }) => and(eq(t.id, itemId), eq(t.organizationId, orgId)),
    });
    if (!item) throw new NotFoundException(`Inventory item ${itemId} not found`);

    return this.db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.inventoryItemId, itemId))
      .orderBy(desc(inventoryMovements.createdAt));
  }

  async getLowStockItems(orgId: string, access?: AccessPolicy) {
    this.assertGlobal(access, 'inventory:view');
    const items = await this.db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.organizationId, orgId));

    return items
      .filter((item) => {
        if (item.reorderPoint == null) return false;
        return parseFloat(item.quantityOnHand as string) <= parseFloat(item.reorderPoint as string);
      })
      .map((item) => this.enrichItem(item));
  }

  /**
   * Called by ReceivingService after a GRN is confirmed.
   * Updates inventory for all matching items (matched by SKU or name).
   */
  async recordReceipt(
    orgId: string,
    lines: Array<{
      sku?: string;
      description?: string;
      quantityReceived: number;
      referenceId: string;
    }>,
  ) {
    for (const line of lines) {
      if (!line.sku && !line.description) continue;

      // Find matching inventory item by SKU (exact) or name (case-insensitive)
      let item: typeof inventoryItems.$inferSelect | undefined;
      if (line.sku) {
        item = await this.db.query.inventoryItems.findFirst({
          where: (t, { and, eq }) => and(eq(t.organizationId, orgId), eq(t.sku, line.sku!)),
        });
      }
      if (!item && line.description) {
        const rows = await this.db
          .select()
          .from(inventoryItems)
          .where(
            sql`${inventoryItems.organizationId} = ${orgId} AND lower(${inventoryItems.name}) = lower(${line.description})`,
          )
          .limit(1);
        item = rows[0];
      }

      if (!item) continue;

      const quantityBefore = parseFloat(item.quantityOnHand as string);
      const quantityAfter = quantityBefore + line.quantityReceived;

      await this.db
        .update(inventoryItems)
        .set({ quantityOnHand: String(quantityAfter), updatedAt: new Date() })
        .where(eq(inventoryItems.id, item.id));

      await this.db.insert(inventoryMovements).values({
        organizationId: orgId,
        inventoryItemId: item.id,
        movementType: 'receipt',
        quantity: String(line.quantityReceived),
        quantityBefore: String(quantityBefore),
        quantityAfter: String(quantityAfter),
        referenceType: 'goods_receipt',
        referenceId: line.referenceId,
        notes: null,
      });
    }
  }

  private enrichItem(item: typeof inventoryItems.$inferSelect) {
    const onHand = parseFloat((item.quantityOnHand as string) ?? '0');
    const reserved = parseFloat((item.quantityReserved as string) ?? '0');
    const reorderPoint = item.reorderPoint != null ? parseFloat(item.reorderPoint as string) : null;

    let stockStatus: 'out_of_stock' | 'low_stock' | 'ok' = 'ok';
    if (onHand <= 0) {
      stockStatus = 'out_of_stock';
    } else if (reorderPoint != null && onHand <= reorderPoint) {
      stockStatus = 'low_stock';
    }

    return {
      ...item,
      quantityOnHand: onHand,
      quantityReserved: reserved,
      quantityAvailable: onHand - reserved,
      reorderPoint,
      reorderQuantity:
        item.reorderQuantity != null ? parseFloat(item.reorderQuantity as string) : null,
      stockStatus,
    };
  }

  private assertGlobal(access: AccessPolicy | undefined, permission: string) {
    if (!hasUnrestrictedOperationalAccess(access, 'inventory', permission)) {
      throw new ForbiddenException('Inventory access requires a global grant');
    }
  }
}
