import { pgTable, uuid, date, numeric, text, timestamp } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { users } from './users';
import { invoices } from './invoices';

export const paymentRuns = pgTable('payment_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  runDate: date('run_date').notNull(),
  totalAmount: numeric('total_amount', { precision: 15, scale: 4 }),
  notes: text('notes'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const paymentRunInvoices = pgTable('payment_run_invoices', {
  paymentRunId: uuid('payment_run_id').notNull().references(() => paymentRuns.id),
  invoiceId: uuid('invoice_id').notNull().references(() => invoices.id),
});
