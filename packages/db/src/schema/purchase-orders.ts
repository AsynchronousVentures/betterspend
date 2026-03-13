import { pgTable, uuid, varchar, text, numeric, integer, timestamp, jsonb, boolean } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { users } from './users';
import { vendors, catalogItems } from './vendors';
import { requisitions, requisitionLines } from './requisitions';
import { contracts } from './contracts';

export const purchaseOrders = pgTable('purchase_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  requisitionId: uuid('requisition_id').references(() => requisitions.id),
  vendorId: uuid('vendor_id').notNull().references(() => vendors.id),
  number: varchar('number', { length: 50 }).notNull().unique(),
  version: integer('version').notNull().default(1),
  poType: varchar('po_type', { length: 20 }).notNull().default('standard'), // standard|blanket
  status: varchar('status', { length: 30 }).notNull().default('draft'),
  issuedBy: uuid('issued_by').references(() => users.id),
  issuedAt: timestamp('issued_at', { withTimezone: true }),
  paymentTerms: varchar('payment_terms', { length: 100 }),
  shippingAddress: jsonb('shipping_address').default({}),
  billingAddress: jsonb('billing_address').default({}),
  subtotal: numeric('subtotal', { precision: 14, scale: 2 }).notNull().default('0'),
  taxAmount: numeric('tax_amount', { precision: 14, scale: 2 }).notNull().default('0'),
  totalAmount: numeric('total_amount', { precision: 14, scale: 2 }).notNull().default('0'),
  currency: varchar('currency', { length: 3 }).notNull().default('USD'),
  notes: text('notes'),
  pdfDocumentId: uuid('pdf_document_id'),
  // Blanket PO fields
  blanketStartDate: timestamp('blanket_start_date', { withTimezone: true }),
  blanketEndDate: timestamp('blanket_end_date', { withTimezone: true }),
  blanketTotalLimit: numeric('blanket_total_limit', { precision: 14, scale: 2 }),
  blanketReleasedAmount: numeric('blanket_released_amount', { precision: 14, scale: 2 }).default('0'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const poLines = pgTable('po_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  purchaseOrderId: uuid('purchase_order_id').notNull().references(() => purchaseOrders.id),
  requisitionLineId: uuid('requisition_line_id').references(() => requisitionLines.id),
  lineNumber: integer('line_number').notNull(),
  catalogItemId: uuid('catalog_item_id').references(() => catalogItems.id),
  description: varchar('description', { length: 500 }).notNull(),
  quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull(),
  unitOfMeasure: varchar('unit_of_measure', { length: 50 }).notNull().default('each'),
  unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
  totalPrice: numeric('total_price', { precision: 14, scale: 2 }).notNull(),
  quantityReceived: numeric('quantity_received', { precision: 10, scale: 2 }).notNull().default('0'),
  quantityInvoiced: numeric('quantity_invoiced', { precision: 10, scale: 2 }).notNull().default('0'),
  glAccount: varchar('gl_account', { length: 50 }),
  // Contract compliance fields
  contractComplianceStatus: varchar('contract_compliance_status', { length: 20 }),
  contractComplianceDeltaPercent: numeric('contract_compliance_delta_percent', { precision: 8, scale: 4 }),
  matchedContractId: uuid('matched_contract_id').references(() => contracts.id),
  contractedUnitPrice: numeric('contracted_unit_price', { precision: 15, scale: 4 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const poVersions = pgTable('po_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  purchaseOrderId: uuid('purchase_order_id').notNull().references(() => purchaseOrders.id),
  version: integer('version').notNull(),
  changeReason: text('change_reason'),
  changedBy: uuid('changed_by').notNull().references(() => users.id),
  snapshot: jsonb('snapshot').notNull(),
  diffSummary: jsonb('diff_summary').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const blanketReleases = pgTable('blanket_releases', {
  id: uuid('id').primaryKey().defaultRandom(),
  blanketPoId: uuid('blanket_po_id').notNull().references(() => purchaseOrders.id),
  releaseNumber: integer('release_number').notNull(),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  description: text('description'),
  status: varchar('status', { length: 20 }).notNull().default('draft'),
  releasedBy: uuid('released_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
