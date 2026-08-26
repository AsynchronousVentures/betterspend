import assert from 'node:assert/strict';
import test from 'node:test';
import type { AccessPolicy } from './access-policy';
import { canViewRelatedRecord } from './related-record-access';

function accessFor(
  grantedPermissions: string[],
  scope: ReturnType<AccessPolicy['scopeFor']>,
): AccessPolicy {
  return {
    can: (permission) => grantedPermissions.includes(permission),
    scopeFor: () => scope,
    isGlobalBuiltInAdmin: () => false,
    toDocument: () => ({ permissions: [], scopes: {} }),
  };
}

test('canViewRelatedRecord requires the target resource permission', () => {
  const access = accessFor([], {
    organizationId: 'organization-1',
    userId: 'user-1',
    unrestricted: true,
    ownOnly: false,
    departmentIds: [],
    projectIds: [],
    entityIds: [],
  });

  assert.equal(
    canViewRelatedRecord(access, 'purchase_order', ['purchase_orders:view_all'], {}),
    false,
  );
});

test('canViewRelatedRecord honors target-resource own and scoped grants', () => {
  const ownAccess = accessFor(['purchase_orders:view_own'], {
    organizationId: 'organization-1',
    userId: 'user-1',
    unrestricted: false,
    ownOnly: true,
    departmentIds: [],
    projectIds: [],
    entityIds: [],
  });
  const departmentAccess = accessFor(['budgets:view'], {
    organizationId: 'organization-1',
    userId: 'user-1',
    unrestricted: false,
    ownOnly: false,
    departmentIds: ['department-1'],
    projectIds: [],
    entityIds: [],
  });

  assert.equal(
    canViewRelatedRecord(ownAccess, 'purchase_order', ['purchase_orders:view_own'], {
      ownerIds: ['user-2', 'user-1'],
    }),
    true,
  );
  assert.equal(
    canViewRelatedRecord(departmentAccess, 'budget', ['budgets:view'], {
      departmentId: 'department-2',
    }),
    false,
  );
  assert.equal(
    canViewRelatedRecord(departmentAccess, 'budget', ['budgets:view'], {
      departmentId: 'department-1',
    }),
    true,
  );
});
