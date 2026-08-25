import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { getAuthTables } from 'better-auth/db';
import { authAccounts } from '@betterspend/db';

function columnName(column: unknown): string | null {
  if (
    typeof column === 'object' &&
    column !== null &&
    'name' in column &&
    typeof column.name === 'string'
  ) {
    return column.name;
  }
  return null;
}

describe('Better Auth schema contract', () => {
  it('maps every Better Auth 1.7 account field and required index', () => {
    const expectedAccount = getAuthTables({
      emailAndPassword: { enabled: true },
    }).account;
    const actualColumns = getTableColumns(authAccounts);
    const missingFields = Object.keys(expectedAccount.fields).filter(
      (field) => !(field in actualColumns),
    );

    assert.deepEqual(missingFields, []);
    assert.equal('expiresAt' in actualColumns, false);

    const indexes = getTableConfig(authAccounts).indexes.map((index) => ({
      columns: index.config.columns.map(columnName),
      unique: index.config.unique,
    }));

    assert.ok(
      indexes.some((index) => index.unique && index.columns.join(',') === 'issuer,account_id'),
    );
    assert.ok(indexes.some((index) => !index.unique && index.columns.join(',') === 'user_id'));
  });
});
