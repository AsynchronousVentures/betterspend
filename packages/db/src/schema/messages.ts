import { pgTable, uuid, varchar, text, jsonb, timestamp, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizations } from './organizations';
import { users } from './users';
import { vendors } from './vendors';

/**
 * Append-only threaded messaging between internal users and suppliers,
 * attached to a procurement record (PO, RFQ, invoice, or GRN). Messages are
 * never edited or deleted so the conversation history stays audit-grade.
 *
 * senderType 'user' -> senderId references users; 'vendor' -> vendors.
 */
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    threadType: varchar('thread_type', { length: 20 }).notNull(), // po|rfq|grn|invoice
    threadId: uuid('thread_id').notNull(),
    senderType: varchar('sender_type', { length: 10 }).notNull(), // user|vendor
    senderId: uuid('sender_id').references(() => users.id),
    vendorId: uuid('vendor_id').references(() => vendors.id),
    // On RFQ threads, the invited vendor a buyer message is addressed to.
    // Null on buyer messages means visible to every invited vendor; vendor
    // messages never set it (they are inherently their own).
    recipientVendorId: uuid('recipient_vendor_id').references(() => vendors.id),
    authorName: varchar('author_name', { length: 255 }).notNull(),
    body: text('body').notNull(),
    // Metadata for attached files (document ids/urls); upload wiring is separate.
    attachments: jsonb('attachments').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('messages_thread_idx').on(table.threadType, table.threadId, table.createdAt),
    check(
      'messages_thread_type_check',
      sql`${table.threadType} IN ('po', 'rfq', 'grn', 'invoice')`,
    ),
    check('messages_sender_type_check', sql`${table.senderType} IN ('user', 'vendor')`),
    check(
      'messages_sender_exclusive_check',
      sql`(${table.senderType} = 'user' AND ${table.senderId} IS NOT NULL AND ${table.vendorId} IS NULL) OR (${table.senderType} = 'vendor' AND ${table.vendorId} IS NOT NULL AND ${table.senderId} IS NULL)`,
    ),
    check('messages_body_check', sql`length(trim(${table.body})) > 0`),
    check(
      'messages_recipient_rfq_buyer_check',
      sql`${table.recipientVendorId} IS NULL OR (${table.threadType} = 'rfq' AND ${table.senderType} = 'user')`,
    ),
  ],
);
