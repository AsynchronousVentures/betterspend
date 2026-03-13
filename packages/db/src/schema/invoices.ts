import { pgTable, uuid, varchar, text, numeric, boolean, timestamp, jsonb, date } from 'drizzle-orm/pg-core';
import { organizations, legalEntities } from './organizations';
import { vendors } from './vendors';
import { users } from './users';
import { purchaseOrders, poLines } from './purchase-orders';
import { goodsReceiptLines } from './receiving';
import { taxCodes } from './tax-codes';

export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  entityId: uuid('entity_id').references(() => legalEntities.id),
  purchaseOrderId: uuid('purchase_order_id').references(() => purchaseOrders.id),
  vendorId: uuid('vendor_id').notNull().references(() => vendors.id),
  invoiceNumber: varchar('invoice_number', { length: 100 }).notNull(),
  internalNumber: varchar('internal_number', { length: 50 }).notNull().unique(),
  status: varchar('status', { length: 30 }).notNull().default('draft'),
  invoiceDate: timestamp('invoice_date', { withTimezone: true }).notNull(),
  dueDate: timestamp('due_date', { withTimezone: true }),
  paymentTerms: varchar('payment_terms', { length: 20 }),
  earlyPaymentDiscountPercent: numeric('early_payment_discount_percent', { precision: 5, scale: 2 }),
  earlyPaymentDiscountBy: date('early_payment_discount_by'),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  paymentReference: varchar('payment_reference', { length: 255 }),
  subtotal: numeric('subtotal', { precision: 14, scale: 2 }).notNull().default('0'),
  taxAmount: numeric('tax_amount', { precision: 14, scale: 2 }).notNull().default('0'),
  totalAmount: numeric('total_amount', { precision: 14, scale: 2 }).notNull().default('0'),
  currency: varchar('currency', { length: 3 }).notNull().default('USD'),
  baseCurrency: varchar('base_currency', { length: 3 }).notNull().default('USD'),
  exchangeRate: numeric('exchange_rate', { precision: 18, scale: 8 }).notNull().default('1'),
  baseSubtotal: numeric('base_subtotal', { precision: 14, scale: 2 }).notNull().default('0'),
  baseTaxAmount: numeric('base_tax_amount', { precision: 14, scale: 2 }).notNull().default('0'),
  baseTotalAmount: numeric('base_total_amount', { precision: 14, scale: 2 }).notNull().default('0'),
  documentId: uuid('document_id'),
  matchStatus: varchar('match_status', { length: 20 }).notNull().default('unmatched'),
  matchDetails: jsonb('match_details').default({}),
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const invoiceLines = pgTable('invoice_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  invoiceId: uuid('invoice_id').notNull().references(() => invoices.id),
  poLineId: uuid('po_line_id').references(() => poLines.id),
  lineNumber: numeric('line_number').notNull(),
  taxCodeId: uuid('tax_code_id').references(() => taxCodes.id),
  description: varchar('description', { length: 500 }).notNull(),
  quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull(),
  unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
  taxAmount: numeric('tax_amount', { precision: 14, scale: 2 }).notNull().default('0'),
  taxInclusive: boolean('tax_inclusive').notNull().default(false),
  totalPrice: numeric('total_price', { precision: 14, scale: 2 }).notNull(),
  exchangeRate: numeric('exchange_rate', { precision: 18, scale: 8 }).notNull().default('1'),
  baseUnitPrice: numeric('base_unit_price', { precision: 12, scale: 2 }).notNull().default('0'),
  baseTotalPrice: numeric('base_total_price', { precision: 14, scale: 2 }).notNull().default('0'),
  glAccount: varchar('gl_account', { length: 50 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const matchResults = pgTable('match_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  invoiceLineId: uuid('invoice_line_id').notNull().references(() => invoiceLines.id),
  poLineId: uuid('po_line_id').notNull().references(() => poLines.id),
  grnLineId: uuid('grn_line_id').references(() => goodsReceiptLines.id),
  priceMatch: boolean('price_match').notNull().default(false),
  quantityMatch: boolean('quantity_match').notNull().default(false),
  priceVariance: numeric('price_variance', { precision: 14, scale: 2 }).notNull().default('0'),
  quantityVariance: numeric('quantity_variance', { precision: 10, scale: 2 }).notNull().default('0'),
  variancePct: numeric('variance_pct', { precision: 5, scale: 2 }).notNull().default('0'),
  status: varchar('status', { length: 20 }).notNull().default('exception'), // match|within_tolerance|exception
  toleranceApplied: numeric('tolerance_applied', { precision: 5, scale: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
