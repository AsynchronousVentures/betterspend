import { createHash } from 'node:crypto';
import type { DbTransaction } from './client';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { departments, legalEntities, organizations, userRoles, users, vendors } from './schema';

/** Stable natural keys for the small Acme fixture and demo-mode identity. */
export const DEMO_ORGANIZATION_SLUG = 'acme-corp';
export const DEMO_ADMIN_EMAIL = 'admin@acme.com';
export const DEMO_REQUESTER_EMAIL = 'requester@acme.com';
export const DEMO_APPROVER_EMAIL = 'approver@acme.com';
export const DEMO_ENGINEERING_DEPARTMENT_CODE = 'ENG';
export const DEMO_MARKETING_DEPARTMENT_CODE = 'MKT';
export const DEMO_PARENT_ENTITY_CODE = 'ACME-HQ';

export interface DemoIdentity {
  organizationId: string;
  adminId: string;
  requesterId: string;
  approverId: string;
  engineeringDepartmentId: string;
  marketingDepartmentId: string;
  parentEntityId: string;
  vendorIds: readonly [string, string];
}

/**
 * Pure generators need an identity context before a database exists. These
 * deterministic UUIDs are only a default for those generators and tests;
 * persisted demo rows resolve their IDs from natural keys below.
 */
function deterministicFixtureUuid(kind: string, index: number): string {
  const digest = createHash('sha256')
    .update(`betterspend-demo-fixture\0${kind}\0${index}`)
    .digest('hex');
  const variant = ['8', '9', 'a', 'b'][Number.parseInt(digest[16] ?? '8', 16) % 4];
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-${variant}${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

export const DEMO_TEST_IDENTITY: DemoIdentity = {
  organizationId: deterministicFixtureUuid('organization', 0),
  adminId: deterministicFixtureUuid('user', 0),
  requesterId: deterministicFixtureUuid('user', 1),
  approverId: deterministicFixtureUuid('user', 2),
  engineeringDepartmentId: deterministicFixtureUuid('department', 0),
  marketingDepartmentId: deterministicFixtureUuid('department', 1),
  parentEntityId: deterministicFixtureUuid('entity', 0),
  vendorIds: [deterministicFixtureUuid('vendor', 0), deterministicFixtureUuid('vendor', 1)],
};

/** Compatibility aliases for the in-memory random-seed test context. */
export const DEMO_ORG_ID = DEMO_TEST_IDENTITY.organizationId;
export const DEMO_ADMIN_ID = DEMO_TEST_IDENTITY.adminId;
export const DEMO_REQUESTER_ID = DEMO_TEST_IDENTITY.requesterId;
export const DEMO_APPROVER_ID = DEMO_TEST_IDENTITY.approverId;
export const DEMO_ENG_DEPT_ID = DEMO_TEST_IDENTITY.engineeringDepartmentId;
export const DEMO_MKT_DEPT_ID = DEMO_TEST_IDENTITY.marketingDepartmentId;
export const DEMO_PARENT_ENTITY_ID = DEMO_TEST_IDENTITY.parentEntityId;
export const DEMO_VENDOR_IDS = DEMO_TEST_IDENTITY.vendorIds;

type DemoUserRoleFixture = Omit<typeof userRoles.$inferInsert, 'id'> & { id?: string };
type DemoVendorFixture = Omit<typeof vendors.$inferInsert, 'id'> & { id?: string };
type DemoIdentityWithoutVendors = Omit<DemoIdentity, 'vendorIds'>;

function demoUserRoleFixtures(
  identity: Pick<DemoIdentity, 'organizationId' | 'adminId' | 'requesterId' | 'approverId'>,
): DemoUserRoleFixture[] {
  return [
    {
      userId: identity.adminId,
      organizationId: identity.organizationId,
      role: 'admin',
      customRoleId: null,
      scopeType: 'global',
      scopeId: null,
    },
    {
      userId: identity.requesterId,
      organizationId: identity.organizationId,
      role: 'requester',
      customRoleId: null,
      scopeType: 'global',
      scopeId: null,
    },
    {
      userId: identity.approverId,
      organizationId: identity.organizationId,
      role: 'approver',
      customRoleId: null,
      scopeType: 'global',
      scopeId: null,
    },
  ];
}

function demoVendorFixtures(
  identity: Pick<DemoIdentity, 'organizationId' | 'parentEntityId'>,
): DemoVendorFixture[] {
  return [
    {
      organizationId: identity.organizationId,
      entityId: identity.parentEntityId,
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
      organizationId: identity.organizationId,
      entityId: identity.parentEntityId,
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
}

/** Default context retained for pure random-seed tests, never for API lookup. */
export const DEMO_USER_ROLE_FIXTURES: DemoUserRoleFixture[] = demoUserRoleFixtures(
  DEMO_TEST_IDENTITY,
).map((fixture, index) => ({
  ...fixture,
  id: deterministicFixtureUuid('user-role', index),
}));

export const DEMO_VENDOR_FIXTURES: DemoVendorFixture[] = demoVendorFixtures(DEMO_TEST_IDENTITY).map(
  (fixture, index) => ({
    ...fixture,
    id: DEMO_TEST_IDENTITY.vendorIds[index] as string,
  }),
);

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

async function reconcileDemoUserRoles(
  tx: DbTransaction,
  identity: Pick<DemoIdentity, 'organizationId' | 'adminId' | 'requesterId' | 'approverId'>,
): Promise<void> {
  const fixtures = demoUserRoleFixtures(identity);
  const existing = await tx
    .select()
    .from(userRoles)
    .where(
      and(
        eq(userRoles.organizationId, identity.organizationId),
        inArray(userRoles.userId, fixtures.map((fixture) => fixture.userId)),
      ),
    );

  for (const fixture of fixtures) {
    if (existing.some((row) => demoUserRoleNaturalKey(row) === demoUserRoleNaturalKey(fixture))) {
      continue;
    }
    await tx.insert(userRoles).values(fixture);
  }
}

async function reconcileDemoVendors(
  tx: DbTransaction,
  identity: Pick<DemoIdentity, 'organizationId' | 'parentEntityId'>,
): Promise<[string, string]> {
  const existing = await tx
    .select({
      id: vendors.id,
      organizationId: vendors.organizationId,
      code: vendors.code,
      name: vendors.name,
    })
    .from(vendors)
    .where(eq(vendors.organizationId, identity.organizationId));
  const retainedIds: string[] = [];
  for (const fixture of demoVendorFixtures(identity)) {
    if (!fixture.organizationId || !fixture.code) continue;
    const naturalKey = demoVendorNaturalKey(fixture);
    const matching = existing.filter((row) => demoVendorNaturalKey(row) === naturalKey);
    const [retained] = matching;
    if (retained) {
      retainedIds.push(retained.id);
    } else {
      const [inserted] = await tx.insert(vendors).values(fixture).returning({ id: vendors.id });
      if (!inserted) throw new Error(`Failed to insert demo vendor ${fixture.code}`);
      retainedIds.push(inserted.id);
    }
  }
  const [firstVendorId, secondVendorId] = retainedIds;
  if (!firstVendorId || !secondVendorId) throw new Error('Failed to resolve all Acme demo vendors');
  return [firstVendorId, secondVendorId];
}

/**
 * Resolve or insert the records used by demo-mode requests through stable
 * natural keys. Primary keys are always returned by PostgreSQL, so rerunning
 * the seed preserves identities without hardcoded IDs.
 */
export async function upsertDemoFixtures(tx: DbTransaction): Promise<DemoIdentity> {
  const [existingOrganization] = await tx
    .select()
    .from(organizations)
    .where(eq(organizations.slug, DEMO_ORGANIZATION_SLUG))
    .limit(1);
  const [organization] = existingOrganization
    ? await tx
        .update(organizations)
        .set({
          name: 'Acme Corp',
          baseCurrency: 'USD',
          settings: { currency: 'USD', fiscalYearStart: 1 },
          logoUrl: null,
          updatedAt: new Date(),
        })
        .where(eq(organizations.id, existingOrganization.id))
        .returning()
    : await tx
        .insert(organizations)
        .values({
          name: 'Acme Corp',
          slug: DEMO_ORGANIZATION_SLUG,
          baseCurrency: 'USD',
          settings: { currency: 'USD', fiscalYearStart: 1 },
          logoUrl: null,
        })
        .returning();
  if (!organization) throw new Error('Failed to resolve the Acme demo organization');
  const organizationId = organization.id;

  const [existingEntity] = await tx
    .select()
    .from(legalEntities)
    .where(
      and(
        eq(legalEntities.organizationId, organizationId),
        eq(legalEntities.code, DEMO_PARENT_ENTITY_CODE),
      ),
    )
    .limit(1);
  const [parentEntity] = existingEntity
    ? await tx
        .update(legalEntities)
        .set({
          name: 'Acme Holdings',
          currency: 'USD',
          glAccountPrefix: '100',
          address: {},
          taxId: '99-9999999',
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(legalEntities.id, existingEntity.id))
        .returning()
    : await tx
        .insert(legalEntities)
        .values({
          organizationId,
          name: 'Acme Holdings',
          code: DEMO_PARENT_ENTITY_CODE,
          currency: 'USD',
          glAccountPrefix: '100',
          address: {},
          taxId: '99-9999999',
          isActive: true,
        })
        .returning();
  if (!parentEntity) throw new Error('Failed to resolve the Acme demo entity');

  async function upsertDepartment(name: string, code: string) {
    const [existing] = await tx
      .select()
      .from(departments)
      .where(and(eq(departments.organizationId, organizationId), eq(departments.code, code)))
      .limit(1);
    const [department] = existing
      ? await tx
          .update(departments)
          .set({ name, parentId: null, budgetOwnerId: null, updatedAt: new Date() })
          .where(eq(departments.id, existing.id))
          .returning()
      : await tx
          .insert(departments)
          .values({ organizationId, name, code, parentId: null, budgetOwnerId: null })
          .returning();
    if (!department) throw new Error(`Failed to resolve demo department ${code}`);
    return department;
  }

  const engineeringDepartment = await upsertDepartment(
    'Engineering',
    DEMO_ENGINEERING_DEPARTMENT_CODE,
  );
  const marketingDepartment = await upsertDepartment(
    'Marketing',
    DEMO_MARKETING_DEPARTMENT_CODE,
  );

  async function upsertUser(email: string, name: string) {
    const [existing] = await tx
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`)
      .limit(1);
    if (existing && existing.organizationId !== organizationId) {
      throw new Error(`Demo user ${email} belongs to a different organization`);
    }
    const [user] = existing
      ? await tx
          .update(users)
          .set({
            organizationId,
            email,
            name,
            emailVerified: true,
            image: null,
            departmentId: engineeringDepartment.id,
            managerId: null,
            isActive: true,
            updatedAt: new Date(),
          })
          .where(eq(users.id, existing.id))
          .returning()
      : await tx
          .insert(users)
          .values({
            organizationId,
            email,
            name,
            departmentId: engineeringDepartment.id,
            emailVerified: true,
            image: null,
            managerId: null,
            isActive: true,
          })
          .returning();
    if (!user) throw new Error(`Failed to resolve demo user ${email}`);
    return user;
  }

  const admin = await upsertUser(DEMO_ADMIN_EMAIL, 'Admin User');
  const requester = await upsertUser(DEMO_REQUESTER_EMAIL, 'Jane Requester');
  const approver = await upsertUser(DEMO_APPROVER_EMAIL, 'Bob Approver');
  const identity: DemoIdentityWithoutVendors = {
    organizationId,
    adminId: admin.id,
    requesterId: requester.id,
    approverId: approver.id,
    engineeringDepartmentId: engineeringDepartment.id,
    marketingDepartmentId: marketingDepartment.id,
    parentEntityId: parentEntity.id,
  };

  await reconcileDemoUserRoles(tx, identity);
  const vendorIds = await reconcileDemoVendors(tx, identity);

  const resolvedIdentity: DemoIdentity = {
    ...identity,
    vendorIds,
  };
  const vendorFixtures = demoVendorFixtures(identity);
  for (const [index, fixture] of vendorFixtures.entries()) {
    const vendorId = vendorIds[index];
    if (!vendorId) throw new Error(`Failed to resolve demo vendor ${fixture.code}`);
    const [vendor] = await tx
      .update(vendors)
      .set({
        entityId: fixture.entityId,
        name: fixture.name,
        code: fixture.code,
        taxId: fixture.taxId,
        paymentTerms: fixture.paymentTerms,
        address: fixture.address,
        contactInfo: fixture.contactInfo,
        status: fixture.status,
        onboardingStatus: fixture.onboardingStatus,
        onboardingRiskScore: fixture.onboardingRiskScore,
        onboardingRiskLevel: fixture.onboardingRiskLevel,
        onboardingApprovedAt: fixture.onboardingApprovedAt,
        onboardingLastSubmittedAt: fixture.onboardingLastSubmittedAt,
        punchoutEnabled: fixture.punchoutEnabled,
        punchoutConfig: fixture.punchoutConfig,
        diversityCategories: fixture.diversityCategories,
        esgRating: fixture.esgRating,
        carbonFootprintTons: fixture.carbonFootprintTons,
        sustainabilityCertifications: fixture.sustainabilityCertifications,
        esgNotes: fixture.esgNotes,
        diversityVerifiedAt: fixture.diversityVerifiedAt,
        sanctionsStatus: fixture.sanctionsStatus,
        sanctionsCheckedAt: fixture.sanctionsCheckedAt,
        sanctionsNote: fixture.sanctionsNote,
        updatedAt: new Date(),
      })
      .where(and(eq(vendors.id, vendorId), eq(vendors.organizationId, organizationId)))
      .returning({ id: vendors.id });
    if (!vendor) throw new Error(`Failed to update demo vendor ${fixture.code}`);
  }

  return resolvedIdentity;
}
