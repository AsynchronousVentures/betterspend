export const PERMISSION_CATALOG = [
  { key: 'requisitions:create', group: 'Requisitions', label: 'Create requisitions' },
  { key: 'requisitions:view_own', group: 'Requisitions', label: 'View own requisitions' },
  { key: 'requisitions:view_all', group: 'Requisitions', label: 'View all requisitions' },
  { key: 'requisitions:approve', group: 'Requisitions', label: 'Approve requisitions' },
  { key: 'purchase_orders:create', group: 'Purchase Orders', label: 'Create purchase orders' },
  { key: 'purchase_orders:view_own', group: 'Purchase Orders', label: 'View own purchase orders' },
  { key: 'purchase_orders:view_all', group: 'Purchase Orders', label: 'View all purchase orders' },
  { key: 'purchase_orders:issue', group: 'Purchase Orders', label: 'Issue purchase orders' },
  { key: 'invoices:create', group: 'Invoices', label: 'Create invoices' },
  { key: 'invoices:approve', group: 'Invoices', label: 'Approve invoices' },
  { key: 'invoices:view_all', group: 'Invoices', label: 'View all invoices' },
  { key: 'vendors:create', group: 'Vendors', label: 'Create vendors' },
  { key: 'vendors:edit', group: 'Vendors', label: 'Edit vendors' },
  { key: 'vendors:view', group: 'Vendors', label: 'View vendors' },
  { key: 'budgets:view', group: 'Budgets', label: 'View budgets' },
  { key: 'budgets:manage', group: 'Budgets', label: 'Manage budgets' },
  { key: 'reports:view', group: 'Reports', label: 'View reports' },
  { key: 'reports:export', group: 'Reports', label: 'Export reports' },
  { key: 'settings:manage', group: 'Administration', label: 'Manage workspace settings' },
  { key: 'users:manage', group: 'Administration', label: 'Manage users and roles' },
] as const;

export type PermissionKey = (typeof PERMISSION_CATALOG)[number]['key'];

const KNOWN_PERMISSIONS = new Set<string>(PERMISSION_CATALOG.map((permission) => permission.key));

export const BUILT_IN_ROLE_PERMISSIONS: Record<string, PermissionKey[]> = {
  admin: PERMISSION_CATALOG.map((permission) => permission.key),
  approver: [
    'requisitions:view_all',
    'requisitions:approve',
    'purchase_orders:view_all',
    'invoices:view_all',
    'invoices:approve',
    'vendors:view',
    'budgets:view',
    'reports:view',
  ],
  finance: [
    'requisitions:view_all',
    'purchase_orders:view_all',
    'invoices:create',
    'invoices:approve',
    'invoices:view_all',
    'vendors:view',
    'budgets:view',
    'budgets:manage',
    'reports:view',
    'reports:export',
  ],
  receiver: [
    'purchase_orders:view_all',
    'vendors:view',
  ],
  requester: [
    'requisitions:create',
    'requisitions:view_own',
    'purchase_orders:view_own',
    'vendors:view',
  ],
};

export const ROLE_COMPATIBILITY_PERMISSIONS: Record<string, PermissionKey[]> = {
  admin: ['users:manage', 'settings:manage'],
  approver: ['requisitions:approve', 'invoices:approve'],
  finance: ['invoices:view_all', 'budgets:manage', 'reports:export'],
  receiver: ['purchase_orders:view_all'],
  requester: ['requisitions:create'],
};

export function normalizePermissions(permissions: unknown): PermissionKey[] {
  if (!Array.isArray(permissions)) return [];
  return Array.from(
    new Set(
      permissions
        .filter((permission): permission is string => typeof permission === 'string')
        .filter((permission) => KNOWN_PERMISSIONS.has(permission)),
    ),
  ) as PermissionKey[];
}
