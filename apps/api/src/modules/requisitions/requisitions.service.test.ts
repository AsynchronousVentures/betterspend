import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { RequisitionsService } from './requisitions.service';

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
});
