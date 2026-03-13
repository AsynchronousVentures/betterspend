import { pgTable, uuid, varchar, jsonb, text, timestamp } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';

export const spendGuardAlerts = pgTable('spend_guard_alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id),
  alertType: varchar('alert_type', { length: 50 }).notNull(),
  severity: varchar('severity', { length: 20 }).notNull().default('medium'),
  recordType: varchar('record_type', { length: 50 }).notNull(),
  recordId: uuid('record_id').notNull(),
  details: jsonb('details').notNull().default({}),
  status: varchar('status', { length: 20 }).notNull().default('open'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedBy: uuid('resolved_by'),
});
