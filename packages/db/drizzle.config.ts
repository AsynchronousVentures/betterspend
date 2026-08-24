import type { Config } from 'drizzle-kit';

export default {
  schema: './src/schema/index.ts',
  out: './src/migrations',
  dialect: 'postgresql',
  migrations: {
    prefix: 'timestamp',
  },
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;
