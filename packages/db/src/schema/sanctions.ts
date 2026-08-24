import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  timestamp,
  index,
  integer,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { users } from './users';
import { vendors } from './vendors';

export const sanctionsRegistryState = pgTable('sanctions_registry_state', {
  source: varchar('source', { length: 50 }).primaryKey(),
  version: integer('version').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Local copy of public sanctions/denied-party entries (OFAC SDN, EU, UN, or an
 * OpenSanctions export). Refreshed by the risk-screening ingest job and used
 * for fuzzy matching against vendor names during screening.
 */
export const sanctionsEntries = pgTable(
  'sanctions_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: varchar('source', { length: 50 }).notNull(), // ofac_sdn | eu_consolidated | un_security_council | opensanctions
    externalId: varchar('external_id', { length: 120 }),
    entityName: varchar('entity_name', { length: 500 }).notNull(),
    aliases: jsonb('aliases').notNull().default([]),
    country: varchar('country', { length: 100 }),
    listDate: varchar('list_date', { length: 40 }),
    entryType: varchar('entry_type', { length: 40 }), // individual | entity | vessel | aircraft
    raw: jsonb('raw'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('sanctions_entries_source_idx').on(table.source, table.entityName)],
);

/**
 * Screening outcomes per vendor. One row per screening run; the vendor's
 * current status is denormalized onto vendors.sanctions_status.
 */
export const sanctionsScreenings = pgTable(
  'sanctions_screenings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id),
    result: varchar('result', { length: 20 }).notNull(), // clear | flagged | manually_reviewed
    matchCount: jsonb('match_count'),
    screenedBy: uuid('screened_by').references(() => users.id), // null = automated
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('sanctions_screenings_vendor_idx').on(table.vendorId, table.createdAt)],
);
