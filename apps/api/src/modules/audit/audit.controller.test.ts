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

test('audit verification reaches the service with a normalized date range', async () => {
  const calls: unknown[][] = [];
  const service = {
    verifyChain: async (...args: unknown[]) => {
      calls.push(args);
      return { valid: true };
    },
  };
  const controller = new AuditController(service as never);

  await controller.verify(
    'org-1',
    '2026-08-01T00:00:00-06:00',
    '2026-08-31T23:59:59-06:00',
    accessFor({ ...scopedScope, unrestricted: true }),
  );

  assert.deepEqual(calls, [
    [
      'org-1',
      {
        from: new Date('2026-08-01T06:00:00Z'),
        to: new Date('2026-09-01T05:59:59Z'),
      },
    ],
  ]);
});

test('audit verification rejects an invalid or reversed date range', () => {
  const service = { verifyChain: async () => ({ valid: true }) };
  const controller = new AuditController(service as never);
  const globalAccess = accessFor({ ...scopedScope, unrestricted: true });

  assert.throws(
    () => controller.verify('org-1', 'not-a-date', undefined, globalAccess),
    (error: unknown) =>
      error && typeof error === 'object' && 'status' in error && error.status === 400,
  );
  assert.throws(
    () => controller.verify('org-1', '2026-09-01', '2026-08-01', globalAccess),
    (error: unknown) =>
      error && typeof error === 'object' && 'status' in error && error.status === 400,
  );
});
