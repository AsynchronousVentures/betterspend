import assert from 'node:assert/strict';
import test from 'node:test';
import { BUILT_IN_ROLE_PERMISSIONS, normalizePermissions, userRoleAssignmentSchema } from './authz';

test('role assignments require exactly one role source', () => {
  assert.equal(
    userRoleAssignmentSchema.safeParse({ role: 'admin', scopeType: 'global' }).success,
    true,
  );
  assert.equal(
    userRoleAssignmentSchema.safeParse({
      customRoleId: '00000000-0000-4000-8000-000000000001',
      scopeType: 'global',
    }).success,
    true,
  );
  assert.equal(
    userRoleAssignmentSchema.safeParse({
      role: 'admin',
      customRoleId: '00000000-0000-4000-8000-000000000001',
      scopeType: 'global',
    }).success,
    false,
  );
  assert.equal(
    userRoleAssignmentSchema.safeParse({ role: 'custom', scopeType: 'global' }).success,
    false,
  );
});

test('scope shape is explicit and global never carries an id', () => {
  assert.equal(
    userRoleAssignmentSchema.safeParse({
      role: 'requester',
      scopeType: 'department',
    }).success,
    false,
  );
  const invalidGlobalScope = userRoleAssignmentSchema.safeParse({
    role: 'requester',
    scopeType: 'global',
    scopeId: '00000000-0000-4000-8000-000000000001',
  });
  assert.equal(invalidGlobalScope.success, false);
  assert.ok(
    !invalidGlobalScope.success &&
      invalidGlobalScope.error.issues.some((issue) => issue.path[0] === 'scopeId'),
  );
});

test('permission normalization is catalog-bound and deduplicated', () => {
  assert.deepEqual(
    normalizePermissions([
      'reports:view',
      'reports:view',
      'not-a-permission',
      BUILT_IN_ROLE_PERMISSIONS.requester[0],
    ]),
    ['reports:view', 'requisitions:create'],
  );
});
