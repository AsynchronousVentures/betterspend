import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import * as relations from './relations';

const connectionString = process.env.DATABASE_URL!;

const client = postgres(connectionString);
export const db = drizzle(client, { schema: { ...schema, ...relations } });
export type Db = typeof db;
export type DbTransaction = Parameters<Parameters<Db['transaction']>[0]>[0];
