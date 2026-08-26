import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '@betterspend/shared';
import { PERMISSIONS_KEY } from './permissions.decorator';

/** Permission keys introduced for supplier and operational resource families. */
export const OPERATIONAL_PERMISSION_KEYS = [
  'rfqs:view',
  'rfqs:manage',
  'contracts:view',
  'contracts:manage',
  'catalog:view',
  'catalog:manage',
  'inventory:view',
  'inventory:manage',
  'supplier_risk:view',
  'supplier_risk:manage',
  'software_licenses:view',
  'software_licenses:manage',
] as const;

/**
 * The shared catalog will own these values once the authz foundation lands.
 * Keeping PermissionKey in this union makes the metadata contract line up
 * with @Permissions without accepting arbitrary strings at call sites.
 */
export type OperationalPermissionKey = PermissionKey | (typeof OPERATIONAL_PERMISSION_KEYS)[number];

/**
 * Keep new resource keys type-safe until the shared permission catalog carries
 * them. It writes the same metadata consumed by RolesGuard as @Permissions.
 */
export const OperationalPermissions = (...permissions: OperationalPermissionKey[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
