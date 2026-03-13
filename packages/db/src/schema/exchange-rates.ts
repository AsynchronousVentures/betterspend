import { pgTable, uuid, varchar, numeric, timestamp, boolean, unique } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';

export const exchangeRates = pgTable('exchange_rates', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  fromCurrency: varchar('from_currency', { length: 3 }).notNull(),
  toCurrency: varchar('to_currency', { length: 3 }).notNull(),
  rate: numeric('rate', { precision: 18, scale: 8 }).notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  isManual: boolean('is_manual').notNull().default(false),
}, (t) => ({
  uniqOrgFromTo: unique('exchange_rates_org_from_to_uniq').on(t.orgId, t.fromCurrency, t.toCurrency),
}));
