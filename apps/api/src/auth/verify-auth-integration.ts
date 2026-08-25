import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '@betterspend/db';
import { migrateBetterAuthAccounts, type Db } from '@betterspend/db';
import { createAuthForDatabase, type AuthInstance } from './auth.instance';
import { hashCredentialPassword } from './credential-password';
import { BootstrapService } from '../modules/bootstrap/bootstrap.service';
import { UsersService } from '../modules/users/users.service';

async function authRequest(
  auth: AuthInstance,
  path: string,
  body: Record<string, string>,
): Promise<Response> {
  return auth.handler(
    new Request(`http://localhost:4001/api/auth/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3100',
      },
      body: JSON.stringify(body),
    }),
  );
}

function testPassword(): string {
  return randomBytes(24).toString('base64url');
}

async function verifyMigratedCredentialSignIn(databaseUrl: string): Promise<void> {
  const client = postgres(databaseUrl, { max: 1 });
  const schemaName = `auth_sign_in_${randomUUID().replaceAll('-', '')}`;
  await client`CREATE SCHEMA ${client(schemaName)}`;
  try {
    await client`SELECT set_config('search_path', ${schemaName}, false)`;
    await client.unsafe(`
      CREATE TABLE users (
        id uuid PRIMARY KEY,
        organization_id uuid NOT NULL,
        email varchar(255) NOT NULL UNIQUE,
        name varchar(255) NOT NULL,
        email_verified boolean DEFAULT false NOT NULL,
        image text,
        department_id uuid,
        is_active boolean DEFAULT true NOT NULL,
        created_at timestamp with time zone DEFAULT now() NOT NULL,
        updated_at timestamp with time zone DEFAULT now() NOT NULL
      );
      CREATE TABLE auth_accounts (
        id text PRIMARY KEY NOT NULL,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE cascade,
        account_id text NOT NULL,
        provider_id text NOT NULL,
        access_token text,
        refresh_token text,
        id_token text,
        expires_at timestamp with time zone,
        password text,
        created_at timestamp with time zone DEFAULT now() NOT NULL,
        updated_at timestamp with time zone DEFAULT now() NOT NULL
      );
      CREATE TABLE auth_sessions (
        id text PRIMARY KEY NOT NULL,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE cascade,
        token text NOT NULL UNIQUE,
        expires_at timestamp with time zone NOT NULL,
        ip_address text,
        user_agent text,
        created_at timestamp with time zone DEFAULT now() NOT NULL,
        updated_at timestamp with time zone DEFAULT now() NOT NULL
      );
      CREATE TABLE auth_verifications (
        id text PRIMARY KEY NOT NULL,
        identifier text NOT NULL,
        value text NOT NULL,
        expires_at timestamp with time zone NOT NULL,
        created_at timestamp with time zone DEFAULT now() NOT NULL,
        updated_at timestamp with time zone DEFAULT now() NOT NULL
      )
    `);

    const userId = randomUUID();
    const password = testPassword();
    const passwordHash = await hashCredentialPassword(password);
    await client`
      INSERT INTO users (id, organization_id, email, name)
      VALUES (${userId}, ${randomUUID()}, 'pre-upgrade@example.test', 'Pre-upgrade User')
    `;
    await client`
      INSERT INTO auth_accounts (
        id, user_id, account_id, provider_id, password, expires_at
      ) VALUES (
        'pre-upgrade-account', ${userId}, ${userId}, 'credential', ${passwordHash},
        '2026-01-02T03:04:05.000Z'
      )
    `;

    const migration = await readFile(
      path.resolve(
        __dirname,
        '../../../../packages/db/src/migrations/20260825042914_amazing_hydra.sql',
      ),
      'utf8',
    );
    for (const statement of migration.split('--> statement-breakpoint')) {
      if (statement.trim()) await client.unsafe(statement);
    }
    await migrateBetterAuthAccounts(client);

    const upgradeDb = drizzle(client, { schema }) as Db;
    const auth = await createAuthForDatabase(upgradeDb);
    const signIn = await authRequest(auth, 'sign-in/email', {
      email: 'pre-upgrade@example.test',
      password,
    });
    assert.equal(signIn.status, 200);
  } finally {
    await client`SELECT set_config('search_path', 'public', false)`;
    await client`DROP SCHEMA ${client(schemaName)} CASCADE`;
    await client.end();
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL!;
  await verifyMigratedCredentialSignIn(databaseUrl);

  const client = postgres(databaseUrl, { max: 4 });
  const db = drizzle(client, { schema }) as Db;
  const bootstrapService = new BootstrapService(db);

  try {
    const existingUsers = await db.select().from(schema.users);
    assert.equal(existingUsers.length, 0, 'Auth integration verification needs a fresh database');

    const firstAdmin = {
      organizationName: 'Auth Verification Company',
      name: 'First Admin',
      email: 'first-admin@example.test',
      password: testPassword(),
    };
    const initialized = await bootstrapService.initialize(firstAdmin);
    const [account] = await db
      .select()
      .from(schema.authAccounts)
      .where(eq(schema.authAccounts.userId, initialized.user.id));
    const [role] = await db
      .select()
      .from(schema.userRoles)
      .where(eq(schema.userRoles.userId, initialized.user.id));
    const [auditEntry] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, initialized.organization.id));
    assert.equal(account?.issuer, 'local:credential');
    assert.equal(account?.accountId, initialized.user.id);
    assert.equal(role?.role, 'admin');
    assert.equal(role?.scopeType, 'global');
    assert.equal(auditEntry?.action, 'bootstrapped');

    await assert.rejects(
      bootstrapService.initialize({
        ...firstAdmin,
        email: 'second-bootstrap@example.test',
      }),
      /already initialized/,
    );

    const auth = await createAuthForDatabase(db);
    const disabledSignUp = await authRequest(auth, 'sign-up/email', {
      name: 'Bypass Attempt',
      email: 'bypass@example.test',
      password: testPassword(),
    });
    assert.equal(disabledSignUp.status, 400);

    const firstSignIn = await authRequest(auth, 'sign-in/email', {
      email: firstAdmin.email,
      password: firstAdmin.password,
    });
    assert.equal(firstSignIn.status, 200);
    assert.equal(typeof ((await firstSignIn.json()) as { token?: unknown }).token, 'string');

    const usersService = new UsersService(db);
    const invitedPassword = testPassword();
    const invited = await usersService.create(initialized.organization.id, {
      name: 'Invited User',
      email: 'invited@example.test',
      password: invitedPassword,
      role: 'requester',
    });
    const invitedSignIn = await authRequest(auth, 'sign-in/email', {
      email: invited.email,
      password: invitedPassword,
    });
    assert.equal(invitedSignIn.status, 200);

    await client.unsafe(`
      CREATE FUNCTION auth_verification_reject_account() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'forced account insert failure';
      END
      $$ LANGUAGE plpgsql
    `);
    await client.unsafe(`
      CREATE TRIGGER auth_verification_reject_account
      BEFORE INSERT ON auth_accounts
      FOR EACH ROW EXECUTE FUNCTION auth_verification_reject_account()
    `);
    try {
      await assert.rejects(
        usersService.create(initialized.organization.id, {
          name: 'Must Roll Back',
          email: 'rollback@example.test',
          password: testPassword(),
          role: 'requester',
        }),
      );
      const orphan = await db.query.users.findFirst({
        where: eq(schema.users.email, 'rollback@example.test'),
      });
      assert.equal(orphan, undefined);
    } finally {
      await client`DROP TRIGGER auth_verification_reject_account ON auth_accounts`;
      await client`DROP FUNCTION auth_verification_reject_account()`;
    }

    console.log('Better Auth integration verification passed.');
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
