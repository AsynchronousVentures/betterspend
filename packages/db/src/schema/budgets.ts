import { pgTable, uuid, varchar, numeric, integer, timestamp } from 'drizzle-orm/pg-core';
import { organizations, legalEntities } from './organizations';

export const budgets = pgTable('budgets', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  entityId: uuid('entity_id').references(() => legalEntities.id),
  name: varchar('name', { length: 255 }).notNull(),
  budgetType: varchar('budget_type', { length: 30 }).notNull(), // department|project|gl_account
  scopeId: uuid('scope_id').notNull(),
  fiscalYear: integer('fiscal_year').notNull(),
  periodType: varchar('period_type', { length: 20 }).notNull().default('annual'),
  totalAmount: numeric('total_amount', { precision: 14, scale: 2 }).notNull(),
  allocatedAmount: numeric('allocated_amount', { precision: 14, scale: 2 }).notNull().default('0'),
  spentAmount: numeric('spent_amount', { precision: 14, scale: 2 }).notNull().default('0'),
  currency: varchar('currency', { length: 3 }).notNull().default('USD'),
  baseCurrency: varchar('base_currency', { length: 3 }).notNull().default('USD'),
  exchangeRate: numeric('exchange_rate', { precision: 18, scale: 8 }).notNull().default('1'),
  baseTotalAmount: numeric('base_total_amount', { precision: 14, scale: 2 }).notNull().default('0'),
  baseAllocatedAmount: numeric('base_allocated_amount', { precision: 14, scale: 2 }).notNull().default('0'),
  baseSpentAmount: numeric('base_spent_amount', { precision: 14, scale: 2 }).notNull().default('0'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const budgetPeriods = pgTable('budget_periods', {
  id: uuid('id').primaryKey().defaultRandom(),
  budgetId: uuid('budget_id').notNull().references(() => budgets.id),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  allocatedAmount: numeric('allocated_amount', { precision: 14, scale: 2 }).notNull().default('0'),
  spentAmount: numeric('spent_amount', { precision: 14, scale: 2 }).notNull().default('0'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
