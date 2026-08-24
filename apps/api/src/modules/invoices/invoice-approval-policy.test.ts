import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  resolveIndependentInvoiceApprover,
  type InvoiceApprovalCandidate,
} from './invoice-approval-policy';

function candidate(
  id: string,
  options: {
    name?: string;
    departmentId?: string | null;
    role?: string;
    scopeType?: string;
    permissions?: string[];
    isActive?: boolean;
  } = {},
): InvoiceApprovalCandidate {
  return {
    id,
    name: options.name ?? id,
    departmentId: options.departmentId ?? null,
    isActive: options.isActive ?? true,
    userRoles: [
      {
        role: options.role ?? 'approver',
        scopeType: options.scopeType ?? 'global',
        customRole: options.permissions ? { permissions: options.permissions } : null,
      },
    ],
  };
}

describe('resolveIndependentInvoiceApprover', () => {
  it('removes the maker and escalates to an approver outside the maker department', () => {
    const fallback = resolveIndependentInvoiceApprover('maker', 'finance', [
      candidate('maker', { departmentId: 'finance', role: 'admin' }),
      candidate('same-group', { departmentId: 'finance', role: 'admin' }),
      candidate('outside-group', { departmentId: 'operations' }),
    ]);

    assert.equal(fallback?.id, 'outside-group');
  });

  it('accepts custom roles with global invoice approval permission', () => {
    const fallback = resolveIndependentInvoiceApprover('maker', null, [
      candidate('maker', { role: 'finance' }),
      candidate('custom-approver', {
        role: 'custom',
        permissions: ['invoices:approve'],
      }),
    ]);

    assert.equal(fallback?.id, 'custom-approver');
  });

  it('fails closed when no independent global approver exists', () => {
    const fallback = resolveIndependentInvoiceApprover('maker', 'finance', [
      candidate('maker', { departmentId: 'finance', role: 'admin' }),
      candidate('scoped-approver', { scopeType: 'department', departmentId: 'operations' }),
      candidate('inactive-admin', { role: 'admin', isActive: false }),
    ]);

    assert.equal(fallback, null);
  });
});
