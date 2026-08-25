import type { DbTransaction } from './client';
import { sql } from 'drizzle-orm';
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
    .onConflictDoUpdate({
      target: userRoles.id,
      set: {
        userId: sql`excluded.user_id`,
        role: sql`excluded.role`,
        customRoleId: sql`excluded.custom_role_id`,
        scopeType: sql`excluded.scope_type`,
        scopeId: sql`excluded.scope_id`,
      },
    });

  await tx
    .insert(vendors)
    .values([
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
    ])
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
