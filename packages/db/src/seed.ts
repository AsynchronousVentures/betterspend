import { db } from './client';
import { organizations, legalEntities, departments, users, userRoles, vendors } from './schema';
import { sql } from 'drizzle-orm';

// Fixed UUIDs so demo controllers (DEMO_ORG_ID, DEMO_USER_ID) align with seeded data
const DEMO_ORG_ID = '00000000-0000-0000-0000-000000000001';
const DEMO_ADMIN_ID = '00000000-0000-0000-0000-000000000002';
const DEMO_REQUESTER_ID = '00000000-0000-0000-0000-000000000003';
const DEMO_APPROVER_ID = '00000000-0000-0000-0000-000000000004';
const DEMO_ENG_DEPT_ID = '00000000-0000-0000-0000-000000000010';
const DEMO_MKT_DEPT_ID = '00000000-0000-0000-0000-000000000011';
const DEMO_PARENT_ENTITY_ID = '00000000-0000-0000-0000-000000000020';

async function seed() {
  console.log('Seeding database...');

  // Clear existing demo data (idempotent re-seed)
  await db.execute(sql`DELETE FROM user_roles WHERE user_id IN (${DEMO_ADMIN_ID}, ${DEMO_REQUESTER_ID}, ${DEMO_APPROVER_ID})`);
  await db.execute(sql`DELETE FROM users WHERE organization_id = ${DEMO_ORG_ID}`);
  await db.execute(sql`DELETE FROM departments WHERE organization_id = ${DEMO_ORG_ID}`);
  await db.execute(sql`DELETE FROM vendors WHERE organization_id = ${DEMO_ORG_ID}`);
  await db.execute(sql`DELETE FROM legal_entities WHERE organization_id = ${DEMO_ORG_ID}`);
  await db.execute(sql`DELETE FROM organizations WHERE id = ${DEMO_ORG_ID}`);

  // Organization
  await db.insert(organizations).values({
    id: DEMO_ORG_ID,
    name: 'Acme Corp',
    slug: 'acme-corp',
    settings: { currency: 'USD', fiscalYearStart: 1 },
  });
  console.log('Created organization: Acme Corp');

  await db.insert(legalEntities).values({
    id: DEMO_PARENT_ENTITY_ID,
    organizationId: DEMO_ORG_ID,
    name: 'Acme Holdings',
    code: 'ACME-HQ',
    currency: 'USD',
    glAccountPrefix: '100',
    taxId: '99-9999999',
  });
  console.log('Created legal entity: Acme Holdings');

  // Departments
  await db.insert(departments).values([
    { id: DEMO_ENG_DEPT_ID, organizationId: DEMO_ORG_ID, name: 'Engineering', code: 'ENG' },
    { id: DEMO_MKT_DEPT_ID, organizationId: DEMO_ORG_ID, name: 'Marketing', code: 'MKT' },
  ]);
  console.log('Created departments: Engineering, Marketing');

  // Users
  await db.insert(users).values([
    { id: DEMO_ADMIN_ID, organizationId: DEMO_ORG_ID, email: 'admin@acme.com', name: 'Admin User', departmentId: DEMO_ENG_DEPT_ID },
    { id: DEMO_REQUESTER_ID, organizationId: DEMO_ORG_ID, email: 'requester@acme.com', name: 'Jane Requester', departmentId: DEMO_ENG_DEPT_ID },
    { id: DEMO_APPROVER_ID, organizationId: DEMO_ORG_ID, email: 'approver@acme.com', name: 'Bob Approver', departmentId: DEMO_ENG_DEPT_ID },
  ]);

  await db.insert(userRoles).values([
    { userId: DEMO_ADMIN_ID, role: 'admin', scopeType: 'global' },
    { userId: DEMO_REQUESTER_ID, role: 'requester', scopeType: 'global' },
    { userId: DEMO_APPROVER_ID, role: 'approver', scopeType: 'global' },
  ]);
  console.log('Created users: admin, requester, approver');

  // Vendors
  await db.insert(vendors).values([
    {
      organizationId: DEMO_ORG_ID,
      entityId: DEMO_PARENT_ENTITY_ID,
      name: 'Acme Supplies Inc.',
      code: 'ACME-SUP',
      paymentTerms: 'Net 30',
      status: 'active',
      contactInfo: { email: 'sales@acmesupplies.com', phone: '+1-555-0100' },
    },
    {
      organizationId: DEMO_ORG_ID,
      entityId: DEMO_PARENT_ENTITY_ID,
      name: 'TechParts Global',
      code: 'TECHPARTS',
      paymentTerms: 'Net 60',
      status: 'active',
      contactInfo: { email: 'orders@techparts.com', phone: '+1-555-0200' },
    },
  ]);
  console.log('Created vendors');

  console.log('Seed complete!');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
