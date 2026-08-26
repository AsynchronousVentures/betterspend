import { applyDecorators } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { declareRouteAccess } from './route-access.decorator';

/** Mark an operation as available to every signed-in BetterSpend user. */
export const Authenticated = () =>
  applyDecorators(ApiBearerAuth(), declareRouteAccess({ kind: 'authenticated' }));
