import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { auditLog, authAccounts, organizations, userRoles, users, type Db } from '@betterspend/db';
import type { BootstrapInstanceInput } from '@betterspend/shared';
import { hashCredentialPassword } from '../../auth/credential-password';
import { DB_TOKEN } from '../../database/database.module';

const BOOTSTRAP_LOCK_ID = 0x42534155;

function alreadyInitialized(): ConflictException {
  return new ConflictException(
    'This BetterSpend instance is already initialized. Ask an administrator to create your account.',
  );
}

function organizationSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
  return slug || 'betterspend';
}

@Injectable()
export class BootstrapService {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  async initialize(data: BootstrapInstanceInput) {
    const email = data.email.trim().toLowerCase();
    const [existingAccount] = await this.db
      .select({ id: authAccounts.id })
      .from(authAccounts)
      .limit(1);
    const existingUsers = await this.db
      .select({ id: users.id, email: users.email })
      .from(users)
      .limit(2);
    if (
      existingAccount ||
      existingUsers.length > 1 ||
      (existingUsers[0] && existingUsers[0].email.toLowerCase() !== email)
    ) {
      throw alreadyInitialized();
    }

    const password = await hashCredentialPassword(data.password);

    return this.db.transaction(async (transaction) => {
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(${BOOTSTRAP_LOCK_ID})`);
      const [concurrentAccount] = await transaction
        .select({ id: authAccounts.id })
        .from(authAccounts)
        .limit(1);
      const concurrentUsers = await transaction
        .select({ id: users.id, organizationId: users.organizationId, email: users.email })
        .from(users)
        .limit(2);
      const orphan = concurrentUsers[0];
      if (
        concurrentAccount ||
        concurrentUsers.length > 1 ||
        (orphan && orphan.email.toLowerCase() !== email)
      ) {
        throw alreadyInitialized();
      }

      const [organization] = orphan
        ? await transaction
            .update(organizations)
            .set({ name: data.organizationName.trim(), updatedAt: new Date() })
            .where(sql`${organizations.id} = ${orphan.organizationId}`)
            .returning()
        : await transaction
            .insert(organizations)
            .values({
              name: data.organizationName.trim(),
              slug: organizationSlug(data.organizationName),
            })
            .returning();
      const userId = orphan?.id ?? randomUUID();
      const [user] = orphan
        ? await transaction
            .update(users)
            .set({
              email,
              name: data.name.trim(),
              emailVerified: true,
              isActive: true,
              updatedAt: new Date(),
            })
            .where(sql`${users.id} = ${userId}`)
            .returning()
        : await transaction
            .insert(users)
            .values({
              id: userId,
              organizationId: organization.id,
              email,
              name: data.name.trim(),
              emailVerified: true,
            })
            .returning();

      await transaction.insert(authAccounts).values({
        id: randomUUID(),
        userId,
        issuer: 'local:credential',
        accountId: userId,
        providerId: 'credential',
        password,
      });
      const [existingAdminRole] = await transaction
        .select({ id: userRoles.id })
        .from(userRoles)
        .where(
          sql`${userRoles.userId} = ${userId} AND ${userRoles.role} = 'admin' AND ${userRoles.scopeType} = 'global'`,
        )
        .limit(1);
      if (!existingAdminRole) {
        await transaction.insert(userRoles).values({
          userId,
          organizationId: organization.id,
          role: 'admin',
          scopeType: 'global',
        });
      }
      await transaction.insert(auditLog).values({
        organizationId: organization.id,
        userId,
        entityType: 'organization',
        entityId: organization.id,
        action: 'bootstrapped',
        changes: { firstAdminUserId: userId },
        metadata: {
          accountCreationPolicy: 'admin-only',
          recoveredOrphanUser: Boolean(orphan),
        },
      });

      return { organization, user };
    });
  }
}
