import { createAccessPolicy } from './access-policy';

describe('createAccessPolicy', () => {
  it('keeps view and action scopes separate for the same resource', () => {
    const organizationId = '00000000-0000-4000-8000-000000000001';
    const policy = createAccessPolicy({ id: 'user-1', organizationId }, [
      {
        role: 'custom',
        customRoleId: '00000000-0000-4000-8000-000000000002',
        customRoleOrganizationId: organizationId,
        customPermissions: ['approvals:view'],
        scopeType: 'entity',
        scopeId: '00000000-0000-4000-8000-00000000000a',
      },
      {
        role: 'custom',
        customRoleId: '00000000-0000-4000-8000-000000000002',
        customRoleOrganizationId: organizationId,
        customPermissions: ['approvals:act'],
        scopeType: 'entity',
        scopeId: '00000000-0000-4000-8000-00000000000b',
      },
    ]);

    expect(policy.scopeFor('approval', 'approvals:view').entityIds).toEqual([
      '00000000-0000-4000-8000-00000000000a',
    ]);
    expect(policy.scopeFor('approval', 'approvals:act').entityIds).toEqual([
      '00000000-0000-4000-8000-00000000000b',
    ]);
  });

  it('does not turn an entity scope into a requisition scope without an entity dimension', () => {
    const organizationId = '00000000-0000-4000-8000-000000000001';
    const policy = createAccessPolicy({ id: 'user-1', organizationId }, [
      {
        role: 'custom',
        customRoleId: '00000000-0000-4000-8000-000000000002',
        customRoleOrganizationId: organizationId,
        customPermissions: ['requisitions:manage'],
        scopeType: 'entity',
        scopeId: '00000000-0000-4000-8000-00000000000a',
      },
    ]);

    expect(policy.scopeFor('requisition', 'requisitions:manage').entityIds).toEqual([]);
  });
});
