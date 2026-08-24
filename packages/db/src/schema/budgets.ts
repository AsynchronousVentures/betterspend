import {
  check,
  foreignKey,
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
import { sql } from 'drizzle-orm';
import { BUDGET_COMMITMENT_EVENT_TYPE, type BudgetCommitmentEventType } from '@betterspend/shared';
import { organizations, legalEntities } from './organizations';
import { requisitions } from './requisitions';
import { purchaseOrders } from './purchase-orders';
import { invoices } from './invoices';

export const budgets = pgTable(
  'budgets',
  {
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
    allocatedAmount: numeric('allocated_amount', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    spentAmount: numeric('spent_amount', { precision: 14, scale: 2 }).notNull().default('0'),
    currency: varchar('currency', { length: 3 }).notNull().default('USD'),
    baseCurrency: varchar('base_currency', { length: 3 }).notNull().default('USD'),
    exchangeRate: numeric('exchange_rate', { precision: 18, scale: 8 }).notNull().default('1'),
    baseTotalAmount: numeric('base_total_amount', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    baseAllocatedAmount: numeric('base_allocated_amount', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    baseSpentAmount: numeric('base_spent_amount', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    enforcementMode: varchar('enforcement_mode', { length: 30 }),
    pendingRequisitionPolicy: varchar('pending_requisition_policy', { length: 30 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    idOrganization: uniqueIndex('budgets_id_organization_id_unique').on(
      table.id,
      table.organizationId,
    ),
  }),
);

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
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    budgetId: uuid('budget_id').notNull(),
    requisitionId: uuid('requisition_id'),
    purchaseOrderId: uuid('purchase_order_id'),
    invoiceId: uuid('invoice_id'),
    eventKey: varchar('event_key', { length: 255 }).notNull(),
    eventType: varchar('event_type', { length: 50 }).$type<BudgetCommitmentEventType>().notNull(),
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
    budgetOrganization: foreignKey({
      columns: [table.budgetId, table.organizationId],
      foreignColumns: [budgets.id, budgets.organizationId],
      name: 'budget_commitment_events_budget_org_fk',
    }),
    requisitionOrganization: foreignKey({
      columns: [table.requisitionId, table.organizationId],
      foreignColumns: [requisitions.id, requisitions.organizationId],
      name: 'budget_commitment_events_requisition_org_fk',
    }),
    purchaseOrderOrganization: foreignKey({
      columns: [table.purchaseOrderId, table.organizationId],
      foreignColumns: [purchaseOrders.id, purchaseOrders.organizationId],
      name: 'budget_commitment_events_purchase_order_org_fk',
    }),
    invoiceOrganization: foreignKey({
      columns: [table.invoiceId, table.organizationId],
      foreignColumns: [invoices.id, invoices.organizationId],
      name: 'budget_commitment_events_invoice_org_fk',
    }),
    eventTypeCheck: check(
      'budget_commitment_events_event_type_check',
      sql`${table.eventType} in (${sql.raw(
        Object.values(BUDGET_COMMITMENT_EVENT_TYPE)
          .map((eventType) => `'${eventType}'`)
          .join(', '),
      )})`,
    ),
  }),
);
