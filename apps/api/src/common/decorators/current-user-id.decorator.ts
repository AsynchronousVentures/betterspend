import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { isDemoModeEnabled } from '../demo-mode';

export function resolveCurrentUserId(req: Request): string {
  if (req.authUser?.id) return req.authUser.id;
  if (!isDemoModeEnabled()) throw new UnauthorizedException('Authentication required');

  const header = req.headers['x-user-id'];
  if (typeof header === 'string' && header) return header;
  if (req.demoUserId) return req.demoUserId;
  throw new UnauthorizedException('Demo administrator is not seeded');
}

export const CurrentUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<Request>();
    return resolveCurrentUserId(req);
  },
);
