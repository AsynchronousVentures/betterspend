import type { AccessResource, PermissionKey } from '@betterspend/shared';
import type { AccessPolicy } from './access-policy';

export interface RelatedRecordScope {
  ownerIds?: readonly (string | null | undefined)[];
  departmentId?: string | null;
  projectId?: string | null;
  entityId?: string | null;
}

/**
 * Related-record summaries must satisfy the target resource's own policy,
 * rather than inheriting access from the detail page that happens to reference it.
 */
export function canViewRelatedRecord(
  access: AccessPolicy | undefined,
  resource: AccessResource,
  permissions: readonly PermissionKey[],
  record: RelatedRecordScope,
): boolean {
  if (!access) return true;

  return permissions.some((permission) => {
    if (!access.can(permission)) return false;

    const scope = access.scopeFor(resource, permission);
    if (scope.unrestricted) return true;

    return Boolean(
      (scope.ownOnly && record.ownerIds?.some((ownerId) => ownerId === scope.userId)) ||
        (record.departmentId && scope.departmentIds.includes(record.departmentId)) ||
        (record.projectId && scope.projectIds.includes(record.projectId)) ||
        (record.entityId && scope.entityIds.includes(record.entityId)),
    );
  });
}
