import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { RequisitionsService } from './requisitions.service';

test('requisition list responses hide private owner idempotency keys', async () => {
  const service = new RequisitionsService(
    {
      query: {
        requisitions: {
          findMany: async () => [
            { id: 'requisition-1', title: 'Renewal', idempotencyKey: 'artifact-private' },
          ],
        },
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  const [requisition] = await service.findAll('org-1');

  assert.equal('idempotencyKey' in requisition!, false);
});

test('cancelling a renewal-owned requisition hides its private owner key', async () => {
  const renewalOwned = {
    id: 'requisition-1',
    requesterId: 'user-1',
    departmentId: null,
    projectId: null,
    status: 'draft',
    idempotencyKey: 'artifact-operation:private',
  };
  const service = new RequisitionsService(
    {
      transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          update: () => ({
            set: () => ({
              where: () => ({ returning: async () => [{ ...renewalOwned, status: 'cancelled' }] }),
            }),
          }),
        }),
    } as never,
    {} as never,
    {} as never,
    {} as never,
    { log: async () => {} } as never,
    { releaseRequisition: async () => {} } as never,
    {} as never,
  );
  (
    service as unknown as {
      findOneForMutation: () => Promise<typeof renewalOwned>;
    }
  ).findOneForMutation = async () => renewalOwned;

  const response = await service.cancel('requisition-1', 'org-1', 'user-1');

  assert.equal(response.status, 'cancelled');
  assert.equal('idempotencyKey' in response, false);
});

test('RequisitionsService mutation scope', async (t) => {
  const service = new RequisitionsService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  await t.test('does not let a requester cancel an already submitted requisition', () => {
    const access = {
      can: (permission: string) => permission === 'requisitions:create',
      scopeFor: () => ({
        organizationId: 'organization-1',
        userId: 'user-1',
        unrestricted: true,
        ownOnly: false,
        departmentIds: [],
        projectIds: [],
        entityIds: [],
      }),
    };

    assert.throws(
      () =>
        (service as any).assertCanMutate(
          {
            requesterId: 'user-1',
            departmentId: null,
            projectId: null,
            status: 'submitted',
          },
          'user-1',
          access,
        ),
      ForbiddenException,
    );
  });

  await t.test('keeps create grants inside their assigned department or project', () => {
    const access = {
      can: (permission: string) => permission === 'requisitions:create',
      scopeFor: () => ({
        organizationId: 'organization-1',
        userId: 'user-1',
        unrestricted: false,
        ownOnly: false,
        departmentIds: ['department-a'],
        projectIds: [],
        entityIds: [],
      }),
    };

    assert.throws(
      () =>
        (service as any).assertRequisitionScope(access, 'requisitions:create', {
          departmentId: 'department-b',
          projectId: null,
        }),
      ForbiddenException,
    );
    assert.doesNotThrow(() =>
      (service as any).assertRequisitionScope(access, 'requisitions:create', {
        departmentId: 'department-a',
        projectId: null,
      }),
    );
  });

  await t.test('rejects a create-only actor mutating another requester draft', () => {
    const access = {
      can: (permission: string) => permission === 'requisitions:create',
      scopeFor: () => ({
        organizationId: 'organization-1',
        userId: 'user-2',
        unrestricted: true,
        ownOnly: false,
        departmentIds: [],
        projectIds: [],
        entityIds: [],
      }),
    };

    assert.throws(
      () =>
        (service as any).assertCanMutate(
          { requesterId: 'user-1', departmentId: null, projectId: null, status: 'draft' },
          'user-2',
          access,
        ),
      ForbiddenException,
    );
  });

  await t.test('allows a create-only requester to mutate their own draft', () => {
    const access = {
      can: (permission: string) => permission === 'requisitions:create',
      scopeFor: () => ({
        organizationId: 'organization-1',
        userId: 'user-1',
        unrestricted: true,
        ownOnly: false,
        departmentIds: [],
        projectIds: [],
        entityIds: [],
      }),
    };

    assert.doesNotThrow(() =>
      (service as any).assertCanMutate(
        { requesterId: 'user-1', departmentId: null, projectId: null, status: 'draft' },
        'user-1',
        access,
      ),
    );
  });
});
