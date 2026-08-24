import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { DEMO_ORG_ID, isDemoModeEnabled } from '../demo-mode';

export function resolveCurrentOrgId(req: Request): string {
  if (req.authUser?.organizationId) return req.authUser.organizationId;
  if (!isDemoModeEnabled()) throw new UnauthorizedException('Authentication required');

  const header = req.headers['x-org-id'];
  return typeof header === 'string' && header ? header : DEMO_ORG_ID;
}

export const CurrentOrgId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<Request>();
    return resolveCurrentOrgId(req);
  },
);
