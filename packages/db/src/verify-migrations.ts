import postgres from 'postgres';

const EXPECTED_TABLES = [
  'vendor_portal_tokens',
  'vendor_portal_sessions',
  'notifications',
  'integration_connections',
  'sync_records',
  'external_entity_mappings',
  'workflow_definitions',
  'workflow_definition_versions',
  'workflow_approval_assignments',
  'workflow_runtime_publications',
  'email_intake_addresses',
  'email_intake_messages',
  'email_intake_attachments',
  'invoice_field_provenance',
  'invoice_review_cases',
  'invoice_review_signals',
  'invoice_review_notification_intents',
] as const;

const EXPECTED_COLUMNS = [
  { table: 'audit_log', column: 'prev_hash' },
  { table: 'audit_log', column: 'entry_hash' },
  { table: 'auth_accounts', column: 'issuer' },
  { table: 'auth_accounts', column: 'access_token_expires_at' },
  { table: 'auth_accounts', column: 'refresh_token_expires_at' },
  { table: 'auth_accounts', column: 'scope' },
  { table: 'approval_requests', column: 'definition_version_id' },
  { table: 'approval_requests', column: 'current_node_id' },
  { table: 'approval_requests', column: 'attempt' },
  { table: 'approval_requests', column: 'organization_id' },
  { table: 'approval_requests', column: 'initiated_by' },
  { table: 'approval_requests', column: 'workflow_context' },
  { table: 'approval_actions', column: 'node_id' },
  { table: 'approval_actions', column: 'metadata' },
  { table: 'users', column: 'manager_id' },
  { table: 'workflow_definitions', column: 'draft_fence' },
  { table: 'workflow_definition_versions', column: 'organization_id' },
  { table: 'workflow_definition_versions', column: 'notes_json' },
  { table: 'workflow_runtime_publications', column: 'outcome_status' },
  { table: 'external_entity_mappings', column: 'external_id' },
  { table: 'external_entity_mappings', column: 'realm_id' },
  { table: 'external_entity_mappings', column: 'sync_token' },
  { table: 'external_entity_mappings', column: 'local_id' },
  { table: 'invoice_field_provenance', column: 'superseded_at' },
  { table: 'invoice_review_notification_intents', column: 'intent_kind' },
  { table: 'invoice_review_notification_intents', column: 'message_id' },
  { table: 'invoice_review_notification_intents', column: 'lease_token' },
  { table: 'invoice_review_notification_intents', column: 'lease_expires_at' },
] as const;

const EXPECTED_INDEXES = [
  {
    name: 'audit_log_organization_created_at_id_idx',
    table: 'audit_log',
    columns: ['organization_id', 'created_at', 'id'],
    unique: false,
  },
  {
    name: 'auth_accounts_user_id_idx',
    table: 'auth_accounts',
    columns: ['user_id'],
    unique: false,
  },
  {
    name: 'auth_accounts_issuer_account_id_unique',
    table: 'auth_accounts',
    columns: ['issuer', 'account_id'],
    unique: true,
  },
  {
    name: 'users_email_normalized_unique',
    table: 'users',
    columns: ['lower(email::text)'],
    unique: true,
  },
  {
    name: 'external_entity_mappings_external_identity_unique',
    table: 'external_entity_mappings',
    columns: [
      'organization_id',
      'provider',
      'direction',
      'external_entity',
      'external_id',
      'realm_id',
    ],
    unique: true,
  },
  {
    name: 'external_entity_mappings_linked_local_identity_unique',
    table: 'external_entity_mappings',
    columns: ['organization_id', 'provider', 'direction', 'local_entity', 'local_id'],
    unique: true,
  },
  {
    name: 'invoice_review_cases_org_invoice_unique',
    table: 'invoice_review_cases',
    columns: ['organization_id', 'invoice_id'],
    unique: true,
  },
  {
    name: 'invoice_review_signals_identity_unique',
    table: 'invoice_review_signals',
    columns: ['case_id', 'signal_type', 'source_module', 'source_record_id'],
    unique: true,
  },
  {
    name: 'invoice_field_provenance_identity_key_unique',
    table: 'invoice_field_provenance',
    columns: ['identity_key'],
    unique: true,
  },
  {
    name: 'invoice_field_provenance_invoice_current_idx',
    table: 'invoice_field_provenance',
    columns: ['organization_id', 'invoice_id', 'is_current'],
    unique: false,
  },
  {
    name: 'invoice_field_provenance_source_idx',
    table: 'invoice_field_provenance',
    columns: ['organization_id', 'source_type', 'source_record_id'],
    unique: false,
  },
  {
    name: 'invoice_lines_id_invoice_id_unique',
    table: 'invoice_lines',
    columns: ['id', 'invoice_id'],
    unique: true,
  },
  {
    name: 'messages_id_organization_id_unique',
    table: 'messages',
    columns: ['id', 'organization_id'],
    unique: true,
  },
] as const;

const EXPECTED_TRIGGERS = [
  'workflow_definition_versions_immutable',
  'workflow_definitions_published_version_owner',
  'email_intake_messages_append_only',
] as const;

const EXPECTED_CHECK_CONSTRAINTS = [
  {
    table: 'invoice_field_provenance',
    name: 'invoice_field_provenance_source_type_check',
    expectedDefinition:
      "CHECK (((source_type)::text = ANY ((ARRAY['OCR'::character varying, 'email_intake'::character varying, 'supplier'::character varying, 'import'::character varying, 'PO'::character varying, 'catalog'::character varying, 'manual'::character varying])::text[])))",
  },
  {
    table: 'invoice_field_provenance',
    name: 'invoice_field_provenance_field_path_check',
    expectedDefinition:
      "CHECK (((((field_path)::text = ANY ((ARRAY['vendor'::character varying, 'invoiceNumber'::character varying, 'invoiceDate'::character varying, 'dueDate'::character varying, 'currency'::character varying, 'exchangeRate'::character varying, 'subtotal'::character varying, 'taxAmount'::character varying, 'totalAmount'::character varying])::text[])) AND (invoice_line_id IS NULL)) OR (((field_path)::text ~ '^lines\\.[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-8][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}\\.(description|quantity|unitPrice|poLineId|taxCodeId|glAccount|taxInclusive)$'::text) AND (invoice_line_id IS NOT NULL) AND (lower(split_part((field_path)::text, '.'::text, 2)) = (invoice_line_id)::text))))",
  },
  {
    table: 'invoice_field_provenance',
    name: 'invoice_field_provenance_confidence_check',
    expectedDefinition:
      'CHECK (((confidence IS NULL) OR ((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))))',
  },
  {
    table: 'invoice_review_notification_intents',
    name: 'invoice_review_notification_intents_kind_check',
    expectedDefinition:
      "CHECK (((intent_kind)::text = ANY ((ARRAY['internal_notification'::character varying, 'supplier_message_email'::character varying])::text[])))",
  },
  {
    table: 'invoice_review_notification_intents',
    name: 'invoice_review_notification_intents_delivery_shape_check',
    expectedDefinition:
      "CHECK (((((intent_kind)::text = 'internal_notification'::text) AND (recipient_user_id IS NOT NULL) AND (message_id IS NULL)) OR (((intent_kind)::text = 'supplier_message_email'::text) AND (recipient_user_id IS NULL) AND (message_id IS NOT NULL))))",
  },
] as const;

const EXPECTED_FOREIGN_KEYS = [
  {
    name: 'vendor_portal_tokens_vendor_id_vendors_id_fk',
    child: 'vendor_portal_tokens',
    parent: 'vendors',
    childColumns: ['vendor_id'],
    parentColumns: ['id'],
  },
  {
    name: 'vendor_portal_sessions_organization_id_organizations_id_fk',
    child: 'vendor_portal_sessions',
    parent: 'organizations',
    childColumns: ['organization_id'],
    parentColumns: ['id'],
  },
  {
    name: 'vendor_portal_sessions_vendor_org_fk',
    child: 'vendor_portal_sessions',
    parent: 'vendors',
    childColumns: ['vendor_id', 'organization_id'],
    parentColumns: ['id', 'organization_id'],
  },
  {
    name: 'notifications_user_id_users_id_fk',
    child: 'notifications',
    parent: 'users',
    childColumns: ['user_id'],
    parentColumns: ['id'],
  },
  {
    name: 'integration_connections_organization_id_organizations_id_fk',
    child: 'integration_connections',
    parent: 'organizations',
    childColumns: ['organization_id'],
    parentColumns: ['id'],
  },
  {
    name: 'integration_connections_connected_by_user_org_fk',
    child: 'integration_connections',
    parent: 'users',
    childColumns: ['connected_by_user_id', 'organization_id'],
    parentColumns: ['id', 'organization_id'],
  },
  {
    name: 'sync_records_connection_org_fk',
    child: 'sync_records',
    parent: 'integration_connections',
    childColumns: ['connection_id', 'organization_id'],
    parentColumns: ['id', 'organization_id'],
  },
  {
    name: 'external_entity_mappings_organization_id_organizations_id_fk',
    child: 'external_entity_mappings',
    parent: 'organizations',
    childColumns: ['organization_id'],
    parentColumns: ['id'],
  },
  {
    name: 'external_entity_mappings_connection_org_fk',
    child: 'external_entity_mappings',
    parent: 'integration_connections',
    childColumns: ['connection_id', 'organization_id'],
    parentColumns: ['id', 'organization_id'],
  },
  {
    name: 'workflow_definition_versions_definition_org_fk',
    child: 'workflow_definition_versions',
    parent: 'workflow_definitions',
    childColumns: ['definition_id', 'organization_id'],
    parentColumns: ['id', 'organization_id'],
  },
  {
    name: 'workflow_definitions_published_version_org_fk',
    child: 'workflow_definitions',
    parent: 'workflow_definition_versions',
    childColumns: ['published_version_id', 'organization_id'],
    parentColumns: ['id', 'organization_id'],
  },
  {
    name: 'workflow_definitions_entity_org_fk',
    child: 'workflow_definitions',
    parent: 'legal_entities',
    childColumns: ['entity_id', 'organization_id'],
    parentColumns: ['id', 'organization_id'],
  },
  {
    name: 'workflow_definitions_created_by_org_fk',
    child: 'workflow_definitions',
    parent: 'users',
    childColumns: ['created_by', 'organization_id'],
    parentColumns: ['id', 'organization_id'],
  },
  {
    name: 'workflow_definitions_updated_by_org_fk',
    child: 'workflow_definitions',
    parent: 'users',
    childColumns: ['updated_by', 'organization_id'],
    parentColumns: ['id', 'organization_id'],
  },
  {
    name: 'workflow_definition_versions_published_by_org_fk',
    child: 'workflow_definition_versions',
    parent: 'users',
    childColumns: ['published_by', 'organization_id'],
    parentColumns: ['id', 'organization_id'],
  },
  {
    name: 'users_manager_org_fk',
    child: 'users',
    parent: 'users',
    childColumns: ['manager_id', 'organization_id'],
    parentColumns: ['id', 'organization_id'],
  },
  {
    name: 'approval_requests_organization_id_organizations_id_fk',
    child: 'approval_requests',
    parent: 'organizations',
    childColumns: ['organization_id'],
    parentColumns: ['id'],
  },
  {
    name: 'approval_requests_definition_version_org_fk',
    child: 'approval_requests',
    parent: 'workflow_definition_versions',
    childColumns: ['definition_version_id', 'organization_id'],
    parentColumns: ['id', 'organization_id'],
  },
  {
    name: 'approval_requests_initiated_by_org_fk',
    child: 'approval_requests',
    parent: 'users',
    childColumns: ['initiated_by', 'organization_id'],
    parentColumns: ['id', 'organization_id'],
  },
  {
    name: 'workflow_approval_assignments_organization_fk',
    child: 'workflow_approval_assignments',
    parent: 'organizations',
    childColumns: ['organization_id'],
    parentColumns: ['id'],
  },
  {
    name: 'workflow_approval_assignments_request_org_fk',
    child: 'workflow_approval_assignments',
    parent: 'approval_requests',
    childColumns: ['approval_request_id', 'organization_id'],
    parentColumns: ['id', 'organization_id'],
  },
  {
    name: 'workflow_approval_assignments_resolved_approver_org_fk',
    child: 'workflow_approval_assignments',
    parent: 'users',
    childColumns: ['resolved_approver_id', 'organization_id'],
    parentColumns: ['id', 'organization_id'],
  },
  {
    name: 'workflow_approval_assignments_assigned_approver_org_fk',
    child: 'workflow_approval_assignments',
    parent: 'users',
    childColumns: ['assigned_approver_id', 'organization_id'],
    parentColumns: ['id', 'organization_id'],
  },
  {
    name: 'workflow_approval_assignments_acted_by_org_fk',
    child: 'workflow_approval_assignments',
    parent: 'users',
    childColumns: ['acted_by', 'organization_id'],
    parentColumns: ['id', 'organization_id'],
  },
  {
    name: 'workflow_runtime_publications_organization_fk',
    child: 'workflow_runtime_publications',
    parent: 'organizations',
    childColumns: ['organization_id'],
    parentColumns: ['id'],
  },
  {
    name: 'workflow_runtime_publications_request_org_fk',
    child: 'workflow_runtime_publications',
    parent: 'approval_requests',
    childColumns: ['approval_request_id', 'organization_id'],
    parentColumns: ['id', 'organization_id'],
  },
  {
    name: 'email_intake_attachments_message_org_fk',
    child: 'email_intake_attachments',
    parent: 'email_intake_messages',
    childColumns: ['message_id', 'organization_id'],
    parentColumns: ['id', 'organization_id'],
  },
  {
    name: 'email_intake_attachments_item_org_fk',
    child: 'email_intake_attachments',
    parent: 'email_intake_items',
    childColumns: ['email_intake_item_id', 'organization_id'],
    parentColumns: ['id', 'organization_id'],
  },
  {
    name: 'email_intake_messages_vendor_org_fk',
    child: 'email_intake_messages',
    parent: 'vendors',
    childColumns: ['vendor_id', 'organization_id'],
    parentColumns: ['id', 'organization_id'],
  },
  {
    name: 'invoice_review_cases_organization_id_organizations_id_fk',
    child: 'invoice_review_cases',
    parent: 'organizations',
    childColumns: ['organization_id'],
    parentColumns: ['id'],
  },
  {
    name: 'invoice_review_signals_organization_id_organizations_id_fk',
    child: 'invoice_review_signals',
    parent: 'organizations',
    childColumns: ['organization_id'],
    parentColumns: ['id'],
  },
  {
    name: 'invoice_review_cases_invoice_org_fk',
    child: 'invoice_review_cases',
    parent: 'invoices',
    childColumns: ['invoice_id', 'organization_id'],
    parentColumns: ['id', 'organization_id'],
  },
  {
    name: 'invoice_review_cases_owner_org_fk',
    child: 'invoice_review_cases',
    parent: 'users',
    childColumns: ['owner_id', 'organization_id'],
    parentColumns: ['id', 'organization_id'],
  },
  {
    name: 'invoice_review_signals_case_org_fk',
    child: 'invoice_review_signals',
    parent: 'invoice_review_cases',
    childColumns: ['case_id', 'organization_id'],
    parentColumns: ['id', 'organization_id'],
  },
  {
    name: 'invoice_review_signals_resolution_actor_org_fk',
    child: 'invoice_review_signals',
    parent: 'users',
    childColumns: ['resolution_actor_id', 'organization_id'],
    parentColumns: ['id', 'organization_id'],
  },
  {
    name: 'invoice_review_notification_intents_message_org_fk',
    child: 'invoice_review_notification_intents',
    parent: 'messages',
    childColumns: ['message_id', 'organization_id'],
    parentColumns: ['id', 'organization_id'],
  },
  {
    name: 'invoice_field_provenance_organization_id_organizations_id_fk',
    child: 'invoice_field_provenance',
    parent: 'organizations',
    childColumns: ['organization_id'],
    parentColumns: ['id'],
  },
  {
    name: 'invoice_field_provenance_invoice_line_invoice_fk',
    child: 'invoice_field_provenance',
    parent: 'invoice_lines',
    childColumns: ['invoice_line_id', 'invoice_id'],
    parentColumns: ['id', 'invoice_id'],
  },
  {
    name: 'invoice_field_provenance_invoice_org_fk',
    child: 'invoice_field_provenance',
    parent: 'invoices',
    childColumns: ['invoice_id', 'organization_id'],
    parentColumns: ['id', 'organization_id'],
  },
  {
    name: 'invoice_field_provenance_actor_org_fk',
    child: 'invoice_field_provenance',
    parent: 'users',
    childColumns: ['actor_id', 'organization_id'],
    parentColumns: ['id', 'organization_id'],
  },
] as const;

type ForeignKeyDescription = {
  name: string;
  child: string;
  parent: string;
  childColumns: readonly string[];
  parentColumns: readonly string[];
};

type IndexDescription = {
  name: string;
  table: string;
  columns: readonly string[];
  unique: boolean;
};

type CheckConstraintDescription = {
  table: string;
  name: string;
  definition: string;
};

function foreignKeySignature(foreignKey: ForeignKeyDescription): string {
  return [
    foreignKey.name,
    foreignKey.child,
    foreignKey.parent,
    foreignKey.childColumns.join(','),
    foreignKey.parentColumns.join(','),
  ].join(':');
}

function indexSignature(index: IndexDescription): string {
  return [index.name, index.table, index.columns.join(','), index.unique].join(':');
}

function normalizeConstraintDefinition(definition: string): string {
  return definition.replace(/\s+/g, ' ');
}

async function main(): Promise<void> {
  const client = postgres(process.env.DATABASE_URL!);
  try {
    const tables = await client<{ name: string }[]>`
      SELECT table_name AS name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ${client(EXPECTED_TABLES)}
    `;
    const constraints = await client<ForeignKeyDescription[]>`
      SELECT
        fk.conname AS name,
        child.relname AS child,
        parent.relname AS parent,
        ARRAY(
          SELECT child_attribute.attname
          FROM unnest(fk.conkey) WITH ORDINALITY AS child_key(attnum, position)
          JOIN pg_attribute AS child_attribute
            ON child_attribute.attrelid = fk.conrelid
            AND child_attribute.attnum = child_key.attnum
          ORDER BY child_key.position
        ) AS "childColumns",
        ARRAY(
          SELECT parent_attribute.attname
          FROM unnest(fk.confkey) WITH ORDINALITY AS parent_key(attnum, position)
          JOIN pg_attribute AS parent_attribute
            ON parent_attribute.attrelid = fk.confrelid
            AND parent_attribute.attnum = parent_key.attnum
          ORDER BY parent_key.position
        ) AS "parentColumns"
      FROM pg_constraint AS fk
      JOIN pg_class AS child ON child.oid = fk.conrelid
      JOIN pg_namespace AS child_namespace ON child_namespace.oid = child.relnamespace
      JOIN pg_class AS parent ON parent.oid = fk.confrelid
      JOIN pg_namespace AS parent_namespace ON parent_namespace.oid = parent.relnamespace
      WHERE fk.contype = 'f'
        AND child_namespace.nspname = 'public'
        AND parent_namespace.nspname = 'public'
        AND fk.conname IN ${client(EXPECTED_FOREIGN_KEYS.map((item) => item.name))}
    `;
    const columns = await client<{ table: string; column: string }[]>`
      SELECT table_name AS table, column_name AS column
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ${client(EXPECTED_COLUMNS.map((item) => item.table))}
        AND column_name IN ${client(EXPECTED_COLUMNS.map((item) => item.column))}
    `;
    const triggers = await client<{ name: string }[]>`
      SELECT trigger.tgname AS name
      FROM pg_trigger trigger
      JOIN pg_class table_definition ON table_definition.oid = trigger.tgrelid
      JOIN pg_namespace table_namespace ON table_namespace.oid = table_definition.relnamespace
      WHERE NOT trigger.tgisinternal
        AND table_namespace.nspname = 'public'
        AND trigger.tgenabled IN ('O', 'A')
        AND trigger.tgname IN ${client(EXPECTED_TRIGGERS)}
    `;
    const checks = await client<CheckConstraintDescription[]>`
      SELECT
        table_definition.relname AS table,
        check_constraint.conname AS name,
        pg_get_constraintdef(check_constraint.oid) AS definition
      FROM pg_constraint AS check_constraint
      JOIN pg_class AS table_definition
        ON table_definition.oid = check_constraint.conrelid
      JOIN pg_namespace AS table_namespace
        ON table_namespace.oid = table_definition.relnamespace
      WHERE check_constraint.contype = 'c'
        AND table_namespace.nspname = 'public'
        AND check_constraint.conname IN ${client(EXPECTED_CHECK_CONSTRAINTS.map((item) => item.name))}
    `;
    const indexes = await client<IndexDescription[]>`
      SELECT
        index_class.relname AS name,
        table_class.relname AS table,
        index_data.indisunique AS "unique",
        ARRAY(
          SELECT pg_get_indexdef(index_data.indexrelid, position, true)
          FROM generate_series(1, index_data.indnkeyatts) AS position
          ORDER BY position
        ) AS columns
      FROM pg_index AS index_data
      JOIN pg_class AS index_class ON index_class.oid = index_data.indexrelid
      JOIN pg_class AS table_class ON table_class.oid = index_data.indrelid
      JOIN pg_namespace AS table_namespace ON table_namespace.oid = table_class.relnamespace
      WHERE table_namespace.nspname = 'public'
        AND index_data.indisvalid
        AND index_class.relname IN ${client(EXPECTED_INDEXES.map((index) => index.name))}
    `;
    const [issuerColumn] = await client<{ nullable: string }[]>`
      SELECT is_nullable AS nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'auth_accounts'
        AND column_name = 'issuer'
    `;
    const foundTables = new Set(tables.map((row) => row.name));
    const foundConstraints = new Set(constraints.map(foreignKeySignature));
    const foundColumns = new Set(columns.map((row) => `${row.table}.${row.column}`));
    const foundTriggers = new Set(triggers.map((row) => row.name));
    const foundChecks = new Set(
      checks
        .filter((row) => {
          const expected = EXPECTED_CHECK_CONSTRAINTS.find(
            (item) => item.table === row.table && item.name === row.name,
          );
          if (!expected) return false;
          return (
            normalizeConstraintDefinition(row.definition) ===
            normalizeConstraintDefinition(expected.expectedDefinition)
          );
        })
        .map((row) => `${row.table}.${row.name}`),
    );
    const foundIndexes = new Set(indexes.map(indexSignature));
    const missingTables = EXPECTED_TABLES.filter((name) => !foundTables.has(name));
    const missingConstraints = EXPECTED_FOREIGN_KEYS.filter(
      (item) => !foundConstraints.has(foreignKeySignature(item)),
    ).map((item) => item.name);
    const missingColumns = EXPECTED_COLUMNS.filter(
      (item) => !foundColumns.has(`${item.table}.${item.column}`),
    ).map((item) => `${item.table}.${item.column}`);
    const missingTriggers = EXPECTED_TRIGGERS.filter((name) => !foundTriggers.has(name));
    const missingChecks = EXPECTED_CHECK_CONSTRAINTS.filter(
      (item) => !foundChecks.has(`${item.table}.${item.name}`),
    ).map((item) => `${item.table}.${item.name}`);
    const missingIndexes = EXPECTED_INDEXES.filter(
      (index) => !foundIndexes.has(indexSignature(index)),
    ).map((index) => index.name);
    const invalidAuthIssuer = issuerColumn?.nullable !== 'NO';

    if (
      missingTables.length ||
      missingConstraints.length ||
      missingColumns.length ||
      missingTriggers.length ||
      missingChecks.length ||
      missingIndexes.length ||
      invalidAuthIssuer
    ) {
      throw new Error(
        `Migration verification failed. Missing tables: ${missingTables.join(', ') || 'none'}. ` +
          `Missing constraints: ${missingConstraints.join(', ') || 'none'}. ` +
          `Missing columns: ${missingColumns.join(', ') || 'none'}. ` +
          `Missing triggers: ${missingTriggers.join(', ') || 'none'}. ` +
          `Missing checks: ${missingChecks.join(', ') || 'none'}. ` +
          `Missing indexes: ${missingIndexes.join(', ') || 'none'}. ` +
          `Auth issuer nullable: ${invalidAuthIssuer}.`,
      );
    }
    console.log('Migration verification passed.');
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
