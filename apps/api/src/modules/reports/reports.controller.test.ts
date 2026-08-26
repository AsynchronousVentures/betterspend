import assert from 'node:assert/strict';
import test from 'node:test';
import type { AccessPolicy } from '../auth/access-policy';
import type { ResourceScope } from '@betterspend/shared';
import { ReportsController } from './reports.controller';

const viewScope: ResourceScope = {
  organizationId: 'org-1',
  userId: 'user-1',
  unrestricted: false,
  ownOnly: false,
  departmentIds: ['department-1'],
  projectIds: [],
  entityIds: [],
};

const exportScope: ResourceScope = {
  ...viewScope,
  departmentIds: [],
  projectIds: ['project-1'],
};

function accessFor(canExport: boolean): AccessPolicy {
  return {
    can: (permission) =>
      permission === 'reports:view' || (canExport && permission === 'reports:export'),
    scopeFor: (_resource, permission) =>
      permission === 'reports:export' ? exportScope : viewScope,
    isGlobalBuiltInAdmin: () => false,
    toDocument: () => ({ permissions: [], scopes: {} }),
  };
}

function responseFor() {
  let body: unknown;
  return {
    response: {
      setHeader: () => undefined,
      send: (value: unknown) => {
        body = value;
        return value;
      },
      json: (value: unknown) => {
        body = value;
        return value;
      },
    },
    getBody: () => body,
  };
}

test('custom CSV reports require the export permission', async () => {
  let serviceCalled = false;
  const controller = new ReportsController({
    runCustomReport: async () => {
      serviceCalled = true;
      return [];
    },
  } as never);
  const { response } = responseFor();

  await assert.rejects(
    controller.runCustomReport(
      'org-1',
      response as never,
      'spend_by_vendor',
      undefined,
      undefined,
      undefined,
      'csv',
      accessFor(false),
    ),
    (error: unknown) => {
      const exception = error as { status?: number; message?: string };
      return exception.status === 403 && /reports:export/.test(exception.message ?? '');
    },
  );
  assert.equal(serviceCalled, false);
});

test('custom CSV reports pass the intersection of view and export scopes', async () => {
  let capturedScope: unknown;
  const controller = new ReportsController({
    runCustomReport: async (...args: unknown[]) => {
      capturedScope = args[2];
      return [{ vendor: 'Acme', total: 10 }];
    },
    toCsvPublic: () => 'vendor,total\nAcme,10',
  } as never);
  const { response, getBody } = responseFor();

  await controller.runCustomReport(
    'org-1',
    response as never,
    'spend_by_vendor',
    undefined,
    undefined,
    undefined,
    'csv',
    accessFor(true),
  );

  assert.deepEqual(capturedScope, {
    kind: 'intersection',
    scopes: [viewScope, exportScope],
  });
  assert.match(String(getBody()), /vendor,total/);
});
