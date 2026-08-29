import { pgTable, uuid, varchar, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './users';

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 50 }).notNull(), // approval_request, po_issued, invoice_exception, invoice_approved, etc.
    title: varchar('title', { length: 255 }).notNull(),
    body: text('body'),
    entityType: varchar('entity_type', { length: 50 }), // requisition, purchase_order, invoice
    entityId: uuid('entity_id'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    idempotencyKey: varchar('idempotency_key', { length: 255 }),
  },
  (table) => ({
    idempotencyKeyUnique: uniqueIndex('notifications_idempotency_key_unique').on(
      table.idempotencyKey,
    ),
  }),
);
