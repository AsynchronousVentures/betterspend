import type { PGlite } from '@electric-sql/pglite';
import { getTableColumns, getTableName } from 'drizzle-orm';
import type { AnyPgTable } from 'drizzle-orm/pg-core';

const COLUMN_TYPES: Record<string, string> = {
  PgUUID: 'uuid',
  PgNumeric: 'numeric',
  PgTimestamp: 'timestamptz',
  PgBoolean: 'boolean',
  PgJsonb: 'jsonb',
  PgInteger: 'integer',
  PgSerial: 'integer',
};

/**
 * Build a nullable, constraint-free table from a Drizzle table definition so
 * raw SQL in a service runs against the real column names in a PGlite test.
 */
export function createTableSql(table: AnyPgTable): string {
  const columns = Object.values(getTableColumns(table)).map(
    (column) => `"${column.name}" ${COLUMN_TYPES[column.columnType] ?? 'text'}`,
  );
  return `CREATE TABLE "${getTableName(table)}" (${columns.join(', ')})`;
}

export async function createSchemaTables(database: PGlite, tables: AnyPgTable[]): Promise<void> {
  for (const table of tables) {
    await database.exec(createTableSql(table));
  }
}
