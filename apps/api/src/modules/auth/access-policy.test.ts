import assert from 'node:assert/strict';
import test from 'node:test';
import { createAccessPolicy, type AccessAssignment } from './access-policy';

const identity = {
  id: '00000000-0000-0000-0000-000000000001',
  organizationId: '00000000-0000-0000-0000-000000000010',
};

function builtIn(
  role: AccessAssignment['role'],
  scopeType: AccessAssignment['scopeType'] = 'global',
  scopeId: string | null = null,
): AccessAssignment {
  return { role, customRoleId: null, scopeType, scopeId };
}

test('global built-in grants are unrestricted, while a scoped admin is not', () => {
  const globalAdmin = createAccessPolicy(identity, [builtIn('admin')]);
  assert.equal(globalAdmin.can('users:manage'), true);
  assert.equal(globalAdmin.scopeFor('user', 'users:manage').unrestricted, true);

  const scopedAdmin = createAccessPolicy(identity, [builtIn('admin', 'department', 'dept-1')]);
  assert.equal(scopedAdmin.can('users:manage'), false);
  assert.equal(scopedAdmin.scopeFor('user', 'users:manage').unrestricted, false);
  assert.deepEqual(scopedAdmin.scopeFor('requisition', 'requisitions:view_all').departmentIds, [
    'dept-1',
  ]);
});

test('multiple scoped grants union by permission and a global grant overrides only that permission', () => {
  const policy = createAccessPolicy(identity, [
    builtIn('approver', 'department', 'dept-1'),
    builtIn('approver', 'project', 'project-1'),
    builtIn('receiver'),
  ]);

  assert.deepEqual(policy.scopeFor('requisition', 'requisitions:approve').departmentIds, [
    'dept-1',
  ]);
  assert.deepEqual(policy.scopeFor('requisition', 'requisitions:approve').projectIds, [
    'project-1',
  ]);
  assert.equal(policy.scopeFor('purchase_order', 'purchase_orders:view_all').unrestricted, true);
  assert.equal(policy.scopeFor('requisition', 'requisitions:approve').unrestricted, false);
});

test('unsupported scoped grants fail closed and cross-organization custom roles are ignored', () => {
  const policy = createAccessPolicy(identity, [
    {
      role: 'custom',
      customRoleId: 'custom-scoped',
      customRoleOrganizationId: identity.organizationId,
      customPermissions: ['vendors:view'],
      scopeType: 'department',
      scopeId: 'dept-1',
    },
    {
      role: 'custom',
      customRoleId: 'custom-1',
      customRoleOrganizationId: 'other-org',
      customPermissions: ['vendors:view'],
      scopeType: 'global',
      scopeId: null,
    },
  ]);

  assert.equal(policy.can('reports:view'), false);
  assert.equal(policy.can('vendors:view'), false);
  assert.deepEqual(policy.scopeFor('vendor', 'vendors:view').departmentIds, []);
  assert.deepEqual(policy.scopeFor('vendor', 'vendors:view').entityIds, []);
  assert.equal(policy.scopeFor('vendor', 'vendors:view').unrestricted, false);
});

test('custom grants expose only effective permissions and preserve own-only semantics', () => {
  const policy = createAccessPolicy(identity, [
    {
      role: 'custom',
      customRoleId: 'custom-1',
      customRoleOrganizationId: identity.organizationId,
      customPermissions: ['requisitions:view_own', 'requisitions:view_own', 'not-real'],
      scopeType: 'project',
      scopeId: 'project-1',
    },
  ]);

  assert.deepEqual(policy.toDocument(), {
    permissions: ['requisitions:view_own'],
    scopes: {
      'requisitions:view_own': [{ scopeType: 'project', scopeId: 'project-1' }],
    },
  });
  assert.equal(policy.scopeFor('requisition', 'requisitions:view_own').ownOnly, true);
});

test('custom users:manage access is not built-in admin provenance', () => {
  const policy = createAccessPolicy(identity, [
    {
      role: 'custom',
      customRoleId: 'custom-admin',
      customRoleOrganizationId: identity.organizationId,
      customPermissions: ['users:manage'],
      scopeType: 'global',
      scopeId: null,
    },
  ]);

  assert.equal(policy.can('users:manage'), true);
  assert.equal(policy.isGlobalBuiltInAdmin(), false);
});

test('operational permission scopes are resolved from the shared catalog and fail closed when unsupported', () => {
  const entityId = '00000000-0000-0000-0000-000000000099';
  const policy = createAccessPolicy(identity, [
    {
      role: 'custom',
      customRoleId: 'catalog-role',
      customRoleOrganizationId: identity.organizationId,
      customPermissions: ['catalog:view', 'inventory:view'],
      scopeType: 'entity',
      scopeId: entityId,
    },
  ]);

  assert.equal(policy.can('catalog:view'), true);
  assert.deepEqual(policy.scopeFor('catalog', 'catalog:view').entityIds, [entityId]);
  assert.equal(policy.can('inventory:view'), false);
});

test('fails closed when legacy assignments contain the payment release toxic pair', () => {
  const policy = createAccessPolicy(identity, [
    {
      role: 'custom',
      customRoleId: 'release-role',
      customRoleOrganizationId: identity.organizationId,
      customPermissions: ['payments:release'],
      scopeType: 'global',
      scopeId: null,
    },
    {
      role: 'custom',
      customRoleId: 'vendor-details-role',
      customRoleOrganizationId: identity.organizationId,
      customPermissions: ['vendors:edit_payment_details'],
      scopeType: 'global',
      scopeId: null,
    },
  ]);

  assert.equal(policy.can('payments:release'), false);
  assert.equal(policy.can('vendors:edit_payment_details'), false);
});
