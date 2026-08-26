import 'reflect-metadata';
import { METHOD_METADATA, MODULE_METADATA } from '@nestjs/common/constants';
import { APP_GUARD } from '@nestjs/core';
import { PERMISSION_CATALOG, type PermissionKey } from '@betterspend/shared';
import { AppModule } from '../../app.module';
import {
  ROUTE_ACCESS_KEY,
  resolveRouteAccess,
} from '../../common/decorators/route-access.decorator';
import { Authenticated } from '../../common/decorators/authenticated.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { PERMISSION_RESOURCES } from './access-policy';
import { AuthModule } from './auth.module';
import { RolesGuard } from './roles.guard';
import { SessionGuard } from './session.guard';

interface ControllerConstructor {
  readonly prototype: object;
  readonly name: string;
}

interface HttpOperation {
  controller: ControllerConstructor;
  handler: object;
  label: string;
}

/**
 * These resource-level grants are enforced inside their services while their
 * existing HTTP operations remain authenticated-only. Keep the exception list
 * explicit, so a new catalog key cannot become silently unused.
 */
const RESERVED_CATALOG_PERMISSIONS = [
  'requisitions:create',
  'requisitions:view_own',
  'requisitions:view_all',
  'requisitions:approve',
  'requisitions:manage',
  'purchase_orders:create',
  'purchase_orders:view_own',
  'purchase_orders:view_all',
  'purchase_orders:issue',
  'purchase_orders:manage',
  'receiving:view',
  'receiving:create',
  'receiving:manage',
  'approvals:view',
  'approvals:act',
  'invoices:view_all',
  'payments:view',
  'payments:manage',
] as const satisfies readonly PermissionKey[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function moduleTypeOf(value: unknown): ControllerConstructor | undefined {
  if (typeof value === 'function') return value as ControllerConstructor;
  if (!isRecord(value)) return undefined;

  if (typeof value.module === 'function') return value.module as ControllerConstructor;
  if (typeof value.forwardRef === 'function') return moduleTypeOf(value.forwardRef());
  return undefined;
}

function discoverControllers(rootModule: ControllerConstructor): ControllerConstructor[] {
  const controllers = new Set<ControllerConstructor>();
  const visited = new Set<ControllerConstructor>();

  function visit(moduleCandidate: unknown) {
    const moduleType = moduleTypeOf(moduleCandidate);
    if (!moduleType || visited.has(moduleType)) return;
    visited.add(moduleType);

    const moduleControllers = (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, moduleType) ??
      []) as unknown[];
    for (const controller of moduleControllers) {
      if (typeof controller === 'function') controllers.add(controller as ControllerConstructor);
    }

    const imports = (Reflect.getMetadata(MODULE_METADATA.IMPORTS, moduleType) ?? []) as unknown[];
    imports.forEach(visit);
  }

  visit(rootModule);
  return [...controllers];
}

function discoverHttpOperations(rootModule: ControllerConstructor): HttpOperation[] {
  return discoverControllers(rootModule).flatMap((controller) => {
    const prototype = controller.prototype as Record<string, unknown>;
    return Object.getOwnPropertyNames(prototype).flatMap((name) => {
      if (name === 'constructor') return [];
      const handler = prototype[name];
      if (
        typeof handler !== 'function' ||
        Reflect.getMetadata(METHOD_METADATA, handler) === undefined
      ) {
        return [];
      }
      return [{ controller, handler, label: `${controller.name}.${name}` }];
    });
  });
}

function unknownRoutePermissions(operations: readonly HttpOperation[]): string[] {
  const knownPermissions = new Set(PERMISSION_CATALOG.map((permission) => permission.key));
  return operations.flatMap((operation) => {
    const resolution = resolveRouteAccess(operation.handler, operation.controller);
    if (resolution.status !== 'resolved' || resolution.access.kind !== 'permissions') return [];
    return resolution.access.permissions
      .filter((permission) => !knownPermissions.has(permission))
      .map((permission) => `${operation.label}: ${permission}`);
  });
}

function routePermissionKeys(operations: readonly HttpOperation[]): Set<PermissionKey> {
  const permissions = new Set<PermissionKey>();
  for (const operation of operations) {
    const resolution = resolveRouteAccess(operation.handler, operation.controller);
    if (resolution.status !== 'resolved' || resolution.access.kind !== 'permissions') continue;
    resolution.access.permissions.forEach((permission) => permissions.add(permission));
  }
  return permissions;
}

class UnclassifiedController {
  handler() {}
}

class ContradictoryController {
  @Public()
  @Authenticated()
  handler() {}
}

describe('route access inventory', () => {
  const operations = discoverHttpOperations(AppModule);

  it('requires exactly one explicit access classification for every HTTP operation', () => {
    const failures = operations.flatMap((operation) => {
      const resolution = resolveRouteAccess(operation.handler, operation.controller);
      return resolution.status === 'resolved' ? [] : [`${operation.label}: ${resolution.message}`];
    });

    expect(operations.length).toBeGreaterThan(0);
    expect(failures).toEqual([]);
  });

  it('keeps every route permission in the shared catalog', () => {
    expect(unknownRoutePermissions(operations)).toEqual([]);
  });

  it('does not leave catalog permissions orphaned from HTTP access', () => {
    const used = routePermissionKeys(operations);
    const reserved = new Set<PermissionKey>(RESERVED_CATALOG_PERMISSIONS);
    const orphaned = PERMISSION_CATALOG.map((permission) => permission.key).filter(
      (permission) => !used.has(permission) && !reserved.has(permission),
    );

    expect(orphaned).toEqual([]);
  });

  it('keeps the access-policy resource map aligned with the permission catalog', () => {
    const catalogKeys = PERMISSION_CATALOG.map((permission) => permission.key).sort();

    expect(new Set(catalogKeys).size).toBe(catalogKeys.length);
    expect(Object.keys(PERMISSION_RESOURCES).sort()).toEqual(catalogKeys);
  });

  it('registers session resolution then authorization once through APP_GUARD', () => {
    const providers = (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AuthModule) ??
      []) as unknown[];
    const guards = providers.filter(
      (provider): provider is Record<string, unknown> =>
        isRecord(provider) && provider.provide === APP_GUARD,
    );

    expect(guards).toHaveLength(2);
    expect(guards[0]?.useExisting).toBe(SessionGuard);
    expect(guards[1]?.useExisting).toBe(RolesGuard);
  });

  it('reports both missing and contradictory classifications', () => {
    expect(
      resolveRouteAccess(UnclassifiedController.prototype.handler, UnclassifiedController).status,
    ).toBe('missing');
    expect(
      resolveRouteAccess(ContradictoryController.prototype.handler, ContradictoryController).status,
    ).toBe('contradictory');
  });

  it('does not let untyped metadata introduce an unknown permission', () => {
    Reflect.defineMetadata(
      ROUTE_ACCESS_KEY,
      [{ kind: 'permissions', permissions: ['not-a-permission'] }],
      UnclassifiedController.prototype.handler,
    );
    expect(
      unknownRoutePermissions([
        {
          controller: UnclassifiedController,
          handler: UnclassifiedController.prototype.handler,
          label: 'UnclassifiedController.handler',
        },
      ]),
    ).toEqual(['UnclassifiedController.handler: not-a-permission']);
  });
});
