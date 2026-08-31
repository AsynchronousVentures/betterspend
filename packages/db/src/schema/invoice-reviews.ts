import { sql } from 'drizzle-orm';
import {
  check,
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import {
  INVOICE_REVIEW_PROVENANCE_HEADER_FIELDS,
  INVOICE_REVIEW_PROVENANCE_LINE_FIELDS,
  INVOICE_REVIEW_PROVENANCE_SOURCE_TYPES,
  INVOICE_REVIEW_CASE_STATES,
  INVOICE_REVIEW_SIGNAL_SEVERITIES,
  INVOICE_REVIEW_SIGNAL_STATUSES,
  INVOICE_REVIEW_SIGNAL_TYPES,
  type InvoiceReviewCaseState,
  type InvoiceReviewSignalSeverity,
  type InvoiceReviewSignalStatus,
  type InvoiceReviewSignalType,
} from '@betterspend/shared';
import { organizations } from './organizations';
import { users } from './users';
import { invoiceLines, invoices } from './invoices';

const valuesCheck = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(', '));

export const invoiceReviewCases = pgTable(
  'invoice_review_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    invoiceId: uuid('invoice_id').notNull(),
    state: varchar('state', { length: 30 })
      .$type<InvoiceReviewCaseState>()
      .notNull()
      .default('open'),
    ownerId: uuid('owner_id'),
    version: integer('version').notNull().default(1),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('invoice_review_cases_id_organization_id_unique').on(
      table.id,
      table.organizationId,
    ),
    uniqueIndex('invoice_review_cases_org_invoice_unique').on(
      table.organizationId,
      table.invoiceId,
    ),
    index('invoice_review_cases_org_state_opened_idx').on(
      table.organizationId,
      table.state,
      table.openedAt,
    ),
    foreignKey({
      columns: [table.invoiceId, table.organizationId],
      foreignColumns: [invoices.id, invoices.organizationId],
      name: 'invoice_review_cases_invoice_org_fk',
    }),
    foreignKey({
      columns: [table.ownerId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
      name: 'invoice_review_cases_owner_org_fk',
    }),
    check(
      'invoice_review_cases_state_check',
      sql`${table.state} IN (${valuesCheck(INVOICE_REVIEW_CASE_STATES)})`,
    ),
  ],
);

export const invoiceReviewSignals = pgTable(
  'invoice_review_signals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    caseId: uuid('case_id').notNull(),
    signalType: varchar('signal_type', { length: 50 }).$type<InvoiceReviewSignalType>().notNull(),
    sourceModule: varchar('source_module', { length: 50 }).notNull(),
    sourceRecordId: varchar('source_record_id', { length: 255 }).notNull(),
    severity: varchar('severity', { length: 20 }).$type<InvoiceReviewSignalSeverity>().notNull(),
    status: varchar('status', { length: 20 })
      .$type<InvoiceReviewSignalStatus>()
      .notNull()
      .default('open'),
    summary: text('summary').notNull(),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    resolutionActorId: uuid('resolution_actor_id'),
    resolutionCommand: varchar('resolution_command', { length: 50 }),
    resolutionReason: text('resolution_reason'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('invoice_review_signals_identity_unique').on(
      table.caseId,
      table.signalType,
      table.sourceModule,
      table.sourceRecordId,
    ),
    index('invoice_review_signals_case_status_severity_idx').on(
      table.caseId,
      table.status,
      table.severity,
    ),
    index('invoice_review_signals_org_source_idx').on(
      table.organizationId,
      table.sourceModule,
      table.sourceRecordId,
    ),
    foreignKey({
      columns: [table.caseId, table.organizationId],
      foreignColumns: [invoiceReviewCases.id, invoiceReviewCases.organizationId],
      name: 'invoice_review_signals_case_org_fk',
    }),
    foreignKey({
      columns: [table.resolutionActorId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
      name: 'invoice_review_signals_resolution_actor_org_fk',
    }),
    check(
      'invoice_review_signals_type_check',
      sql`${table.signalType} IN (${valuesCheck(INVOICE_REVIEW_SIGNAL_TYPES)})`,
    ),
    check(
      'invoice_review_signals_severity_check',
      sql`${table.severity} IN (${valuesCheck(INVOICE_REVIEW_SIGNAL_SEVERITIES)})`,
    ),
    check(
      'invoice_review_signals_status_check',
      sql`${table.status} IN (${valuesCheck(INVOICE_REVIEW_SIGNAL_STATUSES)})`,
    ),
  ],
);

const provenanceLineFieldPathPattern = `'^lines\\.[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-8][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}\\.(${INVOICE_REVIEW_PROVENANCE_LINE_FIELDS.join('|')})$'`;

export const invoiceFieldProvenance = pgTable(
  'invoice_field_provenance',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    invoiceId: uuid('invoice_id').notNull(),
    invoiceLineId: uuid('invoice_line_id'),
    fieldPath: varchar('field_path', { length: 150 }).notNull(),
    sourceType: varchar('source_type', { length: 30 }).notNull(),
    sourceRecordId: varchar('source_record_id', { length: 255 }).notNull(),
    sourceTimestamp: timestamp('source_timestamp', { withTimezone: true }),
    confidence: numeric('confidence', { precision: 5, scale: 4 }),
    actorId: uuid('actor_id'),
    isCurrent: boolean('is_current').notNull().default(true),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    identityKey: varchar('identity_key', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('invoice_field_provenance_identity_key_unique').on(table.identityKey),
    index('invoice_field_provenance_invoice_current_idx').on(
      table.organizationId,
      table.invoiceId,
      table.isCurrent,
    ),
    index('invoice_field_provenance_source_idx').on(
      table.organizationId,
      table.sourceType,
      table.sourceRecordId,
    ),
    foreignKey({
      columns: [table.invoiceId, table.organizationId],
      foreignColumns: [invoices.id, invoices.organizationId],
      name: 'invoice_field_provenance_invoice_org_fk',
    }),
    foreignKey({
      columns: [table.invoiceLineId, table.invoiceId],
      foreignColumns: [invoiceLines.id, invoiceLines.invoiceId],
      name: 'invoice_field_provenance_invoice_line_invoice_fk',
    }),
    foreignKey({
      columns: [table.actorId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
      name: 'invoice_field_provenance_actor_org_fk',
    }),
    check(
      'invoice_field_provenance_source_type_check',
      sql`${table.sourceType} IN (${valuesCheck(INVOICE_REVIEW_PROVENANCE_SOURCE_TYPES)})`,
    ),
    check(
      'invoice_field_provenance_field_path_check',
      sql`(
        (${table.fieldPath} IN (${valuesCheck(INVOICE_REVIEW_PROVENANCE_HEADER_FIELDS)}) AND ${table.invoiceLineId} IS NULL)
        OR (
          ${table.fieldPath} ~ ${sql.raw(provenanceLineFieldPathPattern)}
          AND ${table.invoiceLineId} IS NOT NULL
          AND lower(split_part(${table.fieldPath}, '.', 2)) = ${table.invoiceLineId}::text
        )
      )
      `,
    ),
    check(
      'invoice_field_provenance_confidence_check',
      sql`${table.confidence} IS NULL OR (${table.confidence} >= 0 AND ${table.confidence} <= 1)`,
    ),
  ],
);
