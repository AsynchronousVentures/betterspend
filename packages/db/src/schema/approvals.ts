import { pgTable, uuid, varchar, text, integer, boolean, timestamp } from 'drizzle-orm/pg-core';
import { organizations, legalEntities } from './organizations';
import { users } from './users';

export const approvalRules = pgTable('approval_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  entityId: uuid('entity_id').references(() => legalEntities.id),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  priority: integer('priority').notNull().default(100),
  isActive: boolean('is_active').notNull().default(true),
  conditions: text('conditions').notNull().default('{}'), // JSON stored as text for complex expressions
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const approvalRuleSteps = pgTable('approval_rule_steps', {
  id: uuid('id').primaryKey().defaultRandom(),
  approvalRuleId: uuid('approval_rule_id').notNull().references(() => approvalRules.id),
  stepOrder: integer('step_order').notNull(),
  approverType: varchar('approver_type', { length: 50 }).notNull(), // user|role|department_head|budget_owner
  approverId: uuid('approver_id'),
  approverRole: varchar('approver_role', { length: 50 }),
  requiredCount: integer('required_count').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const approvalRequests = pgTable('approval_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  approvableType: varchar('approvable_type', { length: 50 }).notNull(),
  approvableId: uuid('approvable_id').notNull(),
  approvalRuleId: uuid('approval_rule_id').references(() => approvalRules.id),
  currentStep: integer('current_step').notNull().default(1),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const approvalActions = pgTable('approval_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  approvalRequestId: uuid('approval_request_id').notNull().references(() => approvalRequests.id),
  stepOrder: integer('step_order').notNull(),
  approverId: uuid('approver_id').notNull().references(() => users.id),
  action: varchar('action', { length: 20 }).notNull(), // approved|rejected|delegated|returned
  comment: text('comment'),
  actedAt: timestamp('acted_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
