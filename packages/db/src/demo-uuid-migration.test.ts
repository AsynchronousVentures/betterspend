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
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
        JSON.stringify({}),
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
        JSON.stringify({}),
        JSON.stringify({}),
        JSON.stringify({}),
        legacyIdentity.adminId,
      ],
    );
    await database.query(
      `UPDATE workflow_definitions SET published_version_id = $1 WHERE id = $2`,
      [migrationWorkload.workflowVersionId, migrationWorkload.workflowDefinitionId],
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
        department.id AS "departmentId",
        entity.id AS "entityId",
        primary_vendor.id AS "primaryVendorId",
        secondary_vendor.id AS "secondaryVendorId",
        primary_vendor.esg_notes AS "vendorNote"
      FROM organizations AS organization
      JOIN users AS admin ON admin.organization_id = organization.id AND admin.email = 'admin@acme.com'
      JOIN users AS requester ON requester.organization_id = organization.id AND requester.email = 'requester@acme.com'
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
      versionOrganizationId: string;
      versionDefinitionId: string;
      versionPublishedBy: string;
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
        version.organization_id AS "versionOrganizationId",
        version.definition_id AS "versionDefinitionId",
        version.published_by AS "versionPublishedBy",
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
      versionOrganizationId: identity.organizationId,
      versionDefinitionId: migrationWorkload.workflowDefinitionId,
      versionPublishedBy: identity.adminId,
      requestOrganizationId: identity.organizationId,
      requestVersionId: migrationWorkload.workflowVersionId,
      requestInitiatedBy: identity.adminId,
      assignmentOrganizationId: identity.organizationId,
      assignmentResolvedApproverId: identity.adminId,
      assignmentAssignedApproverId: identity.requesterId,
      publicationOrganizationId: identity.organizationId,
    });

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
