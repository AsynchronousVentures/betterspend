import { ForbiddenException } from '@nestjs/common';
import { or, sql, type SQL } from 'drizzle-orm';
import type { AccessPolicy } from './access-policy';
import type { AccessResource, PermissionKey, ResourceScope } from '@betterspend/shared';

export interface ScopePredicates {
  own?: (userId: string) => SQL;
  department?: (departmentId: string) => SQL;
  project?: (projectId: string) => SQL;
  entity?: (entityId: string) => SQL;
}

/**
 * Build a database predicate for one or more equivalent permissions. The
 * returned expression is deliberately fail-closed when no grant exists.
 */
export function permissionScopePredicate(
  policy: AccessPolicy | undefined,
  resource: AccessResource,
  permissions: readonly PermissionKey[],
  predicates: ScopePredicates,
): SQL {
  if (!policy) return sql`true`;

  const clauses: SQL[] = [];
  for (const permission of permissions) {
    if (!policy.can(permission)) continue;
    const scope = policy.scopeFor(resource, permission);
    if (scope.unrestricted) return sql`true`;
    clauses.push(...scopeClauses(scope, predicates));
  }

  return clauses.length > 0 ? (or(...clauses) ?? sql`false`) : sql`false`;
}

function scopeClauses(scope: ResourceScope, predicates: ScopePredicates): SQL[] {
  const clauses: SQL[] = [];
  if (scope.ownOnly && predicates.own) clauses.push(predicates.own(scope.userId));
  for (const departmentId of scope.departmentIds) {
    if (predicates.department) clauses.push(predicates.department(departmentId));
  }
  for (const projectId of scope.projectIds) {
    if (predicates.project) clauses.push(predicates.project(projectId));
  }
  for (const entityId of scope.entityIds) {
    if (predicates.entity) clauses.push(predicates.entity(entityId));
  }
  return clauses;
}

export function requirePermission(
  policy: AccessPolicy | undefined,
  permission: PermissionKey,
): void {
  if (policy && !policy.can(permission)) {
    throw new ForbiddenException(`Requires permission: ${permission}`);
  }
}

export function requireAnyPermission(
  policy: AccessPolicy | undefined,
  permissions: readonly PermissionKey[],
): void {
  if (policy && !permissions.some((permission) => policy.can(permission))) {
    throw new ForbiddenException(`Requires one of: ${permissions.join(', ')}`);
  }
}
