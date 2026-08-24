import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { DEMO_USER_ID, isDemoModeEnabled } from '../demo-mode';

export function resolveCurrentUserId(req: Request): string {
  if (req.authUser?.id) return req.authUser.id;
  if (!isDemoModeEnabled()) throw new UnauthorizedException('Authentication required');

  const header = req.headers['x-user-id'];
  return typeof header === 'string' && header ? header : DEMO_USER_ID;
}

export const CurrentUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<Request>();
    return resolveCurrentUserId(req);
  },
);
