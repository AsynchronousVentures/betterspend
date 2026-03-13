import { pgTable, uuid, varchar, numeric, boolean, timestamp, unique } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';

export const taxCodes = pgTable(
  'tax_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    name: varchar('name', { length: 100 }).notNull(),
    code: varchar('code', { length: 20 }).notNull(),
    ratePercent: numeric('rate_percent', { precision: 5, scale: 2 }).notNull().default('0'),
    taxType: varchar('tax_type', { length: 20 }).notNull(), // VAT | GST | SALES_TAX | EXEMPT
    isRecoverable: boolean('is_recoverable').notNull().default(true),
    glAccountCode: varchar('gl_account_code', { length: 50 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgCodeUniq: unique('tax_codes_org_code_unique').on(t.orgId, t.code),
  }),
);
