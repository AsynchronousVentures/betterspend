import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PgDialect } from 'drizzle-orm/pg-core';
import { pendingApprovalQuery } from './pending-approval-query';

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;

test('pending selection applies direct, role, department-head and delegation eligibility before pagination', async () => {
  const database = new PGlite();
  try {
    const directory = join(process.cwd(), '../../packages/db/src/migrations');
    for (const file of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
      await database.exec(await readFile(join(directory, file), 'utf8'));
    }
    await database.exec(`
      INSERT INTO organizations (id, name, slug) VALUES ('${id(1)}', 'Org', 'pending-test'), ('${id(2)}', 'Other', 'pending-other');
      INSERT INTO users (id, organization_id, name, email) VALUES
        ('${id(10)}', '${id(1)}', 'Direct', 'direct@test.example'),
        ('${id(11)}', '${id(1)}', 'Delegate', 'delegate@test.example'),
        ('${id(12)}', '${id(1)}', 'Role', 'role@test.example'),
        ('${id(13)}', '${id(1)}', 'No requests', 'none@test.example');
      INSERT INTO departments (id, organization_id, name, code) VALUES ('${id(20)}', '${id(1)}', 'Department', 'DEPT');
      INSERT INTO projects (id, organization_id, name, code) VALUES ('${id(21)}', '${id(1)}', 'Project', 'PROJ');
      INSERT INTO requisitions (id, organization_id, requester_id, department_id, project_id, number, title)
        VALUES ('${id(30)}', '${id(1)}', '${id(10)}', '${id(20)}', '${id(21)}', 'REQ-PENDING', 'Request');
      INSERT INTO approval_rules (id, organization_id, name) VALUES ('${id(40)}', '${id(1)}', 'Direct'), ('${id(41)}', '${id(1)}', 'Role'), ('${id(42)}', '${id(1)}', 'Head');
      INSERT INTO approval_rule_steps (approval_rule_id, step_order, approver_type, approver_id, approver_role) VALUES
        ('${id(40)}', 1, 'user', '${id(10)}', NULL), ('${id(41)}', 1, 'role', NULL, 'approver'), ('${id(42)}', 1, 'department_head', NULL, NULL);
      INSERT INTO user_roles (user_id, role, scope_type, scope_id) VALUES ('${id(12)}', 'approver', 'project', '${id(21)}');
      INSERT INTO approval_delegations (organization_id, delegator_id, delegate_id, start_date, end_date)
        VALUES ('${id(1)}', '${id(10)}', '${id(11)}', NOW() - INTERVAL '1 day', NOW() + INTERVAL '1 day');
      INSERT INTO approval_requests (organization_id, approvable_type, approvable_id, approval_rule_id, current_step, status, created_at)
        SELECT '${id(1)}', 'requisition', '${id(30)}', '${id(40)}', 1, 'pending', '2026-01-01' FROM generate_series(1, 205);
      INSERT INTO approval_requests (id, organization_id, approvable_type, approvable_id, approval_rule_id, current_step, status) VALUES
        ('${id(51)}', '${id(1)}', 'requisition', '${id(30)}', '${id(41)}', 1, 'pending'),
        ('${id(52)}', '${id(1)}', 'requisition', '${id(30)}', '${id(42)}', 1, 'pending');
    `);
    const query = async (
      actor: number,
      page = 1,
      limit = 50,
      entityIds: string[] | undefined = undefined,
    ) => {
      const scope = entityIds
        ? {
            organizationId: id(1),
            userId: id(actor),
            unrestricted: false,
            ownOnly: false,
            entityIds,
            departmentIds: [],
            projectIds: [],
          }
        : undefined;
      const statement = new PgDialect().sqlToQuery(
        pendingApprovalQuery(id(1), id(actor), scope, page, limit, true),
      );
      return (await database.query<{ id: string }>(statement.sql, statement.params)).rows;
    };
    const first = await query(10);
    const second = await query(10, 2);
    assert.equal(first.length, 51);
    assert.equal(second.length, 51);
    assert.equal(
      new Set([...first.slice(0, 50), ...second.slice(0, 50)].map((row) => row.id)).size,
      100,
    );
    assert.deepEqual(await query(11), first);
    assert.deepEqual(await query(13), []);
    assert.deepEqual(await query(10, 1, 50, []), []);
    assert.deepEqual(
      (await query(12)).map((row) => row.id),
      [id(51)],
    );
    await database.exec(
      `INSERT INTO user_roles (user_id, role, scope_type, scope_id) VALUES ('${id(12)}', 'approver', 'department', '${id(20)}')`,
    );
    assert.deepEqual(new Set((await query(12)).map((row) => row.id)), new Set([id(51), id(52)]));
    await database.exec(`UPDATE approval_delegations SET end_date = NOW() - INTERVAL '1 hour'`);
    assert.deepEqual(await query(11), []);
    // A required approver remains eligible even without a rule, matching budget-owner requests.
    await database.exec(
      `INSERT INTO approval_requests (id, organization_id, approvable_type, approvable_id, required_approver_id, current_step, status) VALUES ('${id(53)}', '${id(1)}', 'requisition', '${id(30)}', '${id(13)}', 1, 'pending')`,
    );
    assert.deepEqual(
      (await query(13)).map((row) => row.id),
      [id(53)],
    );
  } finally {
    await database.close();
  }
});
