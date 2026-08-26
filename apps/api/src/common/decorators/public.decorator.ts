import { applyDecorators, SetMetadata } from '@nestjs/common';
import { declareRouteAccess } from './route-access.decorator';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () =>
  applyDecorators(SetMetadata(IS_PUBLIC_KEY, true), declareRouteAccess({ kind: 'public' }));
