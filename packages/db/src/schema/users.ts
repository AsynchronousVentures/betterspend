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
  check,
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

export const customRoles = pgTable(
  'custom_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: varchar('name', { length: 120 }).notNull(),
    description: text('description'),
    permissions: jsonb('permissions').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    idOrganization: uniqueIndex('custom_roles_id_organization_id_unique').on(
      table.id,
      table.organizationId,
    ),
  }),
);

export const userRoles = pgTable(
  'user_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    organizationId: uuid('organization_id').notNull(),
    role: varchar('role', { length: 50 }).notNull(),
    customRoleId: uuid('custom_role_id'),
    scopeType: varchar('scope_type', { length: 50 }).notNull().default('global'),
    scopeId: uuid('scope_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userOrganization: foreignKey({
      columns: [table.userId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
      name: 'user_roles_user_org_fk',
    }),
    customRoleOrganization: foreignKey({
      columns: [table.customRoleId, table.organizationId],
      foreignColumns: [customRoles.id, customRoles.organizationId],
      name: 'user_roles_custom_role_org_fk',
    }),
    roleSourceCheck: check(
      'user_roles_role_source_check',
      sql`((${table.role} in ('admin', 'approver', 'requester', 'receiver', 'finance') and ${table.customRoleId} is null) or (${table.role} = 'custom' and ${table.customRoleId} is not null))`,
    ),
    scopeShapeCheck: check(
      'user_roles_scope_shape_check',
      sql`((${table.scopeType} = 'global' and ${table.scopeId} is null) or (${table.scopeType} in ('department', 'project', 'entity') and ${table.scopeId} is not null))`,
    ),
    assignmentNaturalKey: uniqueIndex('user_roles_assignment_natural_key').on(
      table.userId,
      table.role,
      table.scopeType,
      sql`coalesce(${table.customRoleId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`coalesce(${table.scopeId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
  }),
);
