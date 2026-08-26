import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import type { PermissionKey } from '../permissions';
import { declareRouteAccess } from './route-access.decorator';

export const PERMISSIONS_KEY = 'permissions';
export const Permissions = (...permissions: PermissionKey[]) => {
  if (permissions.length === 0) throw new Error('Permissions requires at least one permission');
  return applyDecorators(
    SetMetadata(PERMISSIONS_KEY, permissions),
    ApiBearerAuth(),
    declareRouteAccess({ kind: 'permissions', permissions }),
  );
};
