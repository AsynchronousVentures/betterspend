import {
  boolean,
  check,
  foreignKey,
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
import { sql } from 'drizzle-orm';
import {
  INTEGRATION_CONNECTION_STATUS,
  SYNC_RECORD_STATUS,
  type IntegrationConnectionStatus,
  type SyncRecordStatus,
} from '@betterspend/shared';
import { organizations } from './organizations';
import { users } from './users';

const connectionStatuses = Object.values(INTEGRATION_CONNECTION_STATUS);
const syncStatuses = Object.values(SYNC_RECORD_STATUS);

/** OAuth connection metadata. Credential columns always contain versioned ciphertext. */
export const integrationConnections = pgTable(
  'integration_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    provider: varchar('provider', { length: 20 }).notNull(),
    realmId: varchar('realm_id', { length: 255 }).notNull(),
    realmName: varchar('realm_name', { length: 255 }),
    accessTokenEncrypted: text('access_token_enc'),
    refreshTokenEncrypted: text('refresh_token_enc'),
    accessExpiresAt: timestamp('access_expires_at', { withTimezone: true }),
    status: varchar('status', { length: 20 })
      .$type<IntegrationConnectionStatus>()
      .notNull()
      .default(INTEGRATION_CONNECTION_STATUS.ACTIVE),
    scopes: text('scopes'),
    connectedByUserId: uuid('connected_by_user_id'),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueProvider: uniqueIndex('integration_connections_org_provider_unique').on(
      table.organizationId,
      table.provider,
    ),
    idOrganization: uniqueIndex('integration_connections_id_organization_id_unique').on(
      table.id,
      table.organizationId,
    ),
    lookup: index('integration_connections_org_provider_status_idx').on(
      table.organizationId,
      table.provider,
      table.status,
    ),
    connectedByOrganization: foreignKey({
      columns: [table.connectedByUserId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
      name: 'integration_connections_connected_by_user_org_fk',
    }),
    statusCheck: check(
      'integration_connections_status_check',
      sql`${table.status} in (${sql.raw(connectionStatuses.map((status) => `'${status}'`).join(', '))})`,
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
    connectionId: uuid('connection_id'),
    provider: varchar('provider', { length: 20 }).notNull(),
    direction: varchar('direction', { length: 10 }).notNull(),
    localEntity: varchar('local_entity', { length: 40 }).notNull(),
    localId: uuid('local_id').notNull(),
    externalEntity: varchar('external_entity', { length: 40 }).notNull(),
    externalId: varchar('external_id', { length: 255 }),
    status: varchar('status', { length: 20 })
      .$type<SyncRecordStatus>()
      .notNull()
      .default(SYNC_RECORD_STATUS.PENDING),
    attempts: integer('attempts').notNull().default(0),
    requestId: varchar('request_id', { length: 50 }).notNull(),
    attemptId: uuid('attempt_id'),
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
    connectionOrganization: foreignKey({
      columns: [table.connectionId, table.organizationId],
      foreignColumns: [integrationConnections.id, integrationConnections.organizationId],
      name: 'sync_records_connection_org_fk',
    }),
    statusCheck: check(
      'sync_records_status_check',
      sql`${table.status} in (${sql.raw(syncStatuses.map((status) => `'${status}'`).join(', '))})`,
    ),
  }),
);

/**
 * Cached provider master data and the optional local record it is linked to.
 * A row remains after an external delete so imports and exports can explain
 * historical references instead of silently losing the provider identity.
 */
export const externalEntityMappings = pgTable(
  'external_entity_mappings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    connectionId: uuid('connection_id'),
    provider: varchar('provider', { length: 20 }).notNull(),
    externalEntity: varchar('external_entity', { length: 40 }).notNull(),
    externalId: varchar('external_id', { length: 255 }).notNull(),
    displayName: varchar('display_name', { length: 255 }),
    syncToken: varchar('sync_token', { length: 100 }),
    localEntity: varchar('local_entity', { length: 40 }).notNull(),
    localId: uuid('local_id'),
    direction: varchar('direction', { length: 10 }).notNull().default('inbound'),
    autoCreated: boolean('auto_created').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    isDeleted: boolean('is_deleted').notNull().default(false),
    mergedIntoExternalId: varchar('merged_into_external_id', { length: 255 }),
    payload: jsonb('payload'),
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    externalIdentity: uniqueIndex('external_entity_mappings_external_identity_unique').on(
      table.organizationId,
      table.provider,
      table.direction,
      table.externalEntity,
      table.externalId,
    ),
    localLookup: index('external_entity_mappings_local_lookup_idx').on(
      table.organizationId,
      table.provider,
      table.localEntity,
      table.localId,
    ),
    catalogLookup: index('external_entity_mappings_catalog_lookup_idx').on(
      table.organizationId,
      table.provider,
      table.externalEntity,
      table.isDeleted,
      table.displayName,
    ),
    connectionOrganization: foreignKey({
      columns: [table.connectionId, table.organizationId],
      foreignColumns: [integrationConnections.id, integrationConnections.organizationId],
      name: 'external_entity_mappings_connection_org_fk',
    }),
    providerDirectionCheck: check(
      'external_entity_mappings_direction_check',
      sql`${table.direction} in ('inbound', 'outbound')`,
    ),
  }),
);
