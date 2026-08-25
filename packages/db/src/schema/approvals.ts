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
  WORKFLOW_ASSIGNMENT_STATUSES,
  type ApproverResolver,
  type WorkflowAssignmentStatus,
} from '@betterspend/shared';
import { organizations, legalEntities } from './organizations';
import { users } from './users';
import { workflowDefinitionVersions } from './workflow-definitions';

export const approvalRules = pgTable('approval_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id),
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
  approvalRuleId: uuid('approval_rule_id')
    .notNull()
    .references(() => approvalRules.id),
  stepOrder: integer('step_order').notNull(),
  approverType: varchar('approver_type', { length: 50 }).notNull(), // user|role|department_head|budget_owner
  approverId: uuid('approver_id'),
  approverRole: varchar('approver_role', { length: 50 }),
  requiredCount: integer('required_count').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    approvableType: varchar('approvable_type', { length: 50 }).notNull(),
    approvableId: uuid('approvable_id').notNull(),
    approvalRuleId: uuid('approval_rule_id').references(() => approvalRules.id),
    definitionVersionId: uuid('definition_version_id'),
    initiatedBy: uuid('initiated_by'),
    currentNodeId: varchar('current_node_id', { length: 100 }),
    workflowContext: jsonb('workflow_context')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    attempt: integer('attempt').notNull().default(1),
    currentStep: integer('current_step').notNull().default(1),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    requiredApproverId: uuid('required_approver_id').references(() => users.id),
    requiredApprovalStep: integer('required_approval_step'),
    requiredApprovalReason: text('required_approval_reason'),
    requiredApprovalKey: varchar('required_approval_key', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('approval_requests_id_organization_id_unique').on(table.id, table.organizationId),
    index('approval_requests_org_status_idx').on(table.organizationId, table.status),
    foreignKey({
      columns: [table.definitionVersionId, table.organizationId],
      foreignColumns: [workflowDefinitionVersions.id, workflowDefinitionVersions.organizationId],
      name: 'approval_requests_definition_version_org_fk',
    }),
    foreignKey({
      columns: [table.initiatedBy, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
      name: 'approval_requests_initiated_by_org_fk',
    }),
  ],
);

export const workflowApprovalAssignments = pgTable(
  'workflow_approval_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    approvalRequestId: uuid('approval_request_id').notNull(),
    nodeId: varchar('node_id', { length: 100 }).notNull(),
    sequence: integer('sequence').notNull(),
    resolver: jsonb('resolver').$type<ApproverResolver>().notNull(),
    resolvedApproverId: uuid('resolved_approver_id').notNull(),
    assignedApproverId: uuid('assigned_approver_id').notNull(),
    status: varchar('status', { length: 20 })
      .$type<WorkflowAssignmentStatus>()
      .notNull()
      .default('pending'),
    actedBy: uuid('acted_by'),
    actedAt: timestamp('acted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('workflow_approval_assignments_request_node_sequence_unique').on(
      table.approvalRequestId,
      table.nodeId,
      table.sequence,
    ),
    index('workflow_approval_assignments_assignee_status_idx').on(
      table.organizationId,
      table.assignedApproverId,
      table.status,
    ),
    check(
      'workflow_approval_assignments_status_check',
      sql`${table.status} in (${sql.raw(WORKFLOW_ASSIGNMENT_STATUSES.map((status) => `'${status}'`).join(', '))})`,
    ),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: 'workflow_approval_assignments_organization_fk',
    }),
    foreignKey({
      columns: [table.approvalRequestId, table.organizationId],
      foreignColumns: [approvalRequests.id, approvalRequests.organizationId],
      name: 'workflow_approval_assignments_request_org_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.resolvedApproverId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
      name: 'workflow_approval_assignments_resolved_approver_org_fk',
    }),
    foreignKey({
      columns: [table.assignedApproverId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
      name: 'workflow_approval_assignments_assigned_approver_org_fk',
    }),
    foreignKey({
      columns: [table.actedBy, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
      name: 'workflow_approval_assignments_acted_by_org_fk',
    }),
  ],
);

export const approvalActions = pgTable('approval_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  approvalRequestId: uuid('approval_request_id')
    .notNull()
    .references(() => approvalRequests.id),
  stepOrder: integer('step_order').notNull(),
  approverId: uuid('approver_id').references(() => users.id),
  action: varchar('action', { length: 20 }).notNull(), // approved|rejected|delegated|returned
  comment: text('comment'),
  nodeId: varchar('node_id', { length: 100 }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  actedAt: timestamp('acted_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
