import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '@betterspend/db';
import type { Db } from '@betterspend/db';
import { createSchemaTables } from '../../common/testing/pglite-schema';
import { BudgetsService } from './budgets.service';

const org = '00000000-0000-4000-8000-000000000001';
const department = '00000000-0000-4000-8000-000000000002';
const budget = '00000000-0000-4000-8000-000000000003';
const period = '00000000-0000-4000-8000-000000000004';

test('recording spend updates the matching budget period with driver-safe dates', async () => {
  const database = new PGlite();
  try {
    await createSchemaTables(database, [schema.budgets, schema.budgetPeriods]);
    await database.query(
      'INSERT INTO budgets (id, organization_id, name, budget_type, scope_id, fiscal_year, total_amount, spent_amount, base_spent_amount, exchange_rate, currency) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [
        budget,
        org,
        'Engineering 2026',
        'department',
        department,
        2026,
        '1000.00',
        '0',
        '0',
        '1',
        'USD',
      ],
    );
    await database.query(
      'INSERT INTO budget_periods (id, budget_id, period_start, period_end, amount, spent_amount) VALUES ($1,$2,$3,$4,$5,$6)',
      [period, budget, '2026-06-01T00:00:00Z', '2026-06-30T23:59:59Z', '500.00', '0'],
    );

    // postgres-js cannot serialize a raw Date parameter; make sure none reach the driver.
    const dateParams: unknown[] = [];
    const db = drizzle(database, {
      schema,
      logger: {
        logQuery: (_query, params) => {
          dateParams.push(...params.filter((value) => value instanceof Date));
        },
      },
    }) as unknown as Db;

    const service = new BudgetsService(db, {} as never, {} as never, {} as never);
    const result = await service.recordSpend(
      org,
      department,
      '125.50',
      2026,
      db,
      new Date('2026-06-15T12:00:00Z'),
    );

    assert.equal(result.updated, true);
    assert.equal(dateParams.length, 0);
    const { rows } = await database.query<{ spent_amount: string }>(
      'SELECT spent_amount FROM budget_periods WHERE id = $1',
      [period],
    );
    assert.equal(Number(rows[0]?.spent_amount), 125.5);
  } finally {
    await database.close();
  }
});
