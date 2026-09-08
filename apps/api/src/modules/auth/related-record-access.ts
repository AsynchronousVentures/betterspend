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
    const ownsRecord = record.ownerIds?.some((ownerId) => ownerId === scope.userId);
    if (scope.ownOnly && !ownsRecord) return false;
    if (scope.unrestricted) return true;
    if (
      scope.ownOnly &&
      scope.departmentIds.length + scope.projectIds.length + scope.entityIds.length === 0
    )
      return true;

    return Boolean(
      (record.departmentId && scope.departmentIds.includes(record.departmentId)) ||
      (record.projectId && scope.projectIds.includes(record.projectId)) ||
      (record.entityId && scope.entityIds.includes(record.entityId)),
    );
  });
}
