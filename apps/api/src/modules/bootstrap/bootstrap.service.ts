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
    const [existingUser] = await this.db.select({ id: users.id }).from(users).limit(1);
    if (existingUser) throw alreadyInitialized();

    const email = data.email.trim().toLowerCase();
    const password = await hashCredentialPassword(data.password);

    return this.db.transaction(async (transaction) => {
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(${BOOTSTRAP_LOCK_ID})`);
      const [concurrentUser] = await transaction.select({ id: users.id }).from(users).limit(1);
      if (concurrentUser) throw alreadyInitialized();

      const [organization] = await transaction
        .insert(organizations)
        .values({
          name: data.organizationName.trim(),
          slug: organizationSlug(data.organizationName),
        })
        .returning();
      const userId = randomUUID();
      const [user] = await transaction
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
      await transaction.insert(userRoles).values({
        userId,
        role: 'admin',
        scopeType: 'global',
      });
      await transaction.insert(auditLog).values({
        organizationId: organization.id,
        userId,
        entityType: 'organization',
        entityId: organization.id,
        action: 'bootstrapped',
        changes: { firstAdminUserId: userId },
        metadata: { accountCreationPolicy: 'admin-only' },
      });

      return { organization, user };
    });
  }
}
