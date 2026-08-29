import {
  check,
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
  (table) => ({
    organizationKey: uniqueIndex('artifact_operations_org_key_unique').on(
      table.organizationId,
      table.idempotencyKey,
    ),
    retryLookup: index('artifact_operations_org_status_idx').on(
      table.organizationId,
      table.operationType,
      table.status,
      table.leaseExpiresAt,
    ),
    operationTypeCheck: check(
      'artifact_operations_operation_type_check',
      sql`${table.operationType} IN ('software_license_renewal', 'message_post')`,
    ),
    statusCheck: check(
      'artifact_operations_status_check',
      sql`${table.status} IN ('pending', 'artifact_created', 'completed', 'failed')`,
    ),
    artifactShapeCheck: check(
      'artifact_operations_artifact_shape_check',
      sql`(${table.artifactId} IS NULL AND ${table.artifactKind} IS NULL) OR (${table.artifactId} IS NOT NULL AND ${table.artifactKind} IS NOT NULL)`,
    ),
  }),
);

export type ArtifactOperation = typeof artifactOperations.$inferSelect;
