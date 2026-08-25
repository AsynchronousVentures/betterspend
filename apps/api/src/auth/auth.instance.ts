import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { randomUUID } from 'crypto';
import * as schema from '@betterspend/db';
import type { Db } from '@betterspend/db';

// Minimal type covering what we use from the better-auth instance
export interface AuthInstance {
  handler: (request: Request) => Promise<Response>;
  api: {
    getSession: (opts: {
      headers: Headers;
      query?: Record<string, string>;
    }) => Promise<{ session: AuthSession; user: AuthUser } | null>;
  };
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  image?: string | null;
  createdAt: Date;
  updatedAt: Date;
  // our extra fields exposed via additionalFields
  organizationId: string;
  departmentId?: string | null;
  isActive: boolean;
}

export interface AuthSession {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
}

let _instance: AuthInstance | null = null;

export async function createAuthForDatabase(db: Db): Promise<AuthInstance> {
  const { betterAuth } = await import('better-auth');
  const { drizzleAdapter } = await import('better-auth/adapters/drizzle');

  return betterAuth({
    baseURL: process.env.API_URL || `http://localhost:${process.env.API_PORT || 4001}`,
    basePath: '/api/auth',
    secret: process.env.BETTER_AUTH_SECRET || 'betterspend-dev-secret-change-in-prod',
    trustedOrigins: [process.env.WEB_URL || 'http://localhost:3100'],
    advanced: {
      // Our DB columns are typed uuid — generate proper UUIDs instead of better-auth's default random strings
      database: { generateId: () => randomUUID() },
    },
    database: drizzleAdapter(db, {
      provider: 'pg',
      transaction: true,
      schema: {
        user: schema.users,
        session: schema.authSessions,
        account: schema.authAccounts,
        verification: schema.authVerifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
      // First-instance bootstrap and authenticated admin creation are the only account creation paths.
      disableSignUp: true,
    },
    user: {
      additionalFields: {
        organizationId: { type: 'string', required: false, returned: true, input: false },
        departmentId: { type: 'string', required: false, returned: true, input: false },
        isActive: { type: 'boolean', required: false, returned: true, input: false },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // refresh if older than 1 day
      cookieCache: { enabled: false },
    },
  }) as unknown as AuthInstance;
}

export async function createAuthInstance(): Promise<AuthInstance> {
  if (_instance) return _instance;

  // Better Auth has its own client so its transactions cannot leak into Nest request state.
  const client = postgres(process.env.DATABASE_URL!);
  const db = drizzle(client, { schema });
  _instance = await createAuthForDatabase(db);

  return _instance;
}
