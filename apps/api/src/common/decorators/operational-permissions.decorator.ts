import { SetMetadata } from '@nestjs/common';
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

export type OperationalPermissionKey = (typeof OPERATIONAL_PERMISSION_KEYS)[number];

/**
 * Keep new resource keys type-safe until the shared permission catalog carries
 * them. It writes the same metadata consumed by RolesGuard as @Permissions.
 */
export const OperationalPermissions = (...permissions: OperationalPermissionKey[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
