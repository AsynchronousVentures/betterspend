import { index, pgTable, uuid, varchar, jsonb, timestamp } from 'drizzle-orm/pg-core';

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
    entryHash: varchar('entry_hash', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    organizationCreatedAtId: index('audit_log_organization_created_at_id_idx').on(
      table.organizationId,
      table.createdAt,
      table.id,
    ),
  }),
);
