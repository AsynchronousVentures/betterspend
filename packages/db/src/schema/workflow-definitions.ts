import type { ExecutableDefinition, WorkflowDraft, WorkflowGraph } from '@betterspend/shared';
import {
  type AnyPgColumn,
  ForeignKeyBuilder,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { legalEntities, organizations } from './organizations';
import { users } from './users';

export const workflowDefinitions = pgTable(
  'workflow_definitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    entityId: uuid('entity_id'),
    domain: varchar('domain', { length: 30 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    currentDraft: jsonb('current_draft').$type<WorkflowDraft>().notNull(),
    draftFence: integer('draft_fence').notNull().default(0),
    publishedVersionId: uuid('published_version_id'),
    createdBy: uuid('created_by').notNull(),
    updatedBy: uuid('updated_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('workflow_definitions_org_domain_idx').on(table.organizationId, table.domain),
    index('workflow_definitions_entity_idx').on(table.entityId),
    uniqueIndex('workflow_definitions_id_organization_id_unique').on(
      table.id,
      table.organizationId,
    ),
    foreignKey({
      columns: [table.entityId, table.organizationId],
      foreignColumns: [legalEntities.id, legalEntities.organizationId],
      name: 'workflow_definitions_entity_org_fk',
    }),
    foreignKey({
      columns: [table.createdBy, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
      name: 'workflow_definitions_created_by_org_fk',
    }),
    foreignKey({
      columns: [table.updatedBy, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
      name: 'workflow_definitions_updated_by_org_fk',
    }),
    new ForeignKeyBuilder(
      (): { name: string; columns: AnyPgColumn[]; foreignColumns: AnyPgColumn[] } => ({
        columns: [table.publishedVersionId, table.organizationId],
        foreignColumns: [workflowDefinitionVersions.id, workflowDefinitionVersions.organizationId],
        name: 'workflow_definitions_published_version_org_fk',
      }),
    ),
  ],
);

export const workflowDefinitionVersions = pgTable(
  'workflow_definition_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    definitionId: uuid('definition_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    version: integer('version').notNull(),
    graphJson: jsonb('graph_json').$type<WorkflowGraph>().notNull(),
    positionsJson: jsonb('positions_json')
      .$type<WorkflowDraft['positions']>()
      .notNull()
      .default({}),
    notesJson: jsonb('notes_json').$type<WorkflowDraft['notes']>().notNull().default([]),
    executableJson: jsonb('executable_json').$type<ExecutableDefinition>().notNull(),
    publishedBy: uuid('published_by').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('workflow_definition_versions_definition_version_unique').on(
      table.definitionId,
      table.version,
    ),
    index('workflow_definition_versions_definition_idx').on(table.definitionId),
    uniqueIndex('workflow_definition_versions_id_organization_id_unique').on(
      table.id,
      table.organizationId,
    ),
    foreignKey({
      columns: [table.definitionId, table.organizationId],
      foreignColumns: [workflowDefinitions.id, workflowDefinitions.organizationId],
      name: 'workflow_definition_versions_definition_org_fk',
    }),
    foreignKey({
      columns: [table.publishedBy, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
      name: 'workflow_definition_versions_published_by_org_fk',
    }),
  ],
);
