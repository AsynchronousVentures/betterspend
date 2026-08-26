import type { DbTransaction } from './client';
import { eq, inArray, or, sql } from 'drizzle-orm';
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

type DemoUserRoleFixture = typeof userRoles.$inferInsert;
type DemoVendorFixture = typeof vendors.$inferInsert;

export const DEMO_USER_ROLE_FIXTURES: DemoUserRoleFixture[] = [
  {
    id: '00000000-0000-0000-0000-000000000040',
    userId: DEMO_ADMIN_ID,
    organizationId: DEMO_ORG_ID,
    role: 'admin',
    customRoleId: null,
    scopeType: 'global',
    scopeId: null,
  },
  {
    id: '00000000-0000-0000-0000-000000000041',
    userId: DEMO_REQUESTER_ID,
    organizationId: DEMO_ORG_ID,
    role: 'requester',
    customRoleId: null,
    scopeType: 'global',
    scopeId: null,
  },
  {
    id: '00000000-0000-0000-0000-000000000042',
    userId: DEMO_APPROVER_ID,
    organizationId: DEMO_ORG_ID,
    role: 'approver',
    customRoleId: null,
    scopeType: 'global',
    scopeId: null,
  },
];

export const DEMO_VENDOR_FIXTURES: DemoVendorFixture[] = [
  {
    id: DEMO_VENDOR_IDS[0],
    organizationId: DEMO_ORG_ID,
    entityId: DEMO_PARENT_ENTITY_ID,
    name: 'Acme Supplies Inc.',
    code: 'ACME-SUP',
    taxId: null,
    paymentTerms: 'Net 30',
    address: {},
    contactInfo: { email: 'sales@acmesupplies.com', phone: '+1-555-0100' },
    status: 'active',
    onboardingStatus: 'not_started',
    onboardingRiskScore: 0,
    onboardingRiskLevel: 'low',
    onboardingApprovedAt: null,
    onboardingLastSubmittedAt: null,
    punchoutEnabled: false,
    punchoutConfig: null,
    diversityCategories: [],
    esgRating: null,
    carbonFootprintTons: null,
    sustainabilityCertifications: [],
    esgNotes: null,
    diversityVerifiedAt: null,
    sanctionsStatus: 'untested',
    sanctionsCheckedAt: null,
    sanctionsNote: null,
  },
  {
    id: DEMO_VENDOR_IDS[1],
    organizationId: DEMO_ORG_ID,
    entityId: DEMO_PARENT_ENTITY_ID,
    name: 'TechParts Global',
    code: 'TECHPARTS',
    taxId: null,
    paymentTerms: 'Net 60',
    address: {},
    contactInfo: { email: 'orders@techparts.com', phone: '+1-555-0200' },
    status: 'active',
    onboardingStatus: 'not_started',
    onboardingRiskScore: 0,
    onboardingRiskLevel: 'low',
    onboardingApprovedAt: null,
    onboardingLastSubmittedAt: null,
    punchoutEnabled: false,
    punchoutConfig: null,
    diversityCategories: [],
    esgRating: null,
    carbonFootprintTons: null,
    sustainabilityCertifications: [],
    esgNotes: null,
    diversityVerifiedAt: null,
    sanctionsStatus: 'untested',
    sanctionsCheckedAt: null,
    sanctionsNote: null,
  },
];

export function demoUserRoleNaturalKey(
  row: Pick<DemoUserRoleFixture, 'userId' | 'role' | 'customRoleId' | 'scopeType' | 'scopeId'>,
): string {
  return [row.userId, row.role, row.customRoleId ?? '', row.scopeType, row.scopeId ?? ''].join(
    '\0',
  );
}

export function demoVendorNaturalKey(
  row: Pick<DemoVendorFixture, 'organizationId' | 'code' | 'name'>,
): string {
  return [row.organizationId, row.code ?? `name:${row.name}`].join('\0');
}

async function reconcileLegacyDemoUserRoles(tx: DbTransaction): Promise<void> {
  const fixtureIds = DEMO_USER_ROLE_FIXTURES.map((row) => row.id).filter((id): id is string =>
    Boolean(id),
  );
  const fixtureUserIds = DEMO_USER_ROLE_FIXTURES.map((row) => row.userId).filter(
    (id): id is string => Boolean(id),
  );
  const existing = await tx
    .select()
    .from(userRoles)
    .where(or(inArray(userRoles.userId, fixtureUserIds), inArray(userRoles.id, fixtureIds)));
  const existingById = new Map(existing.map((row) => [row.id, row]));

  for (const fixture of DEMO_USER_ROLE_FIXTURES) {
    if (!fixture.id || !fixture.userId) continue;
    const naturalKey = demoUserRoleNaturalKey(fixture);
    const matching = existing.filter(
      (row) => demoUserRoleNaturalKey(row) === naturalKey && row.id !== fixture.id,
    );
    const fixedRow = existingById.get(fixture.id);
    let retainedId = fixedRow?.id;
    if (!retainedId && matching[0]?.id) {
      retainedId = fixture.id;
      await tx
        .update(userRoles)
        .set({
          id: fixture.id,
          userId: fixture.userId,
          organizationId: fixture.organizationId,
          role: fixture.role,
          customRoleId: fixture.customRoleId,
          scopeType: fixture.scopeType,
          scopeId: fixture.scopeId,
        })
        .where(eq(userRoles.id, matching[0].id));
      existingById.delete(matching[0].id);
      existingById.set(fixture.id, { ...matching[0], ...fixture });
    }
    for (const duplicate of matching) {
      if (duplicate.id !== retainedId)
        await tx.delete(userRoles).where(eq(userRoles.id, duplicate.id));
    }
  }
}

/** Move legacy vendor children before removing duplicate random-ID fixtures. */
async function repointLegacyVendorReferences(
  tx: DbTransaction,
  legacyId: string,
  canonicalId: string,
): Promise<void> {
  await tx.execute(
    sql`UPDATE "catalog_items" SET "vendor_id" = ${canonicalId} WHERE "vendor_id" = ${legacyId}`,
  );
  await tx.execute(
    sql`UPDATE "requisition_lines" SET "vendor_id" = ${canonicalId} WHERE "vendor_id" = ${legacyId}`,
  );
  await tx.execute(
    sql`UPDATE "purchase_orders" SET "vendor_id" = ${canonicalId} WHERE "vendor_id" = ${legacyId}`,
  );
  await tx.execute(
    sql`UPDATE "invoices" SET "vendor_id" = ${canonicalId} WHERE "vendor_id" = ${legacyId}`,
  );
  await tx.execute(
    sql`UPDATE "recurring_pos" SET "vendor_id" = ${canonicalId} WHERE "vendor_id" = ${legacyId}`,
  );
  await tx.execute(
    sql`UPDATE "contracts" SET "vendor_id" = ${canonicalId} WHERE "vendor_id" = ${legacyId}`,
  );
  await tx.execute(
    sql`UPDATE "vendor_portal_tokens" SET "vendor_id" = ${canonicalId} WHERE "vendor_id" = ${legacyId}`,
  );
  await tx.execute(
    sql`UPDATE "vendor_portal_sessions" SET "vendor_id" = ${canonicalId} WHERE "vendor_id" = ${legacyId}`,
  );
  await tx.execute(
    sql`UPDATE "rfq_requests" SET "awarded_vendor_id" = ${canonicalId} WHERE "awarded_vendor_id" = ${legacyId}`,
  );
  await tx.execute(
    sql`UPDATE "rfq_invitations" SET "vendor_id" = ${canonicalId} WHERE "vendor_id" = ${legacyId}`,
  );
  await tx.execute(
    sql`UPDATE "rfq_responses" SET "vendor_id" = ${canonicalId} WHERE "vendor_id" = ${legacyId}`,
  );
  await tx.execute(
    sql`UPDATE "software_licenses" SET "vendor_id" = ${canonicalId} WHERE "vendor_id" = ${legacyId}`,
  );
  await tx.execute(
    sql`UPDATE "catalog_price_proposals" SET "vendor_id" = ${canonicalId} WHERE "vendor_id" = ${legacyId}`,
  );
  await tx.execute(
    sql`UPDATE "vendor_onboarding_submissions" SET "vendor_id" = ${canonicalId} WHERE "vendor_id" = ${legacyId}`,
  );
  await tx.execute(
    sql`UPDATE "messages" SET "vendor_id" = ${canonicalId} WHERE "vendor_id" = ${legacyId}`,
  );
  await tx.execute(
    sql`UPDATE "messages" SET "recipient_vendor_id" = ${canonicalId} WHERE "recipient_vendor_id" = ${legacyId}`,
  );
  await tx.execute(
    sql`UPDATE "sanctions_screenings" SET "vendor_id" = ${canonicalId} WHERE "vendor_id" = ${legacyId}`,
  );
  await tx.execute(
    sql`UPDATE "vendor_payment_accounts" SET "vendor_id" = ${canonicalId} WHERE "vendor_id" = ${legacyId}`,
  );
  await tx.execute(
    sql`UPDATE "vendor_virtual_cards" SET "vendor_id" = ${canonicalId} WHERE "vendor_id" = ${legacyId}`,
  );
  await tx.execute(
    sql`UPDATE "email_intake_messages" SET "vendor_id" = ${canonicalId} WHERE "vendor_id" = ${legacyId}`,
  );
}

async function reconcileLegacyDemoVendors(tx: DbTransaction): Promise<void> {
  const existing = await tx
    .select({
      id: vendors.id,
      organizationId: vendors.organizationId,
      code: vendors.code,
      name: vendors.name,
    })
    .from(vendors)
    .where(eq(vendors.organizationId, DEMO_ORG_ID));
  for (const fixture of DEMO_VENDOR_FIXTURES) {
    if (!fixture.id || !fixture.organizationId || !fixture.code) continue;
    const naturalKey = demoVendorNaturalKey(fixture);
    const legacyRows = existing.filter(
      (row) => row.id !== fixture.id && demoVendorNaturalKey(row) === naturalKey,
    );
    if (legacyRows.length === 0) continue;
    await tx.insert(vendors).values(fixture).onConflictDoNothing();
    for (const legacy of legacyRows) {
      await repointLegacyVendorReferences(tx, legacy.id, fixture.id);
      await tx.delete(vendors).where(eq(vendors.id, legacy.id));
    }
  }
}

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
      logoUrl: null,
    })
    .onConflictDoUpdate({
      target: organizations.id,
      set: {
        name: 'Acme Corp',
        slug: 'acme-corp',
        baseCurrency: 'USD',
        settings: { currency: 'USD', fiscalYearStart: 1 },
        logoUrl: null,
      },
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
      address: {},
      taxId: '99-9999999',
      isActive: true,
    })
    .onConflictDoUpdate({
      target: legalEntities.id,
      set: {
        organizationId: DEMO_ORG_ID,
        name: 'Acme Holdings',
        code: 'ACME-HQ',
        currency: 'USD',
        glAccountPrefix: '100',
        address: {},
        taxId: '99-9999999',
        isActive: true,
      },
    });

  await tx
    .insert(departments)
    .values([
      {
        id: DEMO_ENG_DEPT_ID,
        organizationId: DEMO_ORG_ID,
        name: 'Engineering',
        code: 'ENG',
        parentId: null,
        budgetOwnerId: null,
      },
      {
        id: DEMO_MKT_DEPT_ID,
        organizationId: DEMO_ORG_ID,
        name: 'Marketing',
        code: 'MKT',
        parentId: null,
        budgetOwnerId: null,
      },
    ])
    .onConflictDoUpdate({
      target: departments.id,
      set: {
        organizationId: sql`excluded.organization_id`,
        name: sql`excluded.name`,
        code: sql`excluded.code`,
        parentId: sql`excluded.parent_id`,
        budgetOwnerId: sql`excluded.budget_owner_id`,
      },
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
        image: null,
        managerId: null,
        isActive: true,
      },
      {
        id: DEMO_REQUESTER_ID,
        organizationId: DEMO_ORG_ID,
        email: 'requester@acme.com',
        name: 'Jane Requester',
        departmentId: DEMO_ENG_DEPT_ID,
        emailVerified: true,
        image: null,
        managerId: null,
        isActive: true,
      },
      {
        id: DEMO_APPROVER_ID,
        organizationId: DEMO_ORG_ID,
        email: 'approver@acme.com',
        name: 'Bob Approver',
        departmentId: DEMO_ENG_DEPT_ID,
        emailVerified: true,
        image: null,
        managerId: null,
        isActive: true,
      },
    ])
    .onConflictDoUpdate({
      target: users.id,
      set: {
        organizationId: sql`excluded.organization_id`,
        email: sql`excluded.email`,
        name: sql`excluded.name`,
        emailVerified: sql`excluded.email_verified`,
        image: sql`excluded.image`,
        departmentId: sql`excluded.department_id`,
        managerId: sql`excluded.manager_id`,
        isActive: sql`excluded.is_active`,
      },
    });

  await reconcileLegacyDemoUserRoles(tx);
  await tx
    .insert(userRoles)
    .values(DEMO_USER_ROLE_FIXTURES)
    .onConflictDoUpdate({
      target: userRoles.id,
      set: {
        userId: sql`excluded.user_id`,
        organizationId: sql`excluded.organization_id`,
        role: sql`excluded.role`,
        customRoleId: sql`excluded.custom_role_id`,
        scopeType: sql`excluded.scope_type`,
        scopeId: sql`excluded.scope_id`,
      },
    });

  await reconcileLegacyDemoVendors(tx);
  await tx
    .insert(vendors)
    .values(DEMO_VENDOR_FIXTURES)
    .onConflictDoUpdate({
      target: vendors.id,
      set: {
        organizationId: sql`excluded.organization_id`,
        entityId: sql`excluded.entity_id`,
        name: sql`excluded.name`,
        code: sql`excluded.code`,
        taxId: sql`excluded.tax_id`,
        paymentTerms: sql`excluded.payment_terms`,
        address: sql`excluded.address`,
        contactInfo: sql`excluded.contact_info`,
        status: sql`excluded.status`,
        onboardingStatus: sql`excluded.onboarding_status`,
        onboardingRiskScore: sql`excluded.onboarding_risk_score`,
        onboardingRiskLevel: sql`excluded.onboarding_risk_level`,
        onboardingApprovedAt: sql`excluded.onboarding_approved_at`,
        onboardingLastSubmittedAt: sql`excluded.onboarding_last_submitted_at`,
        punchoutEnabled: sql`excluded.punchout_enabled`,
        punchoutConfig: sql`excluded.punchout_config`,
        diversityCategories: sql`excluded.diversity_categories`,
        esgRating: sql`excluded.esg_rating`,
        carbonFootprintTons: sql`excluded.carbon_footprint_tons`,
        sustainabilityCertifications: sql`excluded.sustainability_certifications`,
        esgNotes: sql`excluded.esg_notes`,
        diversityVerifiedAt: sql`excluded.diversity_verified_at`,
        sanctionsStatus: sql`excluded.sanctions_status`,
        sanctionsCheckedAt: sql`excluded.sanctions_checked_at`,
        sanctionsNote: sql`excluded.sanctions_note`,
      },
    });
}
