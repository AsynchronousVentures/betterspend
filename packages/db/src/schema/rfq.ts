import {
  pgTable,
  uuid,
  varchar,
  text,
  numeric,
  timestamp,
  integer,
  boolean,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { users } from './users';
import { vendors } from './vendors';

export const rfqRequests = pgTable(
  'rfq_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    requesterId: uuid('requester_id')
      .notNull()
      .references(() => users.id),
    number: varchar('number', { length: 50 }).notNull().unique(),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    status: varchar('status', { length: 30 }).notNull().default('draft'), // draft | open | closed | awarded | cancelled
    dueDate: timestamp('due_date', { withTimezone: true }),
    awardedVendorId: uuid('awarded_vendor_id').references(() => vendors.id),
    currency: varchar('currency', { length: 3 }).notNull().default('USD'),
    notes: text('notes'),
    idempotencyKey: varchar('idempotency_key', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    organizationIdempotencyKey: uniqueIndex('rfq_requests_org_idempotency_key_unique').on(
      table.organizationId,
      table.idempotencyKey,
    ),
  }),
);

export const rfqLines = pgTable('rfq_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  rfqId: uuid('rfq_id')
    .notNull()
    .references(() => rfqRequests.id, { onDelete: 'cascade' }),
  lineNumber: integer('line_number').notNull(),
  description: varchar('description', { length: 500 }).notNull(),
  quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull(),
  unitOfMeasure: varchar('unit_of_measure', { length: 50 }).notNull().default('each'),
  targetPrice: numeric('target_price', { precision: 12, scale: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const rfqInvitations = pgTable('rfq_invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  rfqId: uuid('rfq_id')
    .notNull()
    .references(() => rfqRequests.id, { onDelete: 'cascade' }),
  vendorId: uuid('vendor_id')
    .notNull()
    .references(() => vendors.id),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  respondedAt: timestamp('responded_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const rfqResponses = pgTable('rfq_responses', {
  id: uuid('id').primaryKey().defaultRandom(),
  rfqId: uuid('rfq_id')
    .notNull()
    .references(() => rfqRequests.id, { onDelete: 'cascade' }),
  vendorId: uuid('vendor_id')
    .notNull()
    .references(() => vendors.id),
  status: varchar('status', { length: 30 }).notNull().default('submitted'), // submitted | accepted | rejected
  totalAmount: numeric('total_amount', { precision: 14, scale: 2 }).notNull().default('0'),
  validUntil: timestamp('valid_until', { withTimezone: true }),
  notes: text('notes'),
  awarded: boolean('awarded').notNull().default(false),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const rfqResponseLines = pgTable('rfq_response_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  responseId: uuid('response_id')
    .notNull()
    .references(() => rfqResponses.id, { onDelete: 'cascade' }),
  rfqLineId: uuid('rfq_line_id')
    .notNull()
    .references(() => rfqLines.id, { onDelete: 'cascade' }),
  unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
  totalPrice: numeric('total_price', { precision: 14, scale: 2 }).notNull(),
  leadTimeDays: integer('lead_time_days'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
