import { foreignKey, index, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { vendors } from './vendors';

export const vendorPortalSessions = pgTable(
  'vendor_portal_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    vendorId: uuid('vendor_id').notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('vendor_portal_sessions_org_vendor_idx').on(table.organizationId, table.vendorId),
    foreignKey({
      columns: [table.vendorId, table.organizationId],
      foreignColumns: [vendors.id, vendors.organizationId],
      name: 'vendor_portal_sessions_vendor_org_fk',
    }).onDelete('cascade'),
  ],
);
