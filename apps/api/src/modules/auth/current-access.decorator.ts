import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AccessPolicy } from './access-policy';

export const CurrentAccess = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AccessPolicy | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.authAccess;
  },
);
