import { pgTable, uuid, varchar, jsonb, timestamp, boolean, unique } from 'drizzle-orm/pg-core';

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  baseCurrency: varchar('base_currency', { length: 3 }).notNull().default('USD'),
  settings: jsonb('settings').default({}),
  logoUrl: varchar('logo_url', { length: 500 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const legalEntities = pgTable('legal_entities', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  name: varchar('name', { length: 255 }).notNull(),
  code: varchar('code', { length: 50 }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('USD'),
  glAccountPrefix: varchar('gl_account_prefix', { length: 50 }),
  address: jsonb('address').default({}),
  taxId: varchar('tax_id', { length: 100 }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uniqueOrgCode: unique('legal_entities_org_code_unique').on(table.organizationId, table.code),
}));

export const departments = pgTable('departments', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  name: varchar('name', { length: 255 }).notNull(),
  code: varchar('code', { length: 50 }).notNull(),
  parentId: uuid('parent_id'),
  budgetOwnerId: uuid('budget_owner_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  departmentId: uuid('department_id').references(() => departments.id),
  name: varchar('name', { length: 255 }).notNull(),
  code: varchar('code', { length: 50 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  startDate: timestamp('start_date', { withTimezone: true }),
  endDate: timestamp('end_date', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
