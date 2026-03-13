import { pgTable, uuid, varchar, boolean, jsonb, timestamp, text } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { vendors } from './vendors';

export const onboardingQuestionnaires = pgTable('onboarding_questionnaires', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  name: varchar('name', { length: 255 }).notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  questions: jsonb('questions').notNull().default([]),
  scoringRules: jsonb('scoring_rules').notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const vendorOnboardingSubmissions = pgTable('vendor_onboarding_submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  vendorId: uuid('vendor_id').notNull().references(() => vendors.id, { onDelete: 'cascade' }),
  questionnaireId: uuid('questionnaire_id').references(() => onboardingQuestionnaires.id),
  status: varchar('status', { length: 30 }).notNull().default('draft'),
  companyInfo: jsonb('company_info').notNull().default({}),
  responses: jsonb('responses').notNull().default({}),
  documentLinks: jsonb('document_links').notNull().default({}),
  bankingDetails: jsonb('banking_details').notNull().default({}),
  riskScore: varchar('risk_score', { length: 20 }).notNull().default('0'),
  riskLevel: varchar('risk_level', { length: 20 }).notNull().default('low'),
  reviewNote: text('review_note'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
