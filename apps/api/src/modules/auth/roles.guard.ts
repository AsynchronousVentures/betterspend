import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { resolveRouteAccess } from '../../common/decorators/route-access.decorator';
import { isDemoModeEnabled } from '../../common/demo-mode';

@Injectable()
export class RolesGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const routeAccess = resolveRouteAccess(ctx.getHandler(), ctx.getClass());
    if (routeAccess.status !== 'resolved') throw new ForbiddenException(routeAccess.message);
    if (routeAccess.access.kind === 'public') return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const { authUser, authAccess } = req;

    if (!authUser || !authAccess) {
      if (isDemoModeEnabled()) return true;
      throw new UnauthorizedException('Authentication required');
    }

    if (routeAccess.access.kind === 'permissions') {
      const hasPermissions = routeAccess.access.permissions.every((permission) =>
        authAccess.can(permission),
      );
      if (!hasPermissions) {
        throw new ForbiddenException(
          `Requires permissions: ${routeAccess.access.permissions.join(', ')}`,
        );
      }
      return true;
    }
    return true;
  }
}
