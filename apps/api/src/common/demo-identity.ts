import { and, eq } from 'drizzle-orm';
import {
  DEMO_ADMIN_EMAIL,
  DEMO_ORGANIZATION_SLUG,
  organizations,
  type Db,
  type DbTransaction,
  userRoles,
  users,
} from '@betterspend/db';

type IdentityDatabase = Db | DbTransaction;

export interface DemoRequestIdentity {
  organizationId: string;
  userId: string;
}

/** The only demo identity failure that callers may translate to a 401 response. */
export class MissingDemoIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingDemoIdentityError';
  }
}

/** Resolve the demo request identity from the same natural keys used by seeding. */
export async function resolveDemoIdentity(db: IdentityDatabase): Promise<DemoRequestIdentity> {
  const [organization] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, DEMO_ORGANIZATION_SLUG))
    .limit(1);
  if (!organization) throw new MissingDemoIdentityError('Demo organization is not seeded');

  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.organizationId, organization.id),
        eq(users.email, DEMO_ADMIN_EMAIL),
        eq(users.isActive, true),
      ),
    )
    .limit(1);
  if (!admin) throw new MissingDemoIdentityError('Demo administrator is not seeded');

  return { organizationId: organization.id, userId: admin.id };
}

/** Resolve an active global administrator for notification and system actions. */
export async function resolveOrganizationAdminId(
  db: IdentityDatabase,
  organizationId: string,
): Promise<string | null> {
  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .where(
      and(
        eq(users.organizationId, organizationId),
        eq(users.isActive, true),
        eq(userRoles.organizationId, organizationId),
        eq(userRoles.role, 'admin'),
        eq(userRoles.scopeType, 'global'),
      ),
    )
    .limit(1);
  return admin?.id ?? null;
}
