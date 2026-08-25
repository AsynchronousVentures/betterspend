import { sql } from 'drizzle-orm';
import {
  bigint,
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
import { organizations } from './organizations';
import { vendors } from './vendors';

export const emailIntakeItems = pgTable(
  'email_intake_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    sourceEmail: varchar('source_email', { length: 255 }).notNull(),
    subject: varchar('subject', { length: 500 }).notNull(),
    body: text('body').notNull(),
    detectedType: varchar('detected_type', { length: 30 }).notNull().default('triage'), // invoice|requisition|triage
    status: varchar('status', { length: 30 }).notNull().default('pending_review'), // pending_review|discarded|converted
    extractedVendorName: varchar('extracted_vendor_name', { length: 255 }),
    extractedTotal: varchar('extracted_total', { length: 30 }),
    extractedCurrency: varchar('extracted_currency', { length: 3 }),
    rawPayload: jsonb('raw_payload').notNull().default({}),
    createdDraftType: varchar('created_draft_type', { length: 30 }),
    createdDraftId: uuid('created_draft_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('email_intake_items_id_org_unique').on(table.id, table.organizationId)],
);

/** Exactly one opaque inbound address token is issued to each organization. */
export const emailIntakeAddresses = pgTable(
  'email_intake_addresses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    token: varchar('token', { length: 48 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('email_intake_addresses_org_unique').on(table.organizationId),
    uniqueIndex('email_intake_addresses_token_unique').on(table.token),
  ],
);

/** Immutable receipt facts and risk decisions for one SES message. */
export const emailIntakeMessages = pgTable(
  'email_intake_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    sesMessageId: varchar('ses_message_id', { length: 255 }).notNull(),
    rawStorageKey: varchar('raw_storage_key', { length: 500 }).notNull(),
    sourceEmail: varchar('source_email', { length: 255 }).notNull(),
    envelopeSource: varchar('envelope_source', { length: 255 }).notNull(),
    recipients: jsonb('recipients').$type<string[]>().notNull(),
    subject: varchar('subject', { length: 500 }).notNull().default(''),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    authVerdicts: jsonb('auth_verdicts')
      .$type<{ spam: string; virus: string; spf: string; dkim: string; dmarc: string }>()
      .notNull(),
    senderClassification: varchar('sender_classification', { length: 30 }).notNull(),
    vendorId: uuid('vendor_id'),
    riskScore: integer('risk_score').notNull(),
    riskSignals: jsonb('risk_signals').$type<string[]>().notNull(),
    status: varchar('status', { length: 20 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('email_intake_messages_org_ses_id_unique').on(
      table.organizationId,
      table.sesMessageId,
    ),
    uniqueIndex('email_intake_messages_id_org_unique').on(table.id, table.organizationId),
    index('email_intake_messages_org_received_idx').on(table.organizationId, table.receivedAt),
    foreignKey({
      columns: [table.vendorId, table.organizationId],
      foreignColumns: [vendors.id, vendors.organizationId],
      name: 'email_intake_messages_vendor_org_fk',
    }),
    check(
      'email_intake_messages_sender_classification_check',
      sql`${table.senderClassification} IN ('known_vendor', 'employee', 'unknown')`,
    ),
    check(
      'email_intake_messages_status_check',
      sql`${table.status} IN ('accepted', 'partial', 'rejected', 'duplicate')`,
    ),
    check('email_intake_messages_risk_score_check', sql`${table.riskScore} BETWEEN 0 AND 100`),
  ],
);

/** One append-only processing outcome for each non-inline MIME attachment. */
export const emailIntakeAttachments = pgTable(
  'email_intake_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    messageId: uuid('message_id').notNull(),
    emailIntakeItemId: uuid('email_intake_item_id'),
    filename: varchar('filename', { length: 255 }).notNull(),
    contentType: varchar('content_type', { length: 100 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    storageKey: varchar('storage_key', { length: 500 }),
    status: varchar('status', { length: 20 }).notNull(),
    rejectionReason: varchar('rejection_reason', { length: 80 }),
    invoiceNumberHint: varchar('invoice_number_hint', { length: 100 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.messageId, table.organizationId],
      foreignColumns: [emailIntakeMessages.id, emailIntakeMessages.organizationId],
      name: 'email_intake_attachments_message_org_fk',
    }),
    foreignKey({
      columns: [table.emailIntakeItemId, table.organizationId],
      foreignColumns: [emailIntakeItems.id, emailIntakeItems.organizationId],
      name: 'email_intake_attachments_item_org_fk',
    }),
    index('email_intake_attachments_message_idx').on(table.messageId),
    index('email_intake_attachments_org_hash_idx').on(table.organizationId, table.contentHash),
    check(
      'email_intake_attachments_status_check',
      sql`${table.status} IN ('pending', 'accepted', 'duplicate', 'rejected')`,
    ),
    check(
      'email_intake_attachments_outcome_check',
      sql`(${table.status} IN ('pending', 'accepted') AND ${table.storageKey} IS NOT NULL AND ${table.rejectionReason} IS NULL) OR (${table.status} IN ('duplicate', 'rejected') AND ${table.storageKey} IS NULL AND ${table.rejectionReason} IS NOT NULL)`,
    ),
  ],
);
