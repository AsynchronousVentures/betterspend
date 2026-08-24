import {
  pgTable,
  uuid,
  varchar,
  text,
  numeric,
  timestamp,
  integer,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { organizations, departments, projects } from './organizations';
import { users } from './users';
import { vendors, catalogItems } from './vendors';

export const requisitions = pgTable(
  'requisitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    requesterId: uuid('requester_id')
      .notNull()
      .references(() => users.id),
    departmentId: uuid('department_id').references(() => departments.id),
    projectId: uuid('project_id').references(() => projects.id),
    number: varchar('number', { length: 50 }).notNull().unique(),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    status: varchar('status', { length: 30 }).notNull().default('draft'),
    priority: varchar('priority', { length: 20 }).notNull().default('normal'),
    neededBy: timestamp('needed_by', { withTimezone: true }),
    totalAmount: numeric('total_amount', { precision: 14, scale: 2 }).notNull().default('0'),
    currency: varchar('currency', { length: 3 }).notNull().default('USD'),
    sourceType: varchar('source_type', { length: 30 }).notNull().default('manual'),
    sourceDocumentId: uuid('source_document_id'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    idOrganization: uniqueIndex('requisitions_id_organization_id_unique').on(
      table.id,
      table.organizationId,
    ),
  }),
);

export const requisitionLines = pgTable('requisition_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  requisitionId: uuid('requisition_id')
    .notNull()
    .references(() => requisitions.id),
  lineNumber: integer('line_number').notNull(),
  catalogItemId: uuid('catalog_item_id').references(() => catalogItems.id),
  description: varchar('description', { length: 500 }).notNull(),
  quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull(),
  unitOfMeasure: varchar('unit_of_measure', { length: 50 }).notNull().default('each'),
  unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
  totalPrice: numeric('total_price', { precision: 14, scale: 2 }).notNull(),
  vendorId: uuid('vendor_id').references(() => vendors.id),
  glAccount: varchar('gl_account', { length: 50 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
