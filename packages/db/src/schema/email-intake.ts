import { pgTable, uuid, varchar, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';

export const emailIntakeItems = pgTable('email_intake_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  sourceEmail: varchar('source_email', { length: 255 }).notNull(),
  subject: varchar('subject', { length: 500 }).notNull(),
  body: text('body').notNull(),
  detectedType: varchar('detected_type', { length: 30 }).notNull().default('triage'), // invoice|requisition|triage
  status: varchar('status', { length: 30 }).notNull().default('pending_review'), // pending_review|discarded|converted
  extractedVendorName: varchar('extracted_vendor_name', { length: 255 }),
  extractedTotal: varchar('extracted_total', { length: 30 }),
  extractedCurrency: varchar('extracted_currency', { length: 3 }),
  rawPayload: jsonb('raw_payload').notNull().default({}),
  createdDraftType: varchar('created_draft_type', { length: 30 }),
  createdDraftId: uuid('created_draft_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
