import { index, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { vendors } from './vendors';

export const vendorPortalSessions = pgTable(
  'vendor_portal_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('vendor_portal_sessions_vendor_idx').on(table.vendorId)],
);
