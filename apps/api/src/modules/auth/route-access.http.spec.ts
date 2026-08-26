import { Controller, Get, INestApplication, NotFoundException, Param, Req } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Request } from 'express';
import { AUTH_INSTANCE } from './auth.tokens';
import { AccessPolicyService } from './access-policy';
import { Authenticated } from '../../common/decorators/authenticated.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { DB_TOKEN } from '../../database/database.module';
import { RolesGuard } from './roles.guard';
import { SessionGuard } from './session.guard';

@Controller('route-access-fixture')
class RouteAccessFixtureController {
  @Get('public')
  @Public()
  publicRoute() {
    return { ok: true };
  }

  @Get('authenticated')
  @Authenticated()
  authenticatedRoute() {
    return { ok: true };
  }

  @Get('permission')
  @Permissions('vendors:view')
  permissionRoute() {
    return { ok: true };
  }

  @Get('vendors/:id')
  @Permissions('vendors:view')
  scopedRoute(@Param('id') id: string, @Req() request: Request) {
    const scope = request.authAccess?.scopeFor('vendor', 'vendors:view');
    if (!scope?.unrestricted && !scope?.entityIds.includes(id)) {
      throw new NotFoundException('Vendor not found');
    }
    return { id };
  }
}

function policyFor(userId: string) {
  const canViewVendors = userId !== 'forbidden';
  const scoped = userId === 'scoped';
  return {
    can: jest.fn((permission: string) => permission === 'vendors:view' && canViewVendors),
    scopeFor: jest.fn(() => ({
      organizationId: 'org-1',
      userId,
      unrestricted: !scoped,
      ownOnly: false,
      departmentIds: [],
      projectIds: [],
      entityIds: scoped ? ['vendor-in-scope'] : [],
    })),
    isGlobalBuiltInAdmin: jest.fn(() => false),
    toDocument: jest.fn(() => ({ permissions: [], scopes: {} })),
  };
}

describe('route access HTTP boundary', () => {
  let app: INestApplication;
  let baseUrl: string;
  let currentUserId = 'allowed';
  let selectCount = 0;

  beforeAll(async () => {
    const db = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(async () => {
              selectCount += 1;
              if (selectCount % 2 === 1) {
                return [
                  {
                    id: 'session-1',
                    userId: currentUserId,
                    token: 'fixture-token',
                    expiresAt: new Date(Date.now() + 60_000),
                  },
                ];
              }
              return [
                {
                  id: currentUserId,
                  organizationId: 'org-1',
                  email: `${currentUserId}@example.test`,
                  name: currentUserId,
                  emailVerified: true,
                  isActive: true,
                },
              ];
            }),
          })),
        })),
      })),
    };
    const accessPolicy = {
      resolve: jest.fn(async (user: { id: string }) => ({
        policy: policyFor(user.id),
        assignments: [],
      })),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [RouteAccessFixtureController],
      providers: [
        SessionGuard,
        RolesGuard,
        { provide: AUTH_INSTANCE, useValue: { api: { getSession: jest.fn(async () => null) } } },
        { provide: DB_TOKEN, useValue: db },
        { provide: AccessPolicyService, useValue: accessPolicy },
        { provide: APP_GUARD, useExisting: SessionGuard },
        { provide: APP_GUARD, useExisting: RolesGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(0);
    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP test server');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  async function get(path: string, userId?: string) {
    if (userId) {
      currentUserId = userId;
      selectCount = 0;
    }
    return fetch(`${baseUrl}${path}`, {
      headers: userId ? { authorization: 'Bearer fixture-token' } : undefined,
    });
  }

  it('returns 401 unauthenticated, 403 unauthorized, 404 scoped denial, and 200 permitted', async () => {
    await expect(get('/route-access-fixture/public')).resolves.toMatchObject({ status: 200 });
    await expect(get('/route-access-fixture/authenticated')).resolves.toMatchObject({
      status: 401,
    });
    await expect(get('/route-access-fixture/permission', 'forbidden')).resolves.toMatchObject({
      status: 403,
    });
    await expect(
      get('/route-access-fixture/vendors/vendor-outside', 'scoped'),
    ).resolves.toMatchObject({
      status: 404,
    });
    await expect(
      get('/route-access-fixture/vendors/vendor-in-scope', 'scoped'),
    ).resolves.toMatchObject({
      status: 200,
    });
    await expect(get('/route-access-fixture/permission', 'allowed')).resolves.toMatchObject({
      status: 200,
    });
  });

  it('documents public and protected fixture routes with matching Swagger security', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth().build(),
    );

    expect(document.paths['/route-access-fixture/public']?.get?.security).toEqual([{}]);
    expect(document.paths['/route-access-fixture/authenticated']?.get?.security).toEqual([
      { bearer: [] },
    ]);
    expect(document.paths['/route-access-fixture/permission']?.get?.security).toEqual([
      { bearer: [] },
    ]);
  });
});
