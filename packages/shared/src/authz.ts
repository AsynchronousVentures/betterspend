import { z } from 'zod';
import { ROLES, type Role } from './constants';

/** Built-in role values are sourced from the canonical shared role vocabulary. */
export const BUILT_IN_ROLES = [
  ROLES.ADMIN,
  ROLES.APPROVER,
  ROLES.REQUESTER,
  ROLES.RECEIVER,
  ROLES.FINANCE,
] as const satisfies readonly Role[];
export type BuiltInRole = (typeof BUILT_IN_ROLES)[number];

export const SCOPE_TYPES = ['global', 'department', 'project', 'entity'] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];

export const PERMISSION_CATALOG = [
  { key: 'requisitions:create', group: 'Requisitions', label: 'Create requisitions' },
  { key: 'requisitions:view_own', group: 'Requisitions', label: 'View own requisitions' },
  { key: 'requisitions:view_all', group: 'Requisitions', label: 'View all requisitions' },
  { key: 'requisitions:approve', group: 'Requisitions', label: 'Approve requisitions' },
  { key: 'requisitions:manage', group: 'Requisitions', label: 'Manage requisitions' },
  { key: 'purchase_orders:create', group: 'Purchase Orders', label: 'Create purchase orders' },
  { key: 'purchase_orders:view_own', group: 'Purchase Orders', label: 'View own purchase orders' },
  { key: 'purchase_orders:view_all', group: 'Purchase Orders', label: 'View all purchase orders' },
  { key: 'purchase_orders:issue', group: 'Purchase Orders', label: 'Issue purchase orders' },
  { key: 'purchase_orders:manage', group: 'Purchase Orders', label: 'Manage purchase orders' },
  { key: 'receiving:view', group: 'Receiving', label: 'View receipts' },
  { key: 'receiving:create', group: 'Receiving', label: 'Create receipts' },
  { key: 'receiving:manage', group: 'Receiving', label: 'Manage receipts' },
  { key: 'approvals:view', group: 'Approvals', label: 'View approval work' },
  { key: 'approvals:act', group: 'Approvals', label: 'Act on approval work' },
  { key: 'invoices:create', group: 'Invoices', label: 'Create invoices' },
  { key: 'invoices:approve', group: 'Invoices', label: 'Approve invoices' },
  { key: 'invoices:view_all', group: 'Invoices', label: 'View all invoices' },
  { key: 'invoices:manage', group: 'Invoices', label: 'Manage invoices' },
  { key: 'payments:view', group: 'Payments', label: 'View payments' },
  { key: 'payments:manage', group: 'Payments', label: 'Manage payments' },
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

export const BUILT_IN_ROLE_PERMISSIONS: Record<BuiltInRole, readonly PermissionKey[]> = {
  admin: PERMISSION_CATALOG.map((permission) => permission.key),
  approver: [
    'requisitions:view_all',
    'requisitions:approve',
    'purchase_orders:view_all',
    'approvals:view',
    'approvals:act',
    'invoices:view_all',
    'invoices:approve',
    'vendors:view',
    'budgets:view',
    'reports:view',
  ],
  finance: [
    'requisitions:view_all',
    'requisitions:manage',
    'purchase_orders:view_all',
    'purchase_orders:create',
    'purchase_orders:manage',
    'purchase_orders:issue',
    'invoices:create',
    'invoices:manage',
    'invoices:approve',
    'invoices:view_all',
    'payments:view',
    'payments:manage',
    'approvals:view',
    'approvals:act',
    'vendors:view',
    'budgets:view',
    'budgets:manage',
    'reports:view',
    'reports:export',
  ],
  receiver: [
    'purchase_orders:view_all',
    'receiving:view',
    'receiving:create',
    'receiving:manage',
    'vendors:view',
  ],
  requester: [
    'requisitions:create',
    'requisitions:view_own',
    'purchase_orders:view_own',
    'vendors:view',
  ],
};

/**
 * A scoped grant is useful only on resources that carry the corresponding
 * organizational dimension. Callers must ask the access policy for a
 * resource-specific scope instead of treating a scope ID as global.
 */
export const ACCESS_RESOURCE_SCOPE_TYPES = {
  requisition: ['department', 'project', 'entity'],
  purchase_order: ['department', 'project', 'entity'],
  receiving: ['department', 'project', 'entity'],
  approval: ['department', 'project', 'entity'],
  invoice: ['department', 'project', 'entity'],
  payment: ['entity'],
  vendor: ['entity'],
  budget: ['department', 'project', 'entity'],
  report: ['department', 'project', 'entity'],
  settings: ['global'],
  user: ['global'],
} as const satisfies Record<string, readonly ScopeType[]>;

export type AccessResource = keyof typeof ACCESS_RESOURCE_SCOPE_TYPES;

export const builtInRoleSchema = z.enum(BUILT_IN_ROLES);
export const scopeTypeSchema = z.enum(SCOPE_TYPES);
export const permissionKeySchema = z.enum(
  PERMISSION_CATALOG.map((permission) => permission.key) as [PermissionKey, ...PermissionKey[]],
);

/**
 * The only accepted shape for a user-role assignment. The service still
 * checks organization ownership of custom roles and scope targets because
 * those facts live in the database rather than in this input document.
 */
export const userRoleAssignmentSchema = z
  .object({
    role: builtInRoleSchema.optional(),
    customRoleId: z.string().uuid().optional(),
    scopeType: scopeTypeSchema.default('global'),
    scopeId: z.string().uuid().nullable().default(null),
  })
  .superRefine((value, context) => {
    if ((value.role === undefined) === (value.customRoleId === undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['role'],
        message: 'Provide exactly one built-in role or customRoleId',
      });
    }

    if (value.scopeType === 'global' && value.scopeId !== null) {
      context.addIssue({
        code: 'custom',
        path: ['scopeId'],
        message: 'Global assignments cannot include a scopeId',
      });
    }

    if (value.scopeType !== 'global' && value.scopeId === null) {
      context.addIssue({
        code: 'custom',
        path: ['scopeId'],
        message: `${value.scopeType} assignments require a scopeId`,
      });
    }
  });

export type UserRoleAssignmentInput = z.infer<typeof userRoleAssignmentSchema>;

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

export interface AccessScopeDescriptor {
  scopeType: ScopeType;
  scopeId: string | null;
}

/** The safe, serializable document shared with frontend consumers. */
export interface EffectiveAccessDocument {
  user: {
    id: string;
    organizationId: string;
    email: string;
    name: string;
    departmentId: string | null;
    isActive: boolean;
  };
  permissions: PermissionKey[];
  scopes: Partial<Record<PermissionKey, AccessScopeDescriptor[]>>;
}

export interface ResourceScope {
  organizationId: string;
  userId: string;
  unrestricted: boolean;
  ownOnly: boolean;
  departmentIds: string[];
  projectIds: string[];
  entityIds: string[];
}
