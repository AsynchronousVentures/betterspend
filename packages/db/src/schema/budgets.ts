import {
  pgTable,
  uuid,
  varchar,
  numeric,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { organizations, legalEntities } from './organizations';
import { requisitions } from './requisitions';
import { purchaseOrders } from './purchase-orders';
import { invoices } from './invoices';

export const budgets = pgTable('budgets', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id),
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
  baseAllocatedAmount: numeric('base_allocated_amount', { precision: 14, scale: 2 })
    .notNull()
    .default('0'),
  baseSpentAmount: numeric('base_spent_amount', { precision: 14, scale: 2 }).notNull().default('0'),
  enforcementMode: varchar('enforcement_mode', { length: 30 }),
  pendingRequisitionPolicy: varchar('pending_requisition_policy', { length: 30 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const budgetPeriods = pgTable('budget_periods', {
  id: uuid('id').primaryKey().defaultRandom(),
  budgetId: uuid('budget_id')
    .notNull()
    .references(() => budgets.id),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  allocatedAmount: numeric('allocated_amount', { precision: 14, scale: 2 }).notNull().default('0'),
  spentAmount: numeric('spent_amount', { precision: 14, scale: 2 }).notNull().default('0'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Append-only staged commitment ledger. Current balances are the sum of each delta column. */
export const budgetCommitmentEvents = pgTable(
  'budget_commitment_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    budgetId: uuid('budget_id').notNull().references(() => budgets.id),
    requisitionId: uuid('requisition_id').references(() => requisitions.id),
    purchaseOrderId: uuid('purchase_order_id').references(() => purchaseOrders.id),
    invoiceId: uuid('invoice_id').references(() => invoices.id),
    eventKey: varchar('event_key', { length: 255 }).notNull(),
    eventType: varchar('event_type', { length: 50 }).notNull(),
    baseReservedDelta: numeric('base_reserved_delta', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    baseCommittedDelta: numeric('base_committed_delta', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    baseExpendedDelta: numeric('base_expended_delta', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    reason: varchar('reason', { length: 255 }).notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    organizationEventKey: uniqueIndex('budget_commitment_events_org_key_uniq').on(
      table.organizationId,
      table.eventKey,
    ),
    budgetCreatedAt: index('budget_commitment_events_budget_created_idx').on(
      table.budgetId,
      table.createdAt,
    ),
    requisition: index('budget_commitment_events_requisition_idx').on(table.requisitionId),
    purchaseOrder: index('budget_commitment_events_purchase_order_idx').on(table.purchaseOrderId),
  }),
);
