import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUILT_IN_ROLE_PERMISSIONS,
  hasPaymentReleasePermissionConflict,
  normalizePermissions,
  PERMISSION_CATALOG,
  type PermissionKey,
  userRoleAssignmentSchema,
} from './authz';

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

test('core lifecycle permissions are catalogued and assigned to the intended built-in roles', () => {
  const keys = new Set(PERMISSION_CATALOG.map((permission) => permission.key));
  for (const key of [
    'requisitions:manage',
    'purchase_orders:manage',
    'receiving:view',
    'receiving:create',
    'receiving:manage',
    'approvals:view',
    'approvals:act',
    'invoices:manage',
    'payments:view',
    'payments:manage',
  ] satisfies readonly PermissionKey[]) {
    assert.equal(keys.has(key), true, `missing catalog key ${key}`);
  }
  assert.equal(BUILT_IN_ROLE_PERMISSIONS.requester.includes('requisitions:create'), true);
  assert.equal(BUILT_IN_ROLE_PERMISSIONS.receiver.includes('receiving:create'), true);
  assert.equal(BUILT_IN_ROLE_PERMISSIONS.approver.includes('approvals:act'), true);
  assert.equal(BUILT_IN_ROLE_PERMISSIONS.finance.includes('payments:manage'), true);
});

test('operational permissions are catalogued instead of living in a second key list', () => {
  const keys = new Set(PERMISSION_CATALOG.map((permission) => permission.key));

  for (const key of [
    'rfqs:view',
    'contracts:view',
    'catalog:view',
    'inventory:view',
    'inventory:manage',
    'supplier_risk:view',
    'software_licenses:view',
    'contracts:manage',
  ] as const) {
    assert.equal(keys.has(key), true, `missing catalog key ${key}`);
  }

  assert.equal(BUILT_IN_ROLE_PERMISSIONS.requester.includes('catalog:view'), true);
  assert.equal(BUILT_IN_ROLE_PERMISSIONS.receiver.includes('inventory:manage'), true);
  assert.equal(BUILT_IN_ROLE_PERMISSIONS.finance.includes('contracts:manage'), true);
});

test('payment release and vendor payment-detail permissions cannot be held together', () => {
  assert.equal(
    hasPaymentReleasePermissionConflict(['payments:release', 'vendors:edit_payment_details']),
    true,
  );
  assert.equal(hasPaymentReleasePermissionConflict(['payments:release']), false);
  assert.equal(hasPaymentReleasePermissionConflict(['vendors:edit_payment_details']), false);
  assert.equal(BUILT_IN_ROLE_PERMISSIONS.admin.includes('payments:release'), false);
  assert.equal(BUILT_IN_ROLE_PERMISSIONS.finance.includes('vendors:edit_payment_details'), false);
});
