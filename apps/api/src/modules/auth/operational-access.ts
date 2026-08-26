import type { AccessResource, PermissionKey } from '@betterspend/shared';
import type { AccessPolicy } from './access-policy';

/** Resource families owned by the supplier and operational authorization pass. */
export type OperationalResource =
  'rfq' | 'contract' | 'catalog' | 'inventory' | 'supplier_risk' | 'software_license';

/**
 * Keep resource-specific scope calls in one seam while the shared catalog is
 * extended with these resource families. The runtime values are validated by
 * AccessPolicy, and the casts disappear once the shared union contains them.
 */
export function operationalScope(
  access: AccessPolicy | undefined,
  resource: OperationalResource,
  permission: string,
) {
  return access?.scopeFor(resource as AccessResource, permission as PermissionKey);
}

export function requiresGlobalOperationalAccess(
  access: AccessPolicy | undefined,
  resource: OperationalResource,
  permission: string,
) {
  return !access || operationalScope(access, resource, permission)?.unrestricted === true;
}
