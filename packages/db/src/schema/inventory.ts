import { pgTable, uuid, varchar, text, numeric, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';

export const inventoryItems = pgTable('inventory_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  sku: varchar('sku', { length: 100 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  unit: varchar('unit', { length: 50 }).notNull().default('each'),
  quantityOnHand: numeric('quantity_on_hand', { precision: 12, scale: 4 }).notNull().default('0'),
  quantityReserved: numeric('quantity_reserved', { precision: 12, scale: 4 }).notNull().default('0'),
  reorderPoint: numeric('reorder_point', { precision: 12, scale: 4 }),
  reorderQuantity: numeric('reorder_quantity', { precision: 12, scale: 4 }),
  location: varchar('location', { length: 255 }),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const inventoryMovements = pgTable('inventory_movements', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  inventoryItemId: uuid('inventory_item_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  movementType: varchar('movement_type', { length: 50 }).notNull(), // receipt, issue, adjustment, return
  quantity: numeric('quantity', { precision: 12, scale: 4 }).notNull(), // positive = in, negative = out
  quantityBefore: numeric('quantity_before', { precision: 12, scale: 4 }).notNull(),
  quantityAfter: numeric('quantity_after', { precision: 12, scale: 4 }).notNull(),
  referenceType: varchar('reference_type', { length: 50 }), // goods_receipt, purchase_order
  referenceId: uuid('reference_id'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
