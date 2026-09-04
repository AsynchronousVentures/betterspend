import { index, pgTable, uniqueIndex, uuid, varchar, jsonb, timestamp } from 'drizzle-orm/pg-core';

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    userId: uuid('user_id'),
    entityType: varchar('entity_type', { length: 50 }).notNull(),
    entityId: uuid('entity_id').notNull(),
    action: varchar('action', { length: 50 }).notNull(),
    changes: jsonb('changes').default({}),
    metadata: jsonb('metadata').default({}),
    prevHash: varchar('prev_hash', { length: 64 }),
    entryHash: varchar('entry_hash', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    organizationCreatedAtId: index('audit_log_organization_created_at_id_idx').on(
      table.organizationId,
      table.createdAt,
      table.id,
    ),
    invoiceReviewHistory: index('audit_log_invoice_review_history_idx').on(
      table.organizationId,
      table.entityType,
      table.entityId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
  }),
);

export const auditIdempotencyKeys = pgTable(
  'audit_idempotency_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    action: varchar('action', { length: 50 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),
    auditLogId: uuid('audit_log_id').references(() => auditLog.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    organizationActionIdempotencyKey: uniqueIndex(
      'audit_idempotency_keys_org_action_key_unique',
    ).on(table.organizationId, table.action, table.idempotencyKey),
  }),
);
