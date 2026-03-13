import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  numeric,
  boolean,
} from 'drizzle-orm/pg-core';
import { catalogItems, vendors } from './vendors';
import { organizations } from './organizations';
import { users } from './users';

export const catalogPriceProposals = pgTable('catalog_price_proposals', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id),
  itemId: uuid('item_id')
    .notNull()
    .references(() => catalogItems.id),
  vendorId: uuid('vendor_id')
    .notNull()
    .references(() => vendors.id),
  proposedPrice: numeric('proposed_price', { precision: 14, scale: 2 }).notNull(),
  currentPrice: numeric('current_price', { precision: 14, scale: 2 }).notNull(),
  effectiveDate: timestamp('effective_date', { withTimezone: true }),
  note: text('note'),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewNote: text('review_note'),
  notifiedVendor: boolean('notified_vendor').notNull().default(false),
});
