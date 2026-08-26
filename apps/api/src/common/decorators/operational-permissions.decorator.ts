import type { PermissionKey } from '@betterspend/shared';
import { Permissions } from './permissions.decorator';

/**
 * Compatibility name for supplier and operational controllers. These keys now
 * come from the shared catalog and use the same route metadata as every other
 * permission-protected operation.
 */
export const OperationalPermissions = (...permissions: PermissionKey[]) =>
  Permissions(...permissions);
