import { pgTable, uuid, date, numeric, text, timestamp, varchar, jsonb } from 'drizzle-orm/pg-core';
import { legalEntities, organizations } from './organizations';
import { users } from './users';
import { invoices } from './invoices';
import { vendors } from './vendors';

export const paymentRuns = pgTable('payment_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  entityId: uuid('entity_id').references(() => legalEntities.id),
  status: varchar('status', { length: 30 }).notNull().default('draft'),
  runDate: date('run_date').notNull(),
  scheduledDate: date('scheduled_date'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  paymentProvider: varchar('payment_provider', { length: 50 }),
  providerBatchId: varchar('provider_batch_id', { length: 255 }),
  currency: varchar('currency', { length: 3 }).notNull().default('USD'),
  totalAmount: numeric('total_amount', { precision: 15, scale: 4 }).notNull().default('0'),
  invoiceCount: numeric('invoice_count', { precision: 10, scale: 0 }).notNull().default('0'),
  failureCount: numeric('failure_count', { precision: 10, scale: 0 }).notNull().default('0'),
  notes: text('notes'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const paymentRunInvoices = pgTable('payment_run_invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  paymentRunId: uuid('payment_run_id').notNull().references(() => paymentRuns.id),
  invoiceId: uuid('invoice_id').notNull().references(() => invoices.id),
  paymentMethod: varchar('payment_method', { length: 30 }).notNull().default('manual'),
  amount: numeric('amount', { precision: 15, scale: 4 }).notNull().default('0'),
  currency: varchar('currency', { length: 3 }).notNull().default('USD'),
  status: varchar('status', { length: 30 }).notNull().default('scheduled'),
  paymentReference: varchar('payment_reference', { length: 255 }),
  providerPaymentId: varchar('provider_payment_id', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const paymentRunEvents = pgTable('payment_run_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  paymentRunId: uuid('payment_run_id').notNull().references(() => paymentRuns.id),
  eventType: varchar('event_type', { length: 50 }).notNull(),
  message: text(),
  metadata: jsonb('metadata').notNull().default({}),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const vendorPaymentAccounts = pgTable('vendor_payment_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  vendorId: uuid('vendor_id').notNull().references(() => vendors.id),
  accountName: varchar('account_name', { length: 255 }).notNull(),
  paymentMethod: varchar('payment_method', { length: 30 }).notNull().default('ach'),
  country: varchar('country', { length: 2 }),
  currency: varchar('currency', { length: 3 }).notNull().default('USD'),
  maskedAccount: varchar('masked_account', { length: 100 }).notNull(),
  provider: varchar('provider', { length: 50 }),
  providerAccountId: varchar('provider_account_id', { length: 255 }),
  verificationStatus: varchar('verification_status', { length: 30 }).notNull().default('pending'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const vendorVirtualCards = pgTable('vendor_virtual_cards', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  vendorId: uuid('vendor_id').notNull().references(() => vendors.id),
  paymentRunId: uuid('payment_run_id').references(() => paymentRuns.id),
  invoiceId: uuid('invoice_id').references(() => invoices.id),
  status: varchar('status', { length: 30 }).notNull().default('requested'),
  provider: varchar('provider', { length: 50 }),
  providerCardId: varchar('provider_card_id', { length: 255 }),
  maskedCard: varchar('masked_card', { length: 30 }),
  limitAmount: numeric('limit_amount', { precision: 15, scale: 4 }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('USD'),
  validThrough: date('valid_through'),
  controls: jsonb('controls').notNull().default({}),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
