import {
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { vendors } from './vendors';

/** Email/password logins that let a supplier contact sign in to the vendor portal. */
export const vendorPortalUsers = pgTable(
  'vendor_portal_users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    vendorId: uuid('vendor_id').notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    name: varchar('name', { length: 255 }),
    passwordHash: text('password_hash').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('active'), // active|disabled
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('vendor_portal_users_org_email_unique').on(table.organizationId, table.email),
    index('vendor_portal_users_vendor_idx').on(table.vendorId),
    foreignKey({
      columns: [table.vendorId, table.organizationId],
      foreignColumns: [vendors.id, vendors.organizationId],
      name: 'vendor_portal_users_vendor_org_fk',
    }).onDelete('cascade'),
  ],
);
