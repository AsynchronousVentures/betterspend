import type { PermissionKey } from '@betterspend/shared';

export const ROUTE_ACCESS_KEY = 'routeAccess';

export type RouteAccess =
  | { readonly kind: 'public' }
  | { readonly kind: 'authenticated' }
  | { readonly kind: 'permissions'; readonly permissions: readonly PermissionKey[] };

export type RouteAccessResolution =
  | { readonly status: 'resolved'; readonly access: RouteAccess }
  | { readonly status: 'missing'; readonly message: string }
  | { readonly status: 'contradictory'; readonly message: string }
  | { readonly status: 'invalid'; readonly message: string };

type RouteAccessDecorator = ClassDecorator & MethodDecorator;

function isRouteAccess(value: unknown): value is RouteAccess {
  if (!value || typeof value !== 'object' || !('kind' in value)) return false;
  if (value.kind === 'public' || value.kind === 'authenticated') return true;
  return (
    value.kind === 'permissions' &&
    'permissions' in value &&
    Array.isArray(value.permissions) &&
    value.permissions.length > 0 &&
    value.permissions.every((permission) => typeof permission === 'string')
  );
}

function declarationsFor(target: object): unknown[] {
  const declarations = Reflect.getOwnMetadata(ROUTE_ACCESS_KEY, target);
  return Array.isArray(declarations) ? declarations : [];
}

/**
 * Records a route's access classification separately from its enforcement
 * metadata so class-level defaults can be overridden by a method safely.
 */
export function declareRouteAccess(access: RouteAccess): RouteAccessDecorator {
  return ((target: object, _propertyKey?: string | symbol, descriptor?: PropertyDescriptor) => {
    const metadataTarget =
      descriptor && typeof descriptor.value === 'function' ? descriptor.value : target;
    Reflect.defineMetadata(
      ROUTE_ACCESS_KEY,
      [...declarationsFor(metadataTarget), access],
      metadataTarget,
    );
  }) as RouteAccessDecorator;
}

/** Resolve the effective route classification using Nest's method-over-class precedence. */
export function resolveRouteAccess(handler: Function, controller: Function): RouteAccessResolution {
  const declarations = declarationsFor(handler);
  const effectiveDeclarations = declarations.length > 0 ? declarations : declarationsFor(controller);

  if (effectiveDeclarations.length === 0) {
    return {
      status: 'missing',
      message: 'Route access classification is required',
    };
  }

  if (effectiveDeclarations.length !== 1) {
    return {
      status: 'contradictory',
      message: 'Route has contradictory access classifications',
    };
  }

  const [access] = effectiveDeclarations;
  if (!isRouteAccess(access)) {
    return {
      status: 'invalid',
      message: 'Route has an invalid access classification',
    };
  }

  return { status: 'resolved', access };
}
