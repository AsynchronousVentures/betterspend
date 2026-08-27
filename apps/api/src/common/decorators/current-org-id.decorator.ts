import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { isDemoModeEnabled } from '../demo-mode';

export function resolveCurrentOrgId(req: Request): string {
  if (req.authUser?.organizationId) return req.authUser.organizationId;
  if (!isDemoModeEnabled()) throw new UnauthorizedException('Authentication required');

  const header = req.headers['x-org-id'];
  if (typeof header === 'string' && header) return header;
  if (req.demoOrganizationId) return req.demoOrganizationId;
  throw new UnauthorizedException('Demo organization is not seeded');
}

export const CurrentOrgId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<Request>();
    return resolveCurrentOrgId(req);
  },
);
