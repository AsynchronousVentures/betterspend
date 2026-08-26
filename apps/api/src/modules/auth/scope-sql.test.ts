import assert from 'node:assert/strict';
import test from 'node:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { ResourceScope } from '@betterspend/shared';
import { globalOnlyPredicate, intersectScopes, scopePredicate } from './scope-sql';

const scoped: ResourceScope = {
  organizationId: 'org-1',
  userId: 'user-1',
  unrestricted: false,
  ownOnly: false,
  departmentIds: ['department-1'],
  projectIds: ['project-1'],
  entityIds: [],
};

test('scope predicates fail closed when no selected dimension is available', () => {
  const query = new PgDialect().sqlToQuery(
    scopePredicate({ ...scoped, departmentIds: [], projectIds: [], entityIds: ['entity-1'] }, {
      department: sql`r.department_id`,
      project: sql`r.project_id`,
    }),
  );

  assert.match(query.sql, /false/);
  assert.equal(query.params.length, 0);
});

test('scope predicates keep own-only grants tied to the owner column', () => {
  const query = new PgDialect().sqlToQuery(
    scopePredicate({ ...scoped, ownOnly: true }, {
      department: sql`r.department_id`,
      owner: sql`r.requester_id`,
    }),
  );

  assert.match(query.sql, /requester_id/);
  assert.ok(query.params.includes('user-1'));
  assert.ok(query.params.includes('department-1'));
});

test('global-only predicates distinguish global and scoped grants', () => {
  const scopedQuery = new PgDialect().sqlToQuery(globalOnlyPredicate(scoped));
  const globalQuery = new PgDialect().sqlToQuery(
    globalOnlyPredicate({ ...scoped, unrestricted: true }),
  );

  assert.equal(scopedQuery.sql, 'false');
  assert.equal(globalQuery.sql, 'true');
});

test('intersected scopes require both permission grants to match', () => {
  const combined = intersectScopes(scoped, {
    ...scoped,
    departmentIds: [],
    projectIds: ['project-2'],
  });
  const query = new PgDialect().sqlToQuery(
    scopePredicate(combined, {
      department: sql`r.department_id`,
      project: sql`r.project_id`,
    }),
  );

  assert.match(query.sql, /and/i);
  assert.ok(query.params.includes('department-1'));
  assert.ok(query.params.includes('project-2'));
});
