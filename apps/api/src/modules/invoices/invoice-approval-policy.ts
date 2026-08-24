import { BUILT_IN_ROLE_PERMISSIONS, normalizePermissions } from '../../common/permissions';

export interface InvoiceApprovalCandidate {
  id: string;
  name: string;
  departmentId: string | null;
  isActive: boolean;
  userRoles: Array<{
    role: string;
    scopeType: string;
    customRole?: { permissions: unknown } | null;
  }>;
}

function grantsGlobalInvoiceApproval(candidate: InvoiceApprovalCandidate): boolean {
  return candidate.userRoles.some((assignment) => {
    if (assignment.scopeType !== 'global') return false;
    if (BUILT_IN_ROLE_PERMISSIONS[assignment.role]?.includes('invoices:approve')) return true;
    return normalizePermissions(assignment.customRole?.permissions).includes('invoices:approve');
  });
}

function isGlobalAdmin(candidate: InvoiceApprovalCandidate): boolean {
  return candidate.userRoles.some(
    (assignment) => assignment.scopeType === 'global' && assignment.role === 'admin',
  );
}

/**
 * Find a maker-checker fallback without broadening scoped approval permissions.
 * An approver outside the maker's department wins when one exists, then an
 * independent global admin, then another global invoice approver.
 */
export function resolveIndependentInvoiceApprover(
  makerId: string,
  makerDepartmentId: string | null,
  candidates: InvoiceApprovalCandidate[],
): InvoiceApprovalCandidate | null {
  const eligible = candidates.filter(
    (candidate) =>
      candidate.isActive && candidate.id !== makerId && grantsGlobalInvoiceApproval(candidate),
  );

  eligible.sort((left, right) => {
    const leftOutsideGroup =
      makerDepartmentId !== null && left.departmentId !== makerDepartmentId ? 0 : 1;
    const rightOutsideGroup =
      makerDepartmentId !== null && right.departmentId !== makerDepartmentId ? 0 : 1;
    if (leftOutsideGroup !== rightOutsideGroup) return leftOutsideGroup - rightOutsideGroup;

    const leftAdmin = isGlobalAdmin(left) ? 0 : 1;
    const rightAdmin = isGlobalAdmin(right) ? 0 : 1;
    if (leftAdmin !== rightAdmin) return leftAdmin - rightAdmin;

    return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
  });

  return eligible[0] ?? null;
}
