import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { vendors } from './vendors';
import { contracts } from './contracts';
import { users } from './users';

export const softwareLicenses = pgTable('software_licenses', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id),
  vendorId: uuid('vendor_id')
    .notNull()
    .references(() => vendors.id),
  contractId: uuid('contract_id').references(() => contracts.id),
  productName: varchar('product_name', { length: 255 }).notNull(),
  status: varchar('status', { length: 30 }).notNull().default('active'),
  seatCount: integer('seat_count').notNull().default(1),
  seatsUsed: integer('seats_used').notNull().default(0),
  pricePerSeat: numeric('price_per_seat', { precision: 14, scale: 2 }).notNull().default('0'),
  currency: varchar('currency', { length: 3 }).notNull().default('USD'),
  billingCycle: varchar('billing_cycle', { length: 20 }).notNull().default('annual'),
  renewalDate: timestamp('renewal_date', { withTimezone: true }),
  autoRenews: boolean('auto_renews').notNull().default(true),
  renewalLeadDays: integer('renewal_lead_days').notNull().default(30),
  ownerUserId: uuid('owner_user_id').references(() => users.id),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
