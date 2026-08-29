import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizations } from './organizations';

/**
 * Durable coordination records for the two cross-module write flows that
 * cannot share a transaction with their artifact owner.
 *
 * The artifact tables also retain the operation key. That second copy lets a
 * retry recover an artifact when the owner transaction committed but this
 * record could not yet be advanced past `pending`.
 */
export const artifactOperations = pgTable(
  'artifact_operations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    operationType: varchar('operation_type', { length: 40 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    artifactKind: varchar('artifact_kind', { length: 30 }),
    artifactId: uuid('artifact_id'),
    artifactNumber: varchar('artifact_number', { length: 100 }),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    leaseToken: uuid('lease_token'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('artifact_operations_id_organization_id_unique').on(
      table.id,
      table.organizationId,
    ),
    uniqueIndex('artifact_operations_org_key_unique').on(
      table.organizationId,
      table.idempotencyKey,
    ),
    index('artifact_operations_org_status_idx').on(
      table.organizationId,
      table.operationType,
      table.status,
      table.leaseExpiresAt,
    ),
    check(
      'artifact_operations_operation_type_check',
      sql`${table.operationType} IN ('software_license_renewal', 'message_post')`,
    ),
    check(
      'artifact_operations_status_check',
      sql`${table.status} IN ('pending', 'artifact_created', 'completed', 'failed')`,
    ),
    check(
      'artifact_operations_artifact_shape_check',
      sql`(${table.artifactId} IS NULL AND ${table.artifactKind} IS NULL) OR (${table.artifactId} IS NOT NULL AND ${table.artifactKind} IS NOT NULL)`,
    ),
    check(
      'artifact_operations_artifact_kind_check',
      sql`${table.artifactKind} IS NULL OR ${table.artifactKind} IN ('requisition', 'rfq', 'message')`,
    ),
  ],
);

/** Durable, independently retryable notification deliveries for an operation. */
export const artifactNotificationDeliveries = pgTable(
  'artifact_notification_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    operationId: uuid('operation_id')
      .notNull(),
    deliveryKey: varchar('delivery_key', { length: 255 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    leaseToken: uuid('lease_token'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('artifact_notification_deliveries_operation_key_unique').on(
      table.operationId,
      table.deliveryKey,
    ),
    index('artifact_notification_deliveries_retry_idx').on(
      table.status,
      table.leaseExpiresAt,
    ),
    foreignKey({
      columns: [table.operationId, table.organizationId],
      foreignColumns: [artifactOperations.id, artifactOperations.organizationId],
      name: 'artifact_notification_deliveries_operation_org_fk',
    }).onDelete('cascade'),
    check(
      'artifact_notification_deliveries_status_check',
      sql`${table.status} IN ('pending', 'delivered', 'failed')`,
    ),
  ],
);

export type ArtifactOperation = typeof artifactOperations.$inferSelect;
export type ArtifactNotificationDelivery = typeof artifactNotificationDeliveries.$inferSelect;
