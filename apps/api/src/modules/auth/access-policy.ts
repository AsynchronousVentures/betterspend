import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  ACCESS_RESOURCE_SCOPE_TYPES,
  BUILT_IN_ROLE_PERMISSIONS,
  BUILT_IN_ROLES,
  normalizePermissions,
  hasPaymentReleasePermissionConflict,
  type AccessResource,
  type AccessScopeDescriptor,
  type BuiltInRole,
  type EffectiveAccessDocument,
  type PermissionKey,
  type ResourceScope,
  type ScopeType,
} from '@betterspend/shared';
import { customRoles, userRoles, type Db } from '@betterspend/db';
import { DB_TOKEN } from '../../database/database.module';
import type { AuthUser } from '../../auth/auth.instance';

export interface AccessAssignment {
  role: string;
  customRoleId: string | null;
  customRoleOrganizationId?: string | null;
  customPermissions?: unknown;
  scopeType: ScopeType;
  scopeId: string | null;
}

export interface AccessPolicy {
  /** Whether at least one valid assignment grants this permission. */
  can(permission: PermissionKey): boolean;
  /**
   * Returns normalized constraints for a resource. Organization isolation is
   * always part of the result, while unsupported scoped grants are denied.
   */
  scopeFor(resource: AccessResource, permission: PermissionKey): ResourceScope;
  /** Whether a global built-in admin assignment is present. */
  isGlobalBuiltInAdmin(): boolean;
  /** Safe data for the frontend. Assignment and custom-role internals stay private. */
  toDocument(): Pick<EffectiveAccessDocument, 'permissions' | 'scopes'>;
}

type AccessIdentity = Pick<AuthUser, 'id' | 'organizationId'>;

const EMPTY_SCOPE = (identity: AccessIdentity, ownOnly = false): ResourceScope => ({
  organizationId: identity.organizationId,
  userId: identity.id,
  unrestricted: false,
  ownOnly,
  departmentIds: [],
  projectIds: [],
  entityIds: [],
});

function isBuiltInRole(value: string): value is BuiltInRole {
  return (BUILT_IN_ROLES as readonly string[]).includes(value);
}

function isScopeType(value: string): value is ScopeType {
  return (['global', 'department', 'project', 'entity'] as const).includes(value as ScopeType);
}

function scopeKey(scope: AccessScopeDescriptor): string {
  return `${scope.scopeType}:${scope.scopeId ?? ''}`;
}

/** Every catalog permission must have a scoped resource policy. */
export const PERMISSION_RESOURCES = {
  'requisitions:create': 'requisition',
  'requisitions:view_own': 'requisition',
  'requisitions:view_all': 'requisition',
  'requisitions:approve': 'requisition',
  'requisitions:manage': 'requisition',
  'purchase_orders:create': 'purchase_order',
  'purchase_orders:view_own': 'purchase_order',
  'purchase_orders:view_all': 'purchase_order',
  'purchase_orders:issue': 'purchase_order',
  'purchase_orders:manage': 'purchase_order',
  'receiving:view': 'receiving',
  'receiving:create': 'receiving',
  'receiving:manage': 'receiving',
  'approvals:view': 'approval',
  'approvals:act': 'approval',
  'invoices:create': 'invoice',
  'invoices:approve': 'invoice',
  'invoices:view_all': 'invoice',
  'invoices:manage': 'invoice',
  'invoices:review_exceptions': 'invoice',
  'payments:view': 'payment',
  'payments:manage': 'payment',
  'payments:release': 'payment',
  'vendors:create': 'vendor',
  'vendors:edit': 'vendor',
  'vendors:edit_payment_details': 'vendor',
  'vendors:view': 'vendor',
  'rfqs:view': 'rfq',
  'rfqs:manage': 'rfq',
  'contracts:view': 'contract',
  'contracts:manage': 'contract',
  'catalog:view': 'catalog',
  'catalog:manage': 'catalog',
  'inventory:view': 'inventory',
  'inventory:manage': 'inventory',
  'supplier_risk:view': 'supplier_risk',
  'supplier_risk:manage': 'supplier_risk',
  'software_licenses:view': 'software_license',
  'software_licenses:manage': 'software_license',
  'budgets:view': 'budget',
  'budgets:manage': 'budget',
  'reports:view': 'report',
  'reports:export': 'report',
  'settings:manage': 'settings',
  'users:manage': 'user',
} as const satisfies Record<PermissionKey, AccessResource>;

function resourceForPermission(permission: PermissionKey): AccessResource {
  return PERMISSION_RESOURCES[permission];
}

/**
 * Resolve all grants once, then keep role and custom-role knowledge behind a
 * small access-policy interface. This is the seam used by guards now and by
 * resource query adapters in the domain migrations that follow.
 */
export function createAccessPolicy(
  identity: AccessIdentity,
  assignments: readonly AccessAssignment[],
): AccessPolicy {
  const scopesByPermission = new Map<PermissionKey, AccessScopeDescriptor[]>();
  const effectivePermissions = new Set<PermissionKey>();
  let globalBuiltInAdmin = false;

  for (const assignment of assignments) {
    if (!isScopeType(assignment.scopeType)) continue;
    if (assignment.scopeType === 'global' ? assignment.scopeId !== null : !assignment.scopeId) {
      continue;
    }

    let permissions: readonly PermissionKey[];
    if (isBuiltInRole(assignment.role) && assignment.customRoleId === null) {
      permissions = BUILT_IN_ROLE_PERMISSIONS[assignment.role];
    } else if (
      assignment.role === 'custom' &&
      assignment.customRoleId !== null &&
      assignment.customRoleOrganizationId === identity.organizationId
    ) {
      permissions = normalizePermissions(assignment.customPermissions);
    } else {
      // Invalid or cross-organization rows fail closed rather than widening access.
      continue;
    }

    for (const permission of permissions) effectivePermissions.add(permission);

    const descriptor: AccessScopeDescriptor = {
      scopeType: assignment.scopeType,
      scopeId: assignment.scopeId,
    };
    for (const permission of permissions) {
      const resource = resourceForPermission(permission);
      if (
        assignment.scopeType !== 'global' &&
        !(ACCESS_RESOURCE_SCOPE_TYPES[resource] as readonly string[]).includes(assignment.scopeType)
      ) {
        continue;
      }
      const current = scopesByPermission.get(permission) ?? [];
      if (!current.some((scope) => scopeKey(scope) === scopeKey(descriptor))) {
        current.push(descriptor);
        scopesByPermission.set(permission, current);
      }
    }

    if (
      assignment.role === 'admin' &&
      assignment.customRoleId === null &&
      assignment.scopeType === 'global'
    ) {
      globalBuiltInAdmin = true;
    }
  }

  // Bad legacy/custom-role data must never grant both sides of the payment
  // release toxic pair, even before role-management validation can repair it.
  if (hasPaymentReleasePermissionConflict(effectivePermissions)) {
    scopesByPermission.delete('payments:release');
    scopesByPermission.delete('vendors:edit_payment_details');
  }

  const permissions = Array.from(scopesByPermission.keys()).sort();

  return {
    can(permission) {
      return scopesByPermission.has(permission);
    },

    scopeFor(resource, permission) {
      const grants = scopesByPermission.get(permission) ?? [];
      const ownOnly = permission.endsWith(':view_own');
      if (grants.some((grant) => grant.scopeType === 'global')) {
        return {
          ...EMPTY_SCOPE(identity, ownOnly),
          unrestricted: true,
        };
      }

      const supported = new Set<string>(ACCESS_RESOURCE_SCOPE_TYPES[resource]);
      const scopedGrants = grants.filter((grant) => supported.has(grant.scopeType));
      if (scopedGrants.length === 0) return EMPTY_SCOPE(identity, ownOnly);

      return {
        ...EMPTY_SCOPE(identity, ownOnly),
        departmentIds: scopedGrants
          .filter((grant) => grant.scopeType === 'department')
          .map((grant) => grant.scopeId as string),
        projectIds: scopedGrants
          .filter((grant) => grant.scopeType === 'project')
          .map((grant) => grant.scopeId as string),
        entityIds: scopedGrants
          .filter((grant) => grant.scopeType === 'entity')
          .map((grant) => grant.scopeId as string),
      };
    },

    isGlobalBuiltInAdmin() {
      return globalBuiltInAdmin;
    },

    toDocument() {
      const scopes: Partial<Record<PermissionKey, AccessScopeDescriptor[]>> = {};
      for (const permission of permissions) {
        scopes[permission] = (scopesByPermission.get(permission) ?? []).map((scope) => ({
          ...scope,
        }));
      }
      return { permissions, scopes };
    },
  };
}

export interface ResolvedAccess {
  policy: AccessPolicy;
  assignments: AccessAssignment[];
}

@Injectable()
export class AccessPolicyService {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  async resolve(user: AccessIdentity): Promise<ResolvedAccess> {
    const rows = await this.db
      .select({
        role: userRoles,
        customRole: customRoles,
      })
      .from(userRoles)
      .leftJoin(
        customRoles,
        and(
          eq(userRoles.customRoleId, customRoles.id),
          eq(customRoles.organizationId, user.organizationId),
        ),
      )
      .where(eq(userRoles.userId, user.id));

    const assignments = rows.map(({ role, customRole }): AccessAssignment => ({
      role: role.role,
      customRoleId: role.customRoleId,
      customRoleOrganizationId: customRole?.organizationId ?? null,
      customPermissions: customRole?.permissions,
      scopeType: role.scopeType as ScopeType,
      scopeId: role.scopeId,
    }));

    return {
      policy: createAccessPolicy(user, assignments),
      assignments,
    };
  }
}
