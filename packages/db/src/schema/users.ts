import {
  pgTable,
  uuid,
  varchar,
  boolean,
  foreignKey,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizations, departments } from './organizations';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    email: varchar('email', { length: 255 }).notNull().unique(),
    name: varchar('name', { length: 255 }).notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    departmentId: uuid('department_id').references(() => departments.id),
    managerId: uuid('manager_id'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    normalizedEmail: uniqueIndex('users_email_normalized_unique').on(sql`lower(${table.email})`),
    idOrganization: uniqueIndex('users_id_organization_id_unique').on(
      table.id,
      table.organizationId,
    ),
    managerOrganization: foreignKey({
      columns: [table.managerId, table.organizationId],
      foreignColumns: [table.id, table.organizationId],
      name: 'users_manager_org_fk',
    }),
  }),
);

export const customRoles = pgTable('custom_roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id),
  name: varchar('name', { length: 120 }).notNull(),
  description: text('description'),
  permissions: jsonb('permissions').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const userRoles = pgTable('user_roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  role: varchar('role', { length: 50 }).notNull(), // requester|approver|receiver|finance|admin|custom
  customRoleId: uuid('custom_role_id').references(() => customRoles.id),
  scopeType: varchar('scope_type', { length: 50 }).notNull().default('global'), // global|department|project|entity
  scopeId: uuid('scope_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
