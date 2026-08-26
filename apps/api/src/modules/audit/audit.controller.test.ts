import assert from 'node:assert/strict';
import test from 'node:test';
import { AuditController } from './audit.controller';
import type { AccessPolicy } from '../auth/access-policy';
import type { ResourceScope } from '@betterspend/shared';

const scopedScope: ResourceScope = {
  organizationId: 'org-1',
  userId: 'user-1',
  unrestricted: false,
  ownOnly: false,
  departmentIds: ['department-1'],
  projectIds: [],
  entityIds: [],
};

function accessFor(scope: ResourceScope): AccessPolicy {
  return {
    can: () => true,
    scopeFor: () => scope,
    isGlobalBuiltInAdmin: () => scope.unrestricted,
    toDocument: () => ({ permissions: [], scopes: {} }),
  };
}

test('audit reads reject scoped report grants', async () => {
  const service = { findAll: async () => [] };
  const controller = new AuditController(service as never);

  let caught: unknown;
  try {
    controller.findAll('org-1', undefined, undefined, undefined, accessFor(scopedScope));
  } catch (error) {
    caught = error;
  }
  assert.ok(caught);
  const error = caught as { status?: number; message?: string };
  assert.equal(error.status, 403);
  assert.match(error.message ?? '', /global grant/);
});

test('audit reads reach the service for a global report grant', async () => {
  const calls: unknown[][] = [];
  const service = {
    findAll: async (...args: unknown[]) => {
      calls.push(args);
      return [];
    },
  };
  const controller = new AuditController(service as never);

  await controller.findAll(
    'org-1',
    'budget',
    'budget-1',
    '50',
    accessFor({ ...scopedScope, unrestricted: true }),
  );

  assert.deepEqual(calls, [['org-1', { entityType: 'budget', entityId: 'budget-1', limit: 50 }]]);
});
