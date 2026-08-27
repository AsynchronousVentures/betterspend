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
    await database.query(
      `UPDATE audit_log SET metadata = $1 WHERE entity_id = $2`,
      [JSON.stringify({ ownerId: legacyIdentity.adminId }), requisition.id],
    );
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
      templateDepartmentId: identity.departmentId,
      settingOrganizationId: identity.organizationId,
      settingValue: `owner=${legacyIdentity.adminId}`,
    });
    assert.equal(
      identity.vendorNote,
      `Keep ${legacyIdentity.organizationId} as literal vendor copy.`,
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
              OR user_id IN ('${legacyIdentity.requesterId}', '${legacyIdentity.adminId}', '${legacyIdentity.approverId}')
              OR changes::text LIKE '%${legacyIdentity.requesterId}%'
              OR metadata::text LIKE '%${legacyIdentity.adminId}%')
        + (SELECT count(*) FROM requisition_templates
           WHERE organization_id = '${legacyIdentity.organizationId}'
              OR created_by_id = '${legacyIdentity.adminId}'
              OR template_data::text LIKE '%${legacyIdentity.engineeringDepartmentId}%')
        + (SELECT count(*) FROM system_settings
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
