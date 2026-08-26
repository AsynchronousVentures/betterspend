import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { ROLES_KEY, UserRole } from '../../common/decorators/roles.decorator';
import { BUILT_IN_ROLE_PERMISSIONS, type PermissionKey } from '../../common/permissions';
import { isDemoModeEnabled } from '../../common/demo-mode';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    const requiredPermissions = this.reflector.getAllAndOverride<PermissionKey[]>(PERMISSIONS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    // Authentication is SessionGuard's responsibility when no authorization metadata is present.
    if (
      (!requiredRoles || requiredRoles.length === 0) &&
      (!requiredPermissions || requiredPermissions.length === 0)
    ) {
      return true;
    }

    const req = ctx.switchToHttp().getRequest<Request>();
    const { authUser, authAccess } = req;

    if (!authUser || !authAccess) {
      if (isDemoModeEnabled()) return true;
      throw new UnauthorizedException('Authentication required');
    }

    if (requiredPermissions?.length) {
      const hasPermissions = requiredPermissions.every((permission) => authAccess.can(permission));
      if (!hasPermissions) {
        throw new ForbiddenException(`Requires permissions: ${requiredPermissions.join(', ')}`);
      }
      return true;
    }

    // Legacy @Roles metadata is translated through effective permissions. The
    // admin compatibility path is limited to a global built-in admin assignment,
    // so scoped and custom grants never receive a global bypass.
    const hasRole = requiredRoles.some((required) => {
      if (required === 'admin') {
        return authAccess.isGlobalBuiltInAdmin();
      }
      return BUILT_IN_ROLE_PERMISSIONS[required].every((permission) => authAccess.can(permission));
    });

    if (!hasRole) {
      throw new ForbiddenException(`Requires one of: ${requiredRoles.join(', ')}`);
    }

    return true;
  }
}
