import { pgTable, uuid, varchar, integer, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const sequences = pgTable(
  'sequences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    entityType: varchar('entity_type', { length: 50 }).notNull(), // requisition|purchase_order|grn|invoice|rfq
    year: integer('year').notNull(),
    lastValue: integer('last_value').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sequences_org_entity_year_unique').on(
      table.organizationId,
      table.entityType,
      table.year,
    ),
  ],
);
