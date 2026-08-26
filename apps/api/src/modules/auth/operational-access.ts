import {
  and,
  exists,
  inArray,
  sql,
  aliasedTable,
  type AnyColumn,
  type SQL,
  type SQLWrapper,
} from 'drizzle-orm';
import type { Db } from '@betterspend/db';
import { vendors } from '@betterspend/db';
import type { AccessResource, PermissionKey } from '@betterspend/shared';
import type { AccessPolicy } from './access-policy';

/** Resource families owned by the supplier and operational authorization pass. */
export type OperationalResource =
  'rfq' | 'contract' | 'catalog' | 'inventory' | 'supplier_risk' | 'software_license';

export type ScopedVendorResource = OperationalResource | 'vendor';

export function operationalScope(
  access: AccessPolicy | undefined,
  resource: ScopedVendorResource,
  permission: PermissionKey,
) {
  return access?.scopeFor(resource, permission);
}

/** Apply entity scope to a column, preserving the global and empty-scope rules. */
export function scopedEntityPredicate(
  access: AccessPolicy | undefined,
  resource: ScopedVendorResource,
  permission: PermissionKey,
  entityId: SQLWrapper,
): SQL | undefined {
  const scope = operationalScope(access, resource, permission);
  if (!scope || scope.unrestricted) return undefined;
  return scope.entityIds.length > 0 ? inArray(entityId, scope.entityIds) : sql`false`;
}

/**
 * Build the vendor relationship constraint in the same query as the resource
 * read. The correlated subquery avoids authorizing a stale vendor-ID list when
 * a vendor is reassigned between the lookup and the final query.
 */
export function scopedVendorPredicate(
  db: Db,
  organizationId: string,
  access: AccessPolicy | undefined,
  resource: ScopedVendorResource,
  permission: PermissionKey,
  vendorId: AnyColumn,
): SQL | undefined {
  const scope = operationalScope(access, resource, permission);
  if (!scope || scope.unrestricted) return undefined;
  if (scope.entityIds.length === 0) return sql`false`;

  const scopedVendors = aliasedTable(vendors, 'scoped_vendor');
  return exists(
    db
      .select({ id: scopedVendors.id })
      .from(scopedVendors)
      .where(
        and(
          sql`${scopedVendors.id} = ${vendorId}`,
          sql`${scopedVendors.organizationId} = ${organizationId}`,
          scopedEntityPredicate(access, resource, permission, scopedVendors.entityId),
        ),
      ),
  );
}

export function hasUnrestrictedOperationalAccess(
  access: AccessPolicy | undefined,
  resource: OperationalResource,
  permission: PermissionKey,
) {
  return !access || operationalScope(access, resource, permission)?.unrestricted === true;
}
