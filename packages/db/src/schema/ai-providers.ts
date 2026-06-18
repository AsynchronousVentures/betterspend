import { pgTable, uuid, varchar, text, boolean, jsonb, timestamp, unique, index } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { users } from './users';

export const aiProviderConnections = pgTable('ai_provider_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  provider: varchar('provider', { length: 30 }).notNull(),
  authMethod: varchar('auth_method', { length: 30 }).notNull().default('api_key'),
  encryptedCredential: text('encrypted_credential').notNull(),
  credentialHint: varchar('credential_hint', { length: 80 }),
  defaultModel: varchar('default_model', { length: 160 }).notNull(),
  enabled: boolean('enabled').notNull().default(true),
  isDefault: boolean('is_default').notNull().default(false),
  status: varchar('status', { length: 30 }).notNull().default('connected'),
  lastValidatedAt: timestamp('last_validated_at', { withTimezone: true }),
  lastError: text('last_error'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdBy: uuid('created_by').references(() => users.id),
  updatedBy: uuid('updated_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uniqueOrgProvider: unique('ai_provider_connections_org_provider_unique').on(table.organizationId, table.provider),
  orgDefaultIdx: index('ai_provider_connections_org_default_idx').on(table.organizationId, table.isDefault),
}));

export const aiProviderOauthStates = pgTable('ai_provider_oauth_states', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  provider: varchar('provider', { length: 30 }).notNull(),
  state: varchar('state', { length: 128 }).notNull().unique(),
  codeVerifier: text('code_verifier').notNull(),
  callbackUrl: text('callback_url').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  orgProviderIdx: index('ai_provider_oauth_states_org_provider_idx').on(table.organizationId, table.provider),
}));
