import { applyDecorators } from '@nestjs/common';
import { ApiSecurity } from '@nestjs/swagger';
import { declareRouteAccess } from './route-access.decorator';

export const Public = () =>
  applyDecorators(ApiSecurity({}), declareRouteAccess({ kind: 'public' }));
