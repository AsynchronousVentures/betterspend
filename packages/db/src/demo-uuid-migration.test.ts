import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { upsertDemoFixtures, type DemoIdentity } from './demo-fixtures';
import { generateRandomSeedDataset } from './random-seed';
import * as schema from './schema';

const migrationDirectory = join(__dirname, 'migrations');
const upgradeMigration = '20260827033118_standardize_demo_uuid_identities.sql';
const legacyIdentity: DemoIdentity = {
  organizationId: '00000000-0000-0000-0000-000000000001',
  adminId: '00000000-0000-0000-0000-000000000002',
  requesterId: '00000000-0000-0000-0000-000000000003',
  approverId: '00000000-0000-0000-0000-000000000004',
  engineeringDepartmentId: '00000000-0000-0000-0000-000000000010',
  marketingDepartmentId: '00000000-0000-0000-0000-000000000011',
  parentEntityId: '00000000-0000-0000-0000-000000000020',
  vendorIds: [
    '00000000-0000-0000-0000-000000000030',
    '00000000-0000-0000-0000-000000000031',
  ],
};

const migrationWorkload = {
  otherOrganizationId: '10000000-0000-4000-8000-000000000001',
  otherUserId: '10000000-0000-4000-8000-000000000002',
  otherAuditEntityId: '10000000-0000-4000-8000-000000000003',
  emailItemId: '10000000-0000-4000-8000-000000000010',
  emailMessageId: '10000000-0000-4000-8000-000000000011',
  emailAttachmentId: '10000000-0000-4000-8000-000000000012',
  workflowDefinitionId: '10000000-0000-4000-8000-000000000020',
  workflowVersionId: '10000000-0000-4000-8000-000000000021',
  approvalRequestId: '10000000-0000-4000-8000-000000000022',
  workflowAssignmentId: '10000000-0000-4000-8000-000000000023',
  workflowPublicationId: '10000000-0000-4000-8000-000000000024',
  integrationConnectionId: '10000000-0000-4000-8000-000000000030',
  syncRecordId: '10000000-0000-4000-8000-000000000031',
  budgetId: '10000000-0000-4000-8000-000000000040',
  purchaseOrderId: '10000000-0000-4000-8000-000000000041',
  invoiceId: '10000000-0000-4000-8000-000000000042',
  budgetEventBudgetId: '10000000-0000-4000-8000-000000000043',
  budgetEventRequisitionId: '10000000-0000-4000-8000-000000000044',
  budgetEventPurchaseOrderId: '10000000-0000-4000-8000-000000000045',
  budgetEventInvoiceId: '10000000-0000-4000-8000-000000000046',
  otherWorkflowDefinitionId: '10000000-0000-4000-8000-000000000050',
  otherWorkflowVersionId: '10000000-0000-4000-8000-000000000051',
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const temporarilyDeferredConstraints = [
  'approval_requests_definition_version_org_fk',
  'approval_requests_initiated_by_org_fk',
  'budget_commitment_events_budget_org_fk',
  'budget_commitment_events_invoice_org_fk',
  'budget_commitment_events_purchase_order_org_fk',
  'budget_commitment_events_requisition_org_fk',
  'email_intake_attachments_item_org_fk',
  'email_intake_attachments_message_org_fk',
  'sync_records_connection_org_fk',
  'workflow_approval_assignments_acted_by_org_fk',
  'workflow_approval_assignments_assigned_approver_org_fk',
  'workflow_approval_assignments_request_org_fk',
  'workflow_approval_assignments_resolved_approver_org_fk',
  'workflow_definition_versions_definition_org_fk',
  'workflow_definition_versions_published_by_org_fk',
  'workflow_definitions_published_version_org_fk',
  'workflow_runtime_publications_request_org_fk',
] as const;

function resolverGraph(
  resolverUserId: string,
  fallbackUserId: string,
  escalationUserId: string,
) {
  return {
    domain: 'requisition',
    entryNodeId: 'approval',
    nodes: [
      {
        id: 'approval',
        name: 'Approval',
        disabled: false,
        type: 'approver_group',
        config: {
          execution: 'serial',
          resolvers: [{ type: 'user', userId: resolverUserId }],
          quorum: { type: 'all' },
          separationOfDuties: {
            enabled: true,
            exclude: ['requester'],
            fallbackResolvers: [{ type: 'user', userId: fallbackUserId }],
          },
        },
      },
      {
        id: 'escalation',
        name: 'Escalation',
        disabled: false,
        type: 'escalation_timer',
        config: {
          parentNodeId: 'approval',
          slaHours: 4,
          warningPercent: 75,
          action: {
            type: 'reassign',
            resolvers: [{ type: 'user', userId: escalationUserId }],
          },
        },
      },
    ],
    edges: [],
  };
}

function workflowDraftWithResolvers(
  resolverUserId: string,
  fallbackUserId: string,
  escalationUserId: string,
) {
  return {
    graph: resolverGraph(resolverUserId, fallbackUserId, escalationUserId),
    positions: {},
  };
}

function executableWorkflowWithResolvers(
  resolverUserId: string,
  fallbackUserId: string,
  escalationUserId: string,
) {
  const graph = resolverGraph(resolverUserId, fallbackUserId, escalationUserId);
  return {
    schemaVersion: 1,
    domain: graph.domain,
    entryStepId: graph.entryNodeId,
    steps: graph.nodes.map((node) => ({ node, transitions: [] })),
  };
}

async function createMigratedDatabase(): Promise<PGlite> {
  const database = new PGlite();
  const migrationFiles = (await readdir(migrationDirectory))
    .filter((file) => file.endsWith('.sql') && file !== upgradeMigration)
    .sort();
  for (const file of migrationFiles) {
    await database.exec(await readFile(join(migrationDirectory, file), 'utf8'));
  }
  return database;
}

test('fresh demo seeding uses generated UUIDs and preserves identities on rerun', async () => {
  const database = await createMigratedDatabase();
  try {
    const fixtureDb = drizzle(database, { schema });
    const first = await fixtureDb.transaction((tx) => upsertDemoFixtures(tx as never));
    const second = await fixtureDb.transaction((tx) => upsertDemoFixtures(tx as never));

    assert.deepEqual(second, first);
    for (const id of [
      first.organizationId,
      first.adminId,
      first.requesterId,
      first.approverId,
      first.engineeringDepartmentId,
      first.marketingDepartmentId,
      first.parentEntityId,
      ...first.vendorIds,
    ]) {
      assert.match(id, uuidPattern);
    }

    const [counts] = (
      await database.query<{ fixtureCount: string; legacyCount: string }>(`
        SELECT
          (
            (SELECT count(*) FROM organizations WHERE slug = 'acme-corp')
            + (SELECT count(*) FROM users WHERE email IN ('admin@acme.com', 'requester@acme.com', 'approver@acme.com'))
            + (SELECT count(*) FROM departments WHERE organization_id = '${first.organizationId}' AND code IN ('ENG', 'MKT'))
            + (SELECT count(*) FROM legal_entities WHERE organization_id = '${first.organizationId}' AND code = 'ACME-HQ')
            + (SELECT count(*) FROM vendors WHERE organization_id = '${first.organizationId}' AND code IN ('ACME-SUP', 'TECHPARTS'))
            + (SELECT count(*) FROM user_roles WHERE organization_id = '${first.organizationId}' AND role IN ('admin', 'requester', 'approver'))
          )::text AS "fixtureCount",
          (
            (SELECT count(*) FROM organizations WHERE id = '${legacyIdentity.organizationId}')
            + (SELECT count(*) FROM users WHERE id IN ('${legacyIdentity.adminId}', '${legacyIdentity.requesterId}', '${legacyIdentity.approverId}'))
            + (SELECT count(*) FROM departments WHERE id IN ('${legacyIdentity.engineeringDepartmentId}', '${legacyIdentity.marketingDepartmentId}'))
            + (SELECT count(*) FROM legal_entities WHERE id = '${legacyIdentity.parentEntityId}')
            + (SELECT count(*) FROM vendors WHERE id IN ('${legacyIdentity.vendorIds[0]}', '${legacyIdentity.vendorIds[1]}'))
          )::text AS "legacyCount"
      `)
    ).rows;
    assert.equal(counts?.fixtureCount, '12');
    assert.equal(counts?.legacyCount, '0');
  } finally {
    await database.close();
  }
});

test('rekeys a legacy demo graph without losing workload references', async () => {
  const database = await createMigratedDatabase();
  try {
    const dataset = generateRandomSeedDataset(
      { count: 1, seed: 'legacy-upgrade-regression' },
      legacyIdentity,
    );
    const requisition = dataset.requisitions[0];
    const requisitionLine = dataset.requisitionLines.find(
      (line) => line.requisitionId === requisition?.id,
    );
    assert.ok(requisition);
    assert.ok(requisitionLine);
    const legacyResolverGraph = resolverGraph(
      legacyIdentity.adminId,
      legacyIdentity.requesterId,
      legacyIdentity.approverId,
    );
    const legacyWorkflowDraft = workflowDraftWithResolvers(
      legacyIdentity.adminId,
      legacyIdentity.requesterId,
      legacyIdentity.approverId,
    );
    const legacyExecutableWorkflow = executableWorkflowWithResolvers(
      legacyIdentity.adminId,
      legacyIdentity.requesterId,
      legacyIdentity.approverId,
    );

    await database.exec(`
      INSERT INTO organizations (id, name, slug)
        VALUES ('${legacyIdentity.organizationId}', 'Acme Corp', 'acme-corp');
      INSERT INTO legal_entities (id, organization_id, name, code)
        VALUES ('${legacyIdentity.parentEntityId}', '${legacyIdentity.organizationId}', 'Acme Holdings', 'ACME-HQ');
      INSERT INTO departments (id, organization_id, name, code)
        VALUES
          ('${legacyIdentity.engineeringDepartmentId}', '${legacyIdentity.organizationId}', 'Engineering', 'ENG'),
          ('${legacyIdentity.marketingDepartmentId}', '${legacyIdentity.organizationId}', 'Marketing', 'MKT');
      INSERT INTO users (id, organization_id, email, name, email_verified, department_id)
        VALUES
          ('${legacyIdentity.adminId}', '${legacyIdentity.organizationId}', 'admin@acme.com', 'Admin User', true, '${legacyIdentity.engineeringDepartmentId}'),
          ('${legacyIdentity.requesterId}', '${legacyIdentity.organizationId}', 'requester@acme.com', 'Jane Requester', true, '${legacyIdentity.engineeringDepartmentId}'),
          ('${legacyIdentity.approverId}', '${legacyIdentity.organizationId}', 'approver@acme.com', 'Bob Approver', true, '${legacyIdentity.engineeringDepartmentId}');
      INSERT INTO user_roles (id, user_id, organization_id, role, scope_type)
        VALUES
          ('00000000-0000-0000-0000-000000000040', '${legacyIdentity.adminId}', '${legacyIdentity.organizationId}', 'admin', 'global'),
          ('00000000-0000-0000-0000-000000000041', '${legacyIdentity.requesterId}', '${legacyIdentity.organizationId}', 'requester', 'global'),
          ('00000000-0000-0000-0000-000000000042', '${legacyIdentity.approverId}', '${legacyIdentity.organizationId}', 'approver', 'global');
      INSERT INTO vendors (id, organization_id, entity_id, name, code, esg_notes)
        VALUES
          ('${legacyIdentity.vendorIds[0]}', '${legacyIdentity.organizationId}', '${legacyIdentity.parentEntityId}', 'Acme Supplies Inc.', 'ACME-SUP', 'Keep ${legacyIdentity.organizationId} as literal vendor copy.'),
          ('${legacyIdentity.vendorIds[1]}', '${legacyIdentity.organizationId}', '${legacyIdentity.parentEntityId}', 'TechParts Global', 'TECHPARTS', null);
      INSERT INTO organizations (id, name, slug)
        VALUES ('${migrationWorkload.otherOrganizationId}', 'Other organization', 'other-organization');
      INSERT INTO users (id, organization_id, email, name, email_verified)
        VALUES ('${migrationWorkload.otherUserId}', '${migrationWorkload.otherOrganizationId}', 'other@example.test', 'Other User', true);
    `);

    await database.query(
      `INSERT INTO requisitions (
         id, organization_id, requester_id, department_id, number, title,
         description, status, priority, needed_by, total_amount, currency,
         source_type, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        requisition.id,
        requisition.organizationId,
        requisition.requesterId,
        requisition.departmentId,
        requisition.number,
        requisition.title,
        requisition.description,
        requisition.status,
        requisition.priority,
        requisition.neededBy,
        requisition.totalAmount,
        requisition.currency,
        requisition.sourceType,
        requisition.createdAt,
        requisition.updatedAt,
      ],
    );
    await database.query(
      `INSERT INTO requisition_lines (
         id, requisition_id, line_number, description, quantity, unit_of_measure,
         unit_price, total_price, vendor_id, gl_account, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        requisitionLine.id,
        requisitionLine.requisitionId,
        requisitionLine.lineNumber,
        requisitionLine.description,
        requisitionLine.quantity,
        requisitionLine.unitOfMeasure,
        requisitionLine.unitPrice,
        requisitionLine.totalPrice,
        requisitionLine.vendorId,
        requisitionLine.glAccount,
        requisitionLine.createdAt,
        requisitionLine.updatedAt,
      ],
    );
    await database.query(
      `INSERT INTO purchase_orders (
         id, organization_id, entity_id, requisition_id, vendor_id, number, issued_by
       ) VALUES ($1, $2, $3, $4, $5, 'PO-LEGACY-MIGRATION', $6)`,
      [
        migrationWorkload.purchaseOrderId,
        legacyIdentity.organizationId,
        legacyIdentity.parentEntityId,
        requisition.id,
        legacyIdentity.vendorIds[0],
        legacyIdentity.adminId,
      ],
    );
    await database.query(
      `INSERT INTO invoices (
         id, organization_id, entity_id, purchase_order_id, vendor_id, invoice_number,
         internal_number, invoice_date, created_by
       ) VALUES ($1, $2, $3, $4, $5, 'LEGACY-INV', 'INV-LEGACY-MIGRATION', now(), $6)`,
      [
        migrationWorkload.invoiceId,
        legacyIdentity.organizationId,
        legacyIdentity.parentEntityId,
        migrationWorkload.purchaseOrderId,
        legacyIdentity.vendorIds[0],
        legacyIdentity.adminId,
      ],
    );
    await database.query(
      `INSERT INTO budgets (
         id, organization_id, entity_id, name, budget_type, scope_id, fiscal_year, total_amount
       ) VALUES ($1, $2, $3, 'Legacy migration budget', 'department', $4, 2026, '1000')`,
      [
        migrationWorkload.budgetId,
        legacyIdentity.organizationId,
        legacyIdentity.parentEntityId,
        legacyIdentity.engineeringDepartmentId,
      ],
    );
    await database.query(
      `INSERT INTO budget_commitment_events (
         id, organization_id, budget_id, requisition_id, purchase_order_id, invoice_id,
         event_key, event_type, reason
       ) VALUES
         ($1, $2, $3, null, null, null, 'legacy-budget', 'legacy_commitment_backfill', 'migration test'),
         ($4, $2, $3, $5, null, null, 'legacy-requisition', 'requisition_reserved', 'migration test'),
         ($6, $2, $3, null, $7, null, 'legacy-purchase-order', 'purchase_order_committed', 'migration test'),
         ($8, $2, $3, null, null, $9, 'legacy-invoice', 'invoice_expended', 'migration test')`,
      [
        migrationWorkload.budgetEventBudgetId,
        legacyIdentity.organizationId,
        migrationWorkload.budgetId,
        migrationWorkload.budgetEventRequisitionId,
        requisition.id,
        migrationWorkload.budgetEventPurchaseOrderId,
        migrationWorkload.purchaseOrderId,
        migrationWorkload.budgetEventInvoiceId,
        migrationWorkload.invoiceId,
      ],
    );
    await database.query(
      `INSERT INTO integration_connections (
         id, organization_id, provider, realm_id, connected_by_user_id
       ) VALUES ($1, $2, 'quickbooks', 'legacy-realm', $3)`,
      [
        migrationWorkload.integrationConnectionId,
        legacyIdentity.organizationId,
        legacyIdentity.adminId,
      ],
    );
    await database.query(
      `INSERT INTO sync_records (
         id, organization_id, connection_id, provider, direction, local_entity, local_id,
         external_entity, request_id, doc_number
       ) VALUES ($1, $2, $3, 'quickbooks', 'outbound', 'requisition', $4,
         'purchase_order', 'legacy-sync-request', 'REQ-LEGACY-MIGRATION')`,
      [
        migrationWorkload.syncRecordId,
        legacyIdentity.organizationId,
        migrationWorkload.integrationConnectionId,
        requisition.id,
      ],
    );
    await database.query(
      `INSERT INTO messages (
         organization_id, thread_type, thread_id, sender_type, sender_id,
         author_name, body
       ) VALUES ($1, 'po', $2, 'user', $3, 'Jane Requester', 'Legacy message')`,
      [legacyIdentity.organizationId, requisition.id, legacyIdentity.requesterId],
    );
    await database.query(
      `INSERT INTO messages (
         organization_id, thread_type, thread_id, sender_type, vendor_id,
         author_name, body
       ) VALUES ($1, 'po', $2, 'vendor', $3, 'TechParts Global', 'Legacy supplier reply')`,
      [legacyIdentity.organizationId, requisition.id, legacyIdentity.vendorIds[1]],
    );
    await database.query(
      `INSERT INTO audit_log (
         organization_id, user_id, entity_type, entity_id, action, changes
       ) VALUES ($1, $2, 'requisition', $3, 'created', $4)`,
      [
        legacyIdentity.organizationId,
        legacyIdentity.adminId,
        requisition.id,
        JSON.stringify({ requesterId: legacyIdentity.requesterId }),
      ],
    );
    await database.query(`UPDATE audit_log SET metadata = $1 WHERE entity_id = $2`, [
      JSON.stringify({
        ownerId: legacyIdentity.adminId,
        note: `owner=${legacyIdentity.adminId}`,
      }),
      requisition.id,
    ]);
    await database.query(
      `INSERT INTO requisition_templates (
         organization_id, created_by_id, name, template_data
       ) VALUES ($1, $2, 'Legacy engineering template', $3)`,
      [
        legacyIdentity.organizationId,
        legacyIdentity.adminId,
        JSON.stringify({ departmentId: legacyIdentity.engineeringDepartmentId }),
      ],
    );
    await database.query(
      `INSERT INTO system_settings (organization_id, key, value)
       VALUES ($1, 'legacy-upgrade-test', $2)`,
      [legacyIdentity.organizationId, `owner=${legacyIdentity.adminId}`],
    );
    await database.query(
      `INSERT INTO audit_log (
         organization_id, user_id, entity_type, entity_id, action, changes, metadata
       ) VALUES ($1, $2, 'requisition', $3, 'created', $4, $5)`,
      [
        migrationWorkload.otherOrganizationId,
        migrationWorkload.otherUserId,
        migrationWorkload.otherAuditEntityId,
        JSON.stringify({ requesterId: legacyIdentity.requesterId }),
        JSON.stringify({ ownerId: legacyIdentity.adminId }),
      ],
    );
    await database.query(
      `INSERT INTO requisition_templates (
         organization_id, created_by_id, name, template_data
       ) VALUES ($1, $2, 'Other organization template', $3)`,
      [
        migrationWorkload.otherOrganizationId,
        migrationWorkload.otherUserId,
        JSON.stringify({ departmentId: legacyIdentity.engineeringDepartmentId }),
      ],
    );
    await database.query(
      `INSERT INTO email_intake_items (
         id, organization_id, source_email, subject, body
       ) VALUES ($1, $2, 'sales@acmesupplies.com', 'Legacy item', 'Legacy body')`,
      [migrationWorkload.emailItemId, legacyIdentity.organizationId],
    );
    await database.query(
      `INSERT INTO email_intake_messages (
         id, organization_id, ses_message_id, raw_storage_key, source_email,
         envelope_source, recipients, subject, received_at, auth_verdicts,
         sender_classification, vendor_id, risk_score, risk_signals, status
       ) VALUES ($1, $2, 'legacy-ses-message', 'legacy/raw.eml',
         'sales@acmesupplies.com', 'sales@acmesupplies.com', $3, 'Legacy email', now(),
         $4, 'known_vendor', $5, 0, $6, 'accepted')`,
      [
        migrationWorkload.emailMessageId,
        legacyIdentity.organizationId,
        JSON.stringify(['ap@acme.com']),
        JSON.stringify({ spam: 'PASS', virus: 'PASS', spf: 'PASS', dkim: 'PASS', dmarc: 'PASS' }),
        legacyIdentity.vendorIds[0],
        JSON.stringify([]),
      ],
    );
    await database.query(
      `INSERT INTO email_intake_attachments (
         id, organization_id, message_id, email_intake_item_id, filename,
         content_type, size_bytes, content_hash, storage_key, status
       ) VALUES ($1, $2, $3, $4, 'legacy.pdf', 'application/pdf', 42,
         'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
         'legacy/attachment.pdf', 'accepted')`,
      [
        migrationWorkload.emailAttachmentId,
        legacyIdentity.organizationId,
        migrationWorkload.emailMessageId,
        migrationWorkload.emailItemId,
      ],
    );
    await database.query(
      `INSERT INTO workflow_definitions (
         id, organization_id, entity_id, domain, name, current_draft, created_by, updated_by
       ) VALUES ($1, $2, $3, 'requisition', 'Legacy workflow', $4, $5, $5)`,
      [
        migrationWorkload.workflowDefinitionId,
        legacyIdentity.organizationId,
        legacyIdentity.parentEntityId,
        JSON.stringify(legacyWorkflowDraft),
        legacyIdentity.adminId,
      ],
    );
    await database.query(
      `INSERT INTO workflow_definition_versions (
         id, definition_id, organization_id, version, graph_json, positions_json,
         executable_json, published_by
       ) VALUES ($1, $2, $3, 1, $4, $5, $6, $7)`,
      [
        migrationWorkload.workflowVersionId,
        migrationWorkload.workflowDefinitionId,
        legacyIdentity.organizationId,
        JSON.stringify(legacyResolverGraph),
        JSON.stringify({}),
        JSON.stringify(legacyExecutableWorkflow),
        legacyIdentity.adminId,
      ],
    );
    await database.query(
      `UPDATE workflow_definitions SET published_version_id = $1 WHERE id = $2`,
      [migrationWorkload.workflowVersionId, migrationWorkload.workflowDefinitionId],
    );
    await database.query(
      `INSERT INTO workflow_definitions (
         id, organization_id, domain, name, current_draft, created_by, updated_by
       ) VALUES ($1, $2, 'requisition', 'Other workflow', $3, $4, $4)`,
      [
        migrationWorkload.otherWorkflowDefinitionId,
        migrationWorkload.otherOrganizationId,
        JSON.stringify(legacyWorkflowDraft),
        migrationWorkload.otherUserId,
      ],
    );
    await database.query(
      `INSERT INTO workflow_definition_versions (
         id, definition_id, organization_id, version, graph_json, positions_json,
         executable_json, published_by
       ) VALUES ($1, $2, $3, 1, $4, $5, $6, $7)`,
      [
        migrationWorkload.otherWorkflowVersionId,
        migrationWorkload.otherWorkflowDefinitionId,
        migrationWorkload.otherOrganizationId,
        JSON.stringify(legacyResolverGraph),
        JSON.stringify({}),
        JSON.stringify(legacyExecutableWorkflow),
        migrationWorkload.otherUserId,
      ],
    );
    await database.query(
      `UPDATE workflow_definitions SET published_version_id = $1 WHERE id = $2`,
      [migrationWorkload.otherWorkflowVersionId, migrationWorkload.otherWorkflowDefinitionId],
    );
    await database.query(
      `INSERT INTO approval_requests (
         id, organization_id, approvable_type, approvable_id, definition_version_id,
         initiated_by, workflow_context
       ) VALUES ($1, $2, 'requisition', $3, $4, $5, $6)`,
      [
        migrationWorkload.approvalRequestId,
        legacyIdentity.organizationId,
        requisition.id,
        migrationWorkload.workflowVersionId,
        legacyIdentity.adminId,
        JSON.stringify({}),
      ],
    );
    await database.query(
      `INSERT INTO workflow_approval_assignments (
         id, organization_id, approval_request_id, node_id, sequence, resolver,
         resolved_approver_id, assigned_approver_id
       ) VALUES ($1, $2, $3, 'manager', 1, $4, $5, $6)`,
      [
        migrationWorkload.workflowAssignmentId,
        legacyIdentity.organizationId,
        migrationWorkload.approvalRequestId,
        JSON.stringify({}),
        legacyIdentity.adminId,
        legacyIdentity.requesterId,
      ],
    );
    await database.query(
      `INSERT INTO workflow_runtime_publications (
         id, organization_id, approval_request_id, node_id, attempt, outcome_status
       ) VALUES ($1, $2, $3, 'manager', 1, 'approved')`,
      [
        migrationWorkload.workflowPublicationId,
        legacyIdentity.organizationId,
        migrationWorkload.approvalRequestId,
      ],
    );

    const migration = await readFile(join(migrationDirectory, upgradeMigration), 'utf8');
    await database.exec(migration);

    const identityResult = await database.query<{
      organizationId: string;
      adminId: string;
      requesterId: string;
      approverId: string;
      departmentId: string;
      entityId: string;
      primaryVendorId: string;
      secondaryVendorId: string;
      vendorNote: string;
    }>(`
      SELECT
        organization.id AS "organizationId",
        admin.id AS "adminId",
        requester.id AS "requesterId",
        approver.id AS "approverId",
        department.id AS "departmentId",
        entity.id AS "entityId",
        primary_vendor.id AS "primaryVendorId",
        secondary_vendor.id AS "secondaryVendorId",
        primary_vendor.esg_notes AS "vendorNote"
      FROM organizations AS organization
      JOIN users AS admin ON admin.organization_id = organization.id AND admin.email = 'admin@acme.com'
      JOIN users AS requester ON requester.organization_id = organization.id AND requester.email = 'requester@acme.com'
      JOIN users AS approver ON approver.organization_id = organization.id AND approver.email = 'approver@acme.com'
      JOIN departments AS department ON department.organization_id = organization.id AND department.code = 'ENG'
      JOIN legal_entities AS entity ON entity.organization_id = organization.id AND entity.code = 'ACME-HQ'
      JOIN vendors AS primary_vendor ON primary_vendor.organization_id = organization.id AND primary_vendor.code = 'ACME-SUP'
      JOIN vendors AS secondary_vendor ON secondary_vendor.organization_id = organization.id AND secondary_vendor.code = 'TECHPARTS'
      WHERE organization.slug = 'acme-corp'
    `);
    const identity = identityResult.rows[0];
    assert.ok(identity);
    for (const id of [
      identity.organizationId,
      identity.adminId,
      identity.requesterId,
      identity.approverId,
      identity.departmentId,
      identity.entityId,
      identity.primaryVendorId,
      identity.secondaryVendorId,
    ]) {
      assert.match(id, uuidPattern);
    }
    assert.notEqual(identity.organizationId, legacyIdentity.organizationId);
    assert.notEqual(identity.adminId, legacyIdentity.adminId);
    assert.notEqual(identity.requesterId, legacyIdentity.requesterId);
    assert.notEqual(identity.approverId, legacyIdentity.approverId);
    assert.notEqual(identity.primaryVendorId, legacyIdentity.vendorIds[0]);
    assert.notEqual(identity.secondaryVendorId, legacyIdentity.vendorIds[1]);

    const workloadResult = await database.query<{
      requisitionId: string;
      organizationId: string;
      requesterId: string;
      departmentId: string;
      vendorId: string;
      vendorMessageId: string;
      senderId: string;
      vendorMessageVendorId: string;
      auditRequesterId: string;
      settingValue: string;
      settingOrganizationId: string;
      auditOwnerId: string;
      auditNote: string;
      templateDepartmentId: string;
    }>(`
      SELECT
        requisition.id AS "requisitionId",
        requisition.organization_id AS "organizationId",
        requisition.requester_id AS "requesterId",
        requisition.department_id AS "departmentId",
        line.vendor_id AS "vendorId",
        vendor_message.id AS "vendorMessageId",
        user_message.sender_id AS "senderId",
        vendor_message.vendor_id AS "vendorMessageVendorId",
        audit.changes ->> 'requesterId' AS "auditRequesterId",
        audit.metadata ->> 'ownerId' AS "auditOwnerId",
        audit.metadata ->> 'note' AS "auditNote",
        template.template_data ->> 'departmentId' AS "templateDepartmentId",
        setting.organization_id AS "settingOrganizationId",
        setting.value AS "settingValue"
      FROM requisitions AS requisition
      JOIN requisition_lines AS line ON line.requisition_id = requisition.id
      JOIN messages AS user_message
        ON user_message.thread_id = requisition.id AND user_message.sender_type = 'user'
      JOIN messages AS vendor_message
        ON vendor_message.thread_id = requisition.id AND vendor_message.sender_type = 'vendor'
      JOIN audit_log AS audit ON audit.entity_id = requisition.id
      JOIN requisition_templates AS template ON template.name = 'Legacy engineering template'
      JOIN system_settings AS setting ON setting.key = 'legacy-upgrade-test'
      WHERE requisition.id = '${requisition.id}'
    `);
    assert.deepEqual(workloadResult.rows[0], {
      requisitionId: requisition.id,
      organizationId: identity.organizationId,
      requesterId: identity.requesterId,
      departmentId: identity.departmentId,
      vendorId: identity.primaryVendorId,
      vendorMessageId: assertHasValue(workloadResult.rows[0]?.vendorMessageId),
      senderId: identity.requesterId,
      vendorMessageVendorId: identity.secondaryVendorId,
      auditRequesterId: identity.requesterId,
      auditOwnerId: identity.adminId,
      auditNote: `owner=${legacyIdentity.adminId}`,
      templateDepartmentId: identity.departmentId,
      settingOrganizationId: identity.organizationId,
      settingValue: `owner=${legacyIdentity.adminId}`,
    });
    assert.equal(
      identity.vendorNote,
      `Keep ${legacyIdentity.organizationId} as literal vendor copy.`,
    );

    const immutableGraph = await database.query<{
      messageOrganizationId: string;
      messageVendorId: string;
      attachmentOrganizationId: string;
      attachmentMessageId: string;
      attachmentItemId: string;
      itemOrganizationId: string;
      definitionOrganizationId: string;
      definitionEntityId: string;
      definitionCreatedBy: string;
      definitionPublishedVersionId: string;
      definitionDraftResolverUserId: string;
      definitionDraftFallbackUserId: string;
      definitionDraftEscalationUserId: string;
      versionOrganizationId: string;
      versionDefinitionId: string;
      versionPublishedBy: string;
      versionGraphResolverUserId: string;
      versionGraphFallbackUserId: string;
      versionGraphEscalationUserId: string;
      versionExecutableResolverUserId: string;
      versionExecutableFallbackUserId: string;
      versionExecutableEscalationUserId: string;
      requestOrganizationId: string;
      requestVersionId: string;
      requestInitiatedBy: string;
      assignmentOrganizationId: string;
      assignmentResolvedApproverId: string;
      assignmentAssignedApproverId: string;
      publicationOrganizationId: string;
    }>(`
      SELECT
        message.organization_id AS "messageOrganizationId",
        message.vendor_id AS "messageVendorId",
        attachment.organization_id AS "attachmentOrganizationId",
        attachment.message_id AS "attachmentMessageId",
        attachment.email_intake_item_id AS "attachmentItemId",
        item.organization_id AS "itemOrganizationId",
        definition.organization_id AS "definitionOrganizationId",
        definition.entity_id AS "definitionEntityId",
        definition.created_by AS "definitionCreatedBy",
        definition.published_version_id AS "definitionPublishedVersionId",
        definition.current_draft #>> '{graph,nodes,0,config,resolvers,0,userId}' AS "definitionDraftResolverUserId",
        definition.current_draft #>> '{graph,nodes,0,config,separationOfDuties,fallbackResolvers,0,userId}' AS "definitionDraftFallbackUserId",
        definition.current_draft #>> '{graph,nodes,1,config,action,resolvers,0,userId}' AS "definitionDraftEscalationUserId",
        version.organization_id AS "versionOrganizationId",
        version.definition_id AS "versionDefinitionId",
        version.published_by AS "versionPublishedBy",
        version.graph_json #>> '{nodes,0,config,resolvers,0,userId}' AS "versionGraphResolverUserId",
        version.graph_json #>> '{nodes,0,config,separationOfDuties,fallbackResolvers,0,userId}' AS "versionGraphFallbackUserId",
        version.graph_json #>> '{nodes,1,config,action,resolvers,0,userId}' AS "versionGraphEscalationUserId",
        version.executable_json #>> '{steps,0,node,config,resolvers,0,userId}' AS "versionExecutableResolverUserId",
        version.executable_json #>> '{steps,0,node,config,separationOfDuties,fallbackResolvers,0,userId}' AS "versionExecutableFallbackUserId",
        version.executable_json #>> '{steps,1,node,config,action,resolvers,0,userId}' AS "versionExecutableEscalationUserId",
        request.organization_id AS "requestOrganizationId",
        request.definition_version_id AS "requestVersionId",
        request.initiated_by AS "requestInitiatedBy",
        assignment.organization_id AS "assignmentOrganizationId",
        assignment.resolved_approver_id AS "assignmentResolvedApproverId",
        assignment.assigned_approver_id AS "assignmentAssignedApproverId",
        publication.organization_id AS "publicationOrganizationId"
      FROM email_intake_messages AS message
      JOIN email_intake_attachments AS attachment ON attachment.message_id = message.id
      JOIN email_intake_items AS item ON item.id = attachment.email_intake_item_id
      CROSS JOIN workflow_definitions AS definition
      JOIN workflow_definition_versions AS version ON version.definition_id = definition.id
      JOIN approval_requests AS request ON request.definition_version_id = version.id
      JOIN workflow_approval_assignments AS assignment ON assignment.approval_request_id = request.id
      JOIN workflow_runtime_publications AS publication ON publication.approval_request_id = request.id
      WHERE message.id = '${migrationWorkload.emailMessageId}'
        AND definition.id = '${migrationWorkload.workflowDefinitionId}'
    `);
    assert.deepEqual(immutableGraph.rows[0], {
      messageOrganizationId: identity.organizationId,
      messageVendorId: identity.primaryVendorId,
      attachmentOrganizationId: identity.organizationId,
      attachmentMessageId: migrationWorkload.emailMessageId,
      attachmentItemId: migrationWorkload.emailItemId,
      itemOrganizationId: identity.organizationId,
      definitionOrganizationId: identity.organizationId,
      definitionEntityId: identity.entityId,
      definitionCreatedBy: identity.adminId,
      definitionPublishedVersionId: migrationWorkload.workflowVersionId,
      definitionDraftResolverUserId: identity.adminId,
      definitionDraftFallbackUserId: identity.requesterId,
      definitionDraftEscalationUserId: identity.approverId,
      versionOrganizationId: identity.organizationId,
      versionDefinitionId: migrationWorkload.workflowDefinitionId,
      versionPublishedBy: identity.adminId,
      versionGraphResolverUserId: identity.adminId,
      versionGraphFallbackUserId: identity.requesterId,
      versionGraphEscalationUserId: identity.approverId,
      versionExecutableResolverUserId: identity.adminId,
      versionExecutableFallbackUserId: identity.requesterId,
      versionExecutableEscalationUserId: identity.approverId,
      requestOrganizationId: identity.organizationId,
      requestVersionId: migrationWorkload.workflowVersionId,
      requestInitiatedBy: identity.adminId,
      assignmentOrganizationId: identity.organizationId,
      assignmentResolvedApproverId: identity.adminId,
      assignmentAssignedApproverId: identity.requesterId,
      publicationOrganizationId: identity.organizationId,
    });

    const syncGraph = await database.query<{
      connectionOrganizationId: string;
      connectionUserId: string;
      syncOrganizationId: string;
      syncConnectionId: string;
    }>(`
      SELECT
        connection.organization_id AS "connectionOrganizationId",
        connection.connected_by_user_id AS "connectionUserId",
        sync.organization_id AS "syncOrganizationId",
        sync.connection_id AS "syncConnectionId"
      FROM integration_connections AS connection
      JOIN sync_records AS sync ON sync.connection_id = connection.id
      WHERE connection.id = '${migrationWorkload.integrationConnectionId}'
    `);
    assert.deepEqual(syncGraph.rows[0], {
      connectionOrganizationId: identity.organizationId,
      connectionUserId: identity.adminId,
      syncOrganizationId: identity.organizationId,
      syncConnectionId: migrationWorkload.integrationConnectionId,
    });

    const commitmentParents = await database.query<{
      budgetOrganizationId: string;
      budgetEntityId: string;
      budgetScopeId: string;
      purchaseOrderOrganizationId: string;
      purchaseOrderEntityId: string;
      purchaseOrderVendorId: string;
      purchaseOrderIssuedBy: string;
      invoiceOrganizationId: string;
      invoiceEntityId: string;
      invoicePurchaseOrderId: string;
      invoiceVendorId: string;
      invoiceCreatedBy: string;
    }>(`
      SELECT
        budget.organization_id AS "budgetOrganizationId",
        budget.entity_id AS "budgetEntityId",
        budget.scope_id AS "budgetScopeId",
        purchase_order.organization_id AS "purchaseOrderOrganizationId",
        purchase_order.entity_id AS "purchaseOrderEntityId",
        purchase_order.vendor_id AS "purchaseOrderVendorId",
        purchase_order.issued_by AS "purchaseOrderIssuedBy",
        invoice.organization_id AS "invoiceOrganizationId",
        invoice.entity_id AS "invoiceEntityId",
        invoice.purchase_order_id AS "invoicePurchaseOrderId",
        invoice.vendor_id AS "invoiceVendorId",
        invoice.created_by AS "invoiceCreatedBy"
      FROM budgets AS budget
      CROSS JOIN purchase_orders AS purchase_order
      CROSS JOIN invoices AS invoice
      WHERE budget.id = '${migrationWorkload.budgetId}'
        AND purchase_order.id = '${migrationWorkload.purchaseOrderId}'
        AND invoice.id = '${migrationWorkload.invoiceId}'
    `);
    assert.deepEqual(commitmentParents.rows[0], {
      budgetOrganizationId: identity.organizationId,
      budgetEntityId: identity.entityId,
      budgetScopeId: identity.departmentId,
      purchaseOrderOrganizationId: identity.organizationId,
      purchaseOrderEntityId: identity.entityId,
      purchaseOrderVendorId: identity.primaryVendorId,
      purchaseOrderIssuedBy: identity.adminId,
      invoiceOrganizationId: identity.organizationId,
      invoiceEntityId: identity.entityId,
      invoicePurchaseOrderId: migrationWorkload.purchaseOrderId,
      invoiceVendorId: identity.primaryVendorId,
      invoiceCreatedBy: identity.adminId,
    });

    const commitmentEvents = await database.query<{
      id: string;
      organizationId: string;
      budgetId: string;
      requisitionId: string | null;
      purchaseOrderId: string | null;
      invoiceId: string | null;
    }>(`
      SELECT
        id,
        organization_id AS "organizationId",
        budget_id AS "budgetId",
        requisition_id AS "requisitionId",
        purchase_order_id AS "purchaseOrderId",
        invoice_id AS "invoiceId"
      FROM budget_commitment_events
      WHERE id IN (
        '${migrationWorkload.budgetEventBudgetId}',
        '${migrationWorkload.budgetEventRequisitionId}',
        '${migrationWorkload.budgetEventPurchaseOrderId}',
        '${migrationWorkload.budgetEventInvoiceId}'
      )
      ORDER BY id
    `);
    assert.deepEqual(commitmentEvents.rows, [
      {
        id: migrationWorkload.budgetEventBudgetId,
        organizationId: identity.organizationId,
        budgetId: migrationWorkload.budgetId,
        requisitionId: null,
        purchaseOrderId: null,
        invoiceId: null,
      },
      {
        id: migrationWorkload.budgetEventRequisitionId,
        organizationId: identity.organizationId,
        budgetId: migrationWorkload.budgetId,
        requisitionId: requisition.id,
        purchaseOrderId: null,
        invoiceId: null,
      },
      {
        id: migrationWorkload.budgetEventPurchaseOrderId,
        organizationId: identity.organizationId,
        budgetId: migrationWorkload.budgetId,
        requisitionId: null,
        purchaseOrderId: migrationWorkload.purchaseOrderId,
        invoiceId: null,
      },
      {
        id: migrationWorkload.budgetEventInvoiceId,
        organizationId: identity.organizationId,
        budgetId: migrationWorkload.budgetId,
        requisitionId: null,
        purchaseOrderId: null,
        invoiceId: migrationWorkload.invoiceId,
      },
    ]);

    const otherOrganizationJson = await database.query<{
      auditOrganizationId: string;
      auditRequesterId: string;
      auditOwnerId: string;
      templateOrganizationId: string;
      templateDepartmentId: string;
    }>(`
      SELECT
        audit.organization_id AS "auditOrganizationId",
        audit.changes ->> 'requesterId' AS "auditRequesterId",
        audit.metadata ->> 'ownerId' AS "auditOwnerId",
        template.organization_id AS "templateOrganizationId",
        template.template_data ->> 'departmentId' AS "templateDepartmentId"
      FROM audit_log AS audit
      JOIN requisition_templates AS template ON template.name = 'Other organization template'
      WHERE audit.entity_id = '${migrationWorkload.otherAuditEntityId}'
    `);
    assert.deepEqual(otherOrganizationJson.rows[0], {
      auditOrganizationId: migrationWorkload.otherOrganizationId,
      auditRequesterId: legacyIdentity.requesterId,
      auditOwnerId: legacyIdentity.adminId,
      templateOrganizationId: migrationWorkload.otherOrganizationId,
      templateDepartmentId: legacyIdentity.engineeringDepartmentId,
    });

    const otherWorkflowJson = await database.query<{
      draftResolverUserId: string;
      graphResolverUserId: string;
      executableResolverUserId: string;
    }>(`
      SELECT
        definition.current_draft #>> '{graph,nodes,0,config,resolvers,0,userId}' AS "draftResolverUserId",
        version.graph_json #>> '{nodes,0,config,resolvers,0,userId}' AS "graphResolverUserId",
        version.executable_json #>> '{steps,0,node,config,resolvers,0,userId}' AS "executableResolverUserId"
      FROM workflow_definitions AS definition
      JOIN workflow_definition_versions AS version ON version.definition_id = definition.id
      WHERE definition.id = '${migrationWorkload.otherWorkflowDefinitionId}'
    `);
    assert.deepEqual(otherWorkflowJson.rows[0], {
      draftResolverUserId: legacyIdentity.adminId,
      graphResolverUserId: legacyIdentity.adminId,
      executableResolverUserId: legacyIdentity.adminId,
    });

    await assert.rejects(
      () =>
        database.query(`UPDATE email_intake_messages SET subject = 'mutated' WHERE id = $1`, [
          migrationWorkload.emailMessageId,
        ]),
      /email_intake_messages is append-only/,
    );
    await assert.rejects(
      () =>
        database.query(`UPDATE workflow_definition_versions SET version = 2 WHERE id = $1`, [
          migrationWorkload.workflowVersionId,
        ]),
      /workflow definition versions are immutable/,
    );

    const constraintDeferrability = await database.query<{
      conname: string;
      condeferrable: boolean;
    }>(`
      SELECT conname, condeferrable
      FROM pg_constraint
      WHERE conname IN (${temporarilyDeferredConstraints.map((name) => `'${name}'`).join(', ')})
      ORDER BY conname
    `);
    assert.deepEqual(
      constraintDeferrability.rows,
      [...temporarilyDeferredConstraints]
        .sort()
        .map((conname) => ({ conname, condeferrable: false })),
    );

    const oldRowCounts = await database.query<{ count: string }>(`
      SELECT (
        (SELECT count(*) FROM organizations WHERE id = '${legacyIdentity.organizationId}')
        + (SELECT count(*) FROM legal_entities WHERE id = '${legacyIdentity.parentEntityId}')
        + (SELECT count(*) FROM departments WHERE id IN ('${legacyIdentity.engineeringDepartmentId}', '${legacyIdentity.marketingDepartmentId}'))
        + (SELECT count(*) FROM users WHERE id IN ('${legacyIdentity.adminId}', '${legacyIdentity.requesterId}', '${legacyIdentity.approverId}'))
        + (SELECT count(*) FROM user_roles WHERE user_id IN ('${legacyIdentity.adminId}', '${legacyIdentity.requesterId}', '${legacyIdentity.approverId}'))
        + (SELECT count(*) FROM vendors WHERE id IN ('${legacyIdentity.vendorIds[0]}', '${legacyIdentity.vendorIds[1]}'))
      )::text AS count
    `);
    assert.equal(oldRowCounts.rows[0]?.count, '0');

    const staleReferenceCounts = await database.query<{ count: string }>(`
      SELECT (
        (SELECT count(*) FROM requisitions
         WHERE organization_id = '${legacyIdentity.organizationId}'
            OR requester_id IN ('${legacyIdentity.requesterId}', '${legacyIdentity.adminId}', '${legacyIdentity.approverId}')
            OR department_id IN ('${legacyIdentity.engineeringDepartmentId}', '${legacyIdentity.marketingDepartmentId}'))
        + (SELECT count(*) FROM requisition_lines
           WHERE vendor_id IN ('${legacyIdentity.vendorIds[0]}', '${legacyIdentity.vendorIds[1]}'))
        + (SELECT count(*) FROM messages
           WHERE organization_id = '${legacyIdentity.organizationId}'
              OR sender_id IN ('${legacyIdentity.requesterId}', '${legacyIdentity.adminId}', '${legacyIdentity.approverId}')
              OR vendor_id IN ('${legacyIdentity.vendorIds[0]}', '${legacyIdentity.vendorIds[1]}')
              OR recipient_vendor_id IN ('${legacyIdentity.vendorIds[0]}', '${legacyIdentity.vendorIds[1]}'))
        + (SELECT count(*) FROM audit_log
           WHERE organization_id = '${legacyIdentity.organizationId}'
              OR (
                organization_id = '${identity.organizationId}'
                AND (
                  user_id IN ('${legacyIdentity.requesterId}', '${legacyIdentity.adminId}', '${legacyIdentity.approverId}')
                  OR changes ->> 'requesterId' = '${legacyIdentity.requesterId}'
                  OR metadata ->> 'ownerId' = '${legacyIdentity.adminId}'
                )
              ))
        + (SELECT count(*) FROM requisition_templates
           WHERE organization_id = '${legacyIdentity.organizationId}'
              OR (
                organization_id = '${identity.organizationId}'
                AND (
                  created_by_id = '${legacyIdentity.adminId}'
                  OR template_data ->> 'departmentId' = '${legacyIdentity.engineeringDepartmentId}'
                )
              ))
        + (SELECT count(*) FROM system_settings
           WHERE organization_id = '${legacyIdentity.organizationId}')
        + (SELECT count(*) FROM email_intake_items
           WHERE organization_id = '${legacyIdentity.organizationId}')
        + (SELECT count(*) FROM email_intake_messages
           WHERE organization_id = '${legacyIdentity.organizationId}'
              OR vendor_id IN ('${legacyIdentity.vendorIds[0]}', '${legacyIdentity.vendorIds[1]}'))
        + (SELECT count(*) FROM email_intake_attachments
           WHERE organization_id = '${legacyIdentity.organizationId}')
        + (SELECT count(*) FROM integration_connections
           WHERE organization_id = '${legacyIdentity.organizationId}'
              OR connected_by_user_id IN ('${legacyIdentity.requesterId}', '${legacyIdentity.adminId}', '${legacyIdentity.approverId}'))
        + (SELECT count(*) FROM sync_records
           WHERE organization_id = '${legacyIdentity.organizationId}')
        + (SELECT count(*) FROM budgets
           WHERE organization_id = '${legacyIdentity.organizationId}'
              OR entity_id = '${legacyIdentity.parentEntityId}'
              OR scope_id IN ('${legacyIdentity.engineeringDepartmentId}', '${legacyIdentity.marketingDepartmentId}'))
        + (SELECT count(*) FROM purchase_orders
           WHERE organization_id = '${legacyIdentity.organizationId}'
              OR entity_id = '${legacyIdentity.parentEntityId}'
              OR vendor_id IN ('${legacyIdentity.vendorIds[0]}', '${legacyIdentity.vendorIds[1]}')
              OR issued_by IN ('${legacyIdentity.requesterId}', '${legacyIdentity.adminId}', '${legacyIdentity.approverId}'))
        + (SELECT count(*) FROM invoices
           WHERE organization_id = '${legacyIdentity.organizationId}'
              OR entity_id = '${legacyIdentity.parentEntityId}'
              OR vendor_id IN ('${legacyIdentity.vendorIds[0]}', '${legacyIdentity.vendorIds[1]}')
              OR created_by IN ('${legacyIdentity.requesterId}', '${legacyIdentity.adminId}', '${legacyIdentity.approverId}'))
        + (SELECT count(*) FROM budget_commitment_events
           WHERE organization_id = '${legacyIdentity.organizationId}')
        + (SELECT count(*) FROM workflow_definitions
           WHERE organization_id = '${legacyIdentity.organizationId}'
              OR entity_id = '${legacyIdentity.parentEntityId}'
              OR created_by IN ('${legacyIdentity.adminId}', '${legacyIdentity.requesterId}', '${legacyIdentity.approverId}')
              OR updated_by IN ('${legacyIdentity.adminId}', '${legacyIdentity.requesterId}', '${legacyIdentity.approverId}'))
        + (SELECT count(*) FROM workflow_definition_versions
           WHERE organization_id = '${legacyIdentity.organizationId}'
              OR published_by IN ('${legacyIdentity.adminId}', '${legacyIdentity.requesterId}', '${legacyIdentity.approverId}'))
        + (SELECT count(*) FROM approval_requests
           WHERE organization_id = '${legacyIdentity.organizationId}'
              OR initiated_by IN ('${legacyIdentity.adminId}', '${legacyIdentity.requesterId}', '${legacyIdentity.approverId}'))
        + (SELECT count(*) FROM workflow_approval_assignments
           WHERE organization_id = '${legacyIdentity.organizationId}'
              OR resolved_approver_id IN ('${legacyIdentity.adminId}', '${legacyIdentity.requesterId}', '${legacyIdentity.approverId}')
              OR assigned_approver_id IN ('${legacyIdentity.adminId}', '${legacyIdentity.requesterId}', '${legacyIdentity.approverId}')
              OR acted_by IN ('${legacyIdentity.adminId}', '${legacyIdentity.requesterId}', '${legacyIdentity.approverId}'))
        + (SELECT count(*) FROM workflow_runtime_publications
           WHERE organization_id = '${legacyIdentity.organizationId}')
      )::text AS count
    `);
    assert.equal(staleReferenceCounts.rows[0]?.count, '0');

    await database.exec(migration);
  } finally {
    await database.close();
  }
});

function assertHasValue(value: string | undefined): string {
  assert.ok(value);
  return value;
}
