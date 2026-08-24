import { pgTable, uuid, varchar, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';

export const ocrJobs = pgTable('ocr_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  uploadedBy: uuid('uploaded_by').notNull(),
  filename: varchar('filename', { length: 255 }).notNull(),
  contentType: varchar('content_type', { length: 100 }).notNull(),
  storageKey: varchar('storage_key', { length: 500 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('pending'), // pending|processing|done|failed
  // Structured extraction result: vendor, invoice number, date, lines, totals
  extractedData: jsonb('extracted_data'),
  // Per-field confidence scores (0–1)
  confidence: jsonb('confidence'),
  errorMessage: text('error_message'),
  // Once accepted, linked to the created invoice
  invoiceId: uuid('invoice_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
