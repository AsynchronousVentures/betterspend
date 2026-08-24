import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { organizations, legalEntities } from './organizations';
import { users } from './users';

/** OAuth connection metadata. Credential columns always contain versioned ciphertext. */
export const integrationConnections = pgTable(
  'integration_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    entityId: uuid('entity_id').references(() => legalEntities.id),
    provider: varchar('provider', { length: 20 }).notNull(),
    realmId: varchar('realm_id', { length: 255 }).notNull(),
    realmName: varchar('realm_name', { length: 255 }),
    accessTokenEncrypted: text('access_token_enc'),
    refreshTokenEncrypted: text('refresh_token_enc'),
    accessExpiresAt: timestamp('access_expires_at', { withTimezone: true }),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    scopes: text('scopes'),
    connectedByUserId: uuid('connected_by_user_id').references(() => users.id),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueRealm: uniqueIndex('integration_connections_org_provider_realm_unique').on(
      table.organizationId,
      table.provider,
      table.realmId,
    ),
    lookup: index('integration_connections_org_provider_status_idx').on(
      table.organizationId,
      table.provider,
      table.status,
    ),
  }),
);

/** Provider-neutral journal for inbound and outbound integration attempts. */
export const syncRecords = pgTable(
  'sync_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    connectionId: uuid('connection_id').references(() => integrationConnections.id),
    provider: varchar('provider', { length: 20 }).notNull(),
    direction: varchar('direction', { length: 10 }).notNull(),
    localEntity: varchar('local_entity', { length: 40 }).notNull(),
    localId: uuid('local_id').notNull(),
    externalEntity: varchar('external_entity', { length: 40 }).notNull(),
    externalId: varchar('external_id', { length: 255 }),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    requestId: varchar('request_id', { length: 50 }).notNull(),
    docNumber: varchar('doc_number', { length: 100 }).notNull(),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    errorCode: varchar('error_code', { length: 20 }),
    errorMessage: text('error_message'),
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueLocalRecord: uniqueIndex('sync_records_org_provider_direction_local_unique').on(
      table.organizationId,
      table.provider,
      table.direction,
      table.localEntity,
      table.localId,
    ),
    statusLookup: index('sync_records_org_provider_status_idx').on(
      table.organizationId,
      table.provider,
      table.status,
    ),
  }),
);
