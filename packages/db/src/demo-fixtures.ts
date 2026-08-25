import type { DbTransaction } from './client';
import { departments, legalEntities, organizations, userRoles, users, vendors } from './schema';

/** IDs used by the demo controllers and the ordinary, small seed. */
export const DEMO_ORG_ID = '00000000-0000-0000-0000-000000000001';
export const DEMO_ADMIN_ID = '00000000-0000-0000-0000-000000000002';
export const DEMO_REQUESTER_ID = '00000000-0000-0000-0000-000000000003';
export const DEMO_APPROVER_ID = '00000000-0000-0000-0000-000000000004';
export const DEMO_ENG_DEPT_ID = '00000000-0000-0000-0000-000000000010';
export const DEMO_MKT_DEPT_ID = '00000000-0000-0000-0000-000000000011';
export const DEMO_PARENT_ENTITY_ID = '00000000-0000-0000-0000-000000000020';
export const DEMO_VENDOR_IDS = [
  '00000000-0000-0000-0000-000000000030',
  '00000000-0000-0000-0000-000000000031',
] as const;

/**
 * Insert the fixed records used by demo-mode requests. This is deliberately
 * an upsert, rather than a delete/reinsert, so it remains safe after a
 * workload seed has added children that point at the demo organization.
 */
export async function upsertDemoFixtures(tx: DbTransaction): Promise<void> {
  await tx
    .insert(organizations)
    .values({
      id: DEMO_ORG_ID,
      name: 'Acme Corp',
      slug: 'acme-corp',
      baseCurrency: 'USD',
      settings: { currency: 'USD', fiscalYearStart: 1 },
    })
    .onConflictDoUpdate({
      target: organizations.id,
      set: { name: 'Acme Corp', slug: 'acme-corp', baseCurrency: 'USD' },
    });

  await tx
    .insert(legalEntities)
    .values({
      id: DEMO_PARENT_ENTITY_ID,
      organizationId: DEMO_ORG_ID,
      name: 'Acme Holdings',
      code: 'ACME-HQ',
      currency: 'USD',
      glAccountPrefix: '100',
      taxId: '99-9999999',
    })
    .onConflictDoUpdate({
      target: legalEntities.id,
      set: { name: 'Acme Holdings', code: 'ACME-HQ', currency: 'USD' },
    });

  await tx
    .insert(departments)
    .values([
      { id: DEMO_ENG_DEPT_ID, organizationId: DEMO_ORG_ID, name: 'Engineering', code: 'ENG' },
      { id: DEMO_MKT_DEPT_ID, organizationId: DEMO_ORG_ID, name: 'Marketing', code: 'MKT' },
    ])
    .onConflictDoUpdate({
      target: departments.id,
      set: { organizationId: DEMO_ORG_ID },
    });

  await tx
    .insert(users)
    .values([
      {
        id: DEMO_ADMIN_ID,
        organizationId: DEMO_ORG_ID,
        email: 'admin@acme.com',
        name: 'Admin User',
        departmentId: DEMO_ENG_DEPT_ID,
        emailVerified: true,
      },
      {
        id: DEMO_REQUESTER_ID,
        organizationId: DEMO_ORG_ID,
        email: 'requester@acme.com',
        name: 'Jane Requester',
        departmentId: DEMO_ENG_DEPT_ID,
        emailVerified: true,
      },
      {
        id: DEMO_APPROVER_ID,
        organizationId: DEMO_ORG_ID,
        email: 'approver@acme.com',
        name: 'Bob Approver',
        departmentId: DEMO_ENG_DEPT_ID,
        emailVerified: true,
      },
    ])
    .onConflictDoUpdate({
      target: users.id,
      set: { organizationId: DEMO_ORG_ID },
    });

  await tx
    .insert(userRoles)
    .values([
      {
        id: '00000000-0000-0000-0000-000000000040',
        userId: DEMO_ADMIN_ID,
        role: 'admin',
        scopeType: 'global',
      },
      {
        id: '00000000-0000-0000-0000-000000000041',
        userId: DEMO_REQUESTER_ID,
        role: 'requester',
        scopeType: 'global',
      },
      {
        id: '00000000-0000-0000-0000-000000000042',
        userId: DEMO_APPROVER_ID,
        role: 'approver',
        scopeType: 'global',
      },
    ])
    .onConflictDoNothing({ target: userRoles.id });

  await tx
    .insert(vendors)
    .values([
      {
        id: DEMO_VENDOR_IDS[0],
        organizationId: DEMO_ORG_ID,
        entityId: DEMO_PARENT_ENTITY_ID,
        name: 'Acme Supplies Inc.',
        code: 'ACME-SUP',
        paymentTerms: 'Net 30',
        status: 'active',
        contactInfo: { email: 'sales@acmesupplies.com', phone: '+1-555-0100' },
      },
      {
        id: DEMO_VENDOR_IDS[1],
        organizationId: DEMO_ORG_ID,
        entityId: DEMO_PARENT_ENTITY_ID,
        name: 'TechParts Global',
        code: 'TECHPARTS',
        paymentTerms: 'Net 60',
        status: 'active',
        contactInfo: { email: 'orders@techparts.com', phone: '+1-555-0200' },
      },
    ])
    .onConflictDoUpdate({
      target: vendors.id,
      set: { organizationId: DEMO_ORG_ID, entityId: DEMO_PARENT_ENTITY_ID },
    });
}
