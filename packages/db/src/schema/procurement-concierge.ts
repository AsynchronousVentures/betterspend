import { pgTable, uuid, varchar, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { users } from './users';

export interface ConciergeTranscriptEntry {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export const procurementPolicies = pgTable('procurement_policies', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  title: varchar('title', { length: 255 }).notNull(),
  policyType: varchar('policy_type', { length: 50 }).notNull().default('general'),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  body: text('body').notNull(),
  rules: jsonb('rules').$type<Record<string, unknown>>().notNull().default({}),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const intakeConciergeSessions = pgTable('intake_concierge_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  requesterId: uuid('requester_id').references(() => users.id),
  status: varchar('status', { length: 30 }).notNull().default('draft'),
  sourceText: text('source_text').notNull(),
  transcript: jsonb('transcript').$type<ConciergeTranscriptEntry[]>().notNull().default([]),
  draft: jsonb('draft').$type<Record<string, unknown>>().notNull().default({}),
  plan: jsonb('plan').$type<Record<string, unknown>>().notNull().default({}),
  acceptedValues: jsonb('accepted_values').$type<Record<string, unknown>>().notNull().default({}),
  convertedDraftType: varchar('converted_draft_type', { length: 30 }),
  convertedDraftId: uuid('converted_draft_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
