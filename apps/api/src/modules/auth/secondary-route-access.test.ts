import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import type { ExecutionContext, INestApplication } from '@nestjs/common';
import type { Request } from 'express';
import * as schema from '@betterspend/db';
import { createAccessPolicy } from './access-policy';
import { RolesGuard } from './roles.guard';
import { RequisitionTemplatesController } from '../requisition-templates/requisition-templates.controller';
import { RequisitionTemplatesService } from '../requisition-templates/requisition-templates.service';
import { IntakeConciergeController } from '../intake-concierge/intake-concierge.controller';
import { IntakeConciergeService } from '../intake-concierge/intake-concierge.service';
import { RequisitionsService } from '../requisitions/requisitions.service';
import { EmailIntakeController } from '../email-intake/email-intake.controller';
import { EmailIntakeService } from '../email-intake/email-intake.service';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const org = id(1),
  owner = id(2),
  other = id(3),
  department = id(4),
  outside = id(5);
const database = new PGlite();
let app: INestApplication;
let baseUrl: string;
let downstreamCreates = 0;
const policies = {
  owner: createAccessPolicy({ id: owner, organizationId: org }, [
    { role: 'requester', customRoleId: null, scopeType: 'global', scopeId: null },
  ]),
  other: createAccessPolicy({ id: other, organizationId: org }, [
    { role: 'requester', customRoleId: null, scopeType: 'global', scopeId: null },
  ]),
  scoped: createAccessPolicy({ id: owner, organizationId: org }, [
    { role: 'finance', customRoleId: null, scopeType: 'department', scopeId: department },
  ]),
  finance: createAccessPolicy({ id: owner, organizationId: org }, [
    { role: 'finance', customRoleId: null, scopeType: 'global', scopeId: null },
  ]),
  denied: createAccessPolicy({ id: owner, organizationId: org }, []),
  requesterScoped: createAccessPolicy({ id: owner, organizationId: org }, [
    { role: 'requester', customRoleId: null, scopeType: 'department', scopeId: department },
  ]),
};

before(async () => {
  // Use actual Drizzle column types and relational queries; foreign keys are
  // irrelevant to this fixture's permission boundaries.
  for (const table of [
    schema.users,
    schema.requisitions,
    schema.requisitionLines,
    schema.requisitionTemplates,
    schema.intakeConciergeSessions,
    schema.emailIntakeItems,
    schema.auditLog,
  ]) {
    const config = getTableConfig(table);
    const columns = config.columns.map((column) => {
      const type = column.getSQLType();
      const value =
        column.name === 'id'
          ? ' DEFAULT gen_random_uuid()'
          : type.startsWith('timestamp')
            ? ' DEFAULT now()'
            : '';
      return `"${column.name}" ${type}${value}`;
    });
    await database.exec(`CREATE TABLE "${config.name}" (${columns.join(', ')})`);
  }
  await database.exec(`INSERT INTO users (id, organization_id, name, email) VALUES ('${owner}', '${org}', 'Owner', 'owner@example.test');
    INSERT INTO requisitions (id, organization_id, requester_id, department_id, title, currency)
      VALUES ('${id(10)}', '${org}', '${owner}', '${outside}', 'Private request', 'USD');
    INSERT INTO email_intake_items (id, organization_id, status, body) VALUES ('${id(20)}', '${org}', 'pending_review', 'Private mail');
    INSERT INTO intake_concierge_sessions (id, organization_id, requester_id, status, draft, plan)
      VALUES ('${id(30)}', '${org}', '${owner}', 'draft',
      '{"title":"Chairs","neededBy":"2026-10-01","suggestedVendor":"Acme","lines":[{"description":"Chair","quantity":2,"unitPrice":100}]}',
      '{"route":{"workflow":"requisition"},"missingFields":[],"questions":[]}');`);
  const db = drizzle(database, { schema }) as unknown as schema.Db;
  const audit = { log: async () => undefined };
  const requisitions = new RequisitionsService(
    db,
    {} as never,
    {} as never,
    {} as never,
    audit as never,
    {} as never,
    {} as never,
  );
  const concierge = new IntakeConciergeService(
    db,
    {
      parseFromText: () => {
        throw new Error('Unexpected AI call');
      },
    } as never,
    requisitions,
    {
      create: async () => {
        downstreamCreates++;
        return { id: id(40) };
      },
    } as never,
    audit as never,
  );
  const inbox = new EmailIntakeService(db, {} as never, {} as never, {} as never, {} as never);
  // The HTTP fixture supplies a resolved identity; the real RolesGuard and
  // actual domain services enforce permissions and database row scopes.
  // tsx does not emit constructor metadata; supply the real controller DI types.
  Reflect.defineMetadata(
    'design:paramtypes',
    [RequisitionTemplatesService],
    RequisitionTemplatesController,
  );
  Reflect.defineMetadata('design:paramtypes', [IntakeConciergeService], IntakeConciergeController);
  Reflect.defineMetadata('design:paramtypes', [EmailIntakeService], EmailIntakeController);
  const moduleRef = await Test.createTestingModule({
    controllers: [RequisitionTemplatesController, IntakeConciergeController, EmailIntakeController],
    providers: [
      {
        provide: RequisitionTemplatesService,
        useValue: new RequisitionTemplatesService(db, audit as never),
      },
      { provide: IntakeConciergeService, useValue: concierge },
      { provide: EmailIntakeService, useValue: inbox },
      {
        provide: APP_GUARD,
        useValue: {
          canActivate(ctx: ExecutionContext) {
            const request = ctx.switchToHttp().getRequest<Request>();
            const role = request.headers.authorization as keyof typeof policies;
            if (policies[role]) {
              request.authUser = {
                id: role === 'other' ? other : owner,
                organizationId: org,
              } as Request['authUser'];
              request.authAccess = policies[role];
            }
            return true;
          },
        },
      },
      { provide: APP_GUARD, useClass: RolesGuard },
    ],
  }).compile();
  app = moduleRef.createNestApplication({ logger: ['error'] });
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
});
after(async () => {
  await app?.close();
  await database.close();
});

function request(path: string, role: keyof typeof policies, body?: unknown) {
  return fetch(`${baseUrl}/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: role, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('template copies enforce owner and department scope before inserting', async () => {
  const path = `requisition-templates/from-requisition/${id(10)}`;
  for (const role of ['other', 'scoped', 'denied'] as const) {
    assert.equal((await request(path, role, { name: 'copy', isOrgWide: true })).status, 404);
  }
  assert.equal((await database.query('SELECT * FROM requisition_templates')).rows.length, 0);
  const response = await request(path, 'owner', { name: 'copy' });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).templateData.title, 'Private request');
});

test('another requester cannot read, append to, or convert an owner session', async () => {
  const path = `intake/concierge/sessions/${id(30)}`;
  assert.equal((await request(path, 'other')).status, 404);
  assert.equal((await request(`${path}/messages`, 'other', { message: 'change' })).status, 404);
  assert.equal((await request(`${path}/convert`, 'other', { workflow: 'rfq' })).status, 404);
  assert.equal((await request(path, 'owner')).status, 200);
  assert.equal(downstreamCreates, 0);
});

test('conversions enforce target permission and actual requisition scope before writing', async () => {
  const path = `intake/concierge/sessions/${id(30)}/convert`;
  const acceptedValues = { departmentId: outside, supplierShortlist: [id(50)] };
  assert.equal(
    (await request(path, 'denied', { workflow: 'requisition', acceptedValues })).status,
    403,
  );
  assert.equal((await request(path, 'owner', { workflow: 'rfq', acceptedValues })).status, 403);
  assert.equal(
    (await request(path, 'requesterScoped', { workflow: 'requisition', acceptedValues })).status,
    403,
  );
  assert.equal(downstreamCreates, 0);
  assert.equal(
    (await database.query<{ status: string }>('SELECT status FROM intake_concierge_sessions'))
      .rows[0].status,
    'draft',
  );
  assert.equal((await database.query('SELECT * FROM requisitions')).rows.length, 1);
});

test('shared inbox denies requester and scoped access on every user entry point', async () => {
  for (const role of ['owner', 'denied', 'scoped'] as const) {
    assert.equal((await request('email-intake', role)).status, 403);
    assert.equal((await request('email-intake/address', role)).status, 403);
    assert.equal(
      (
        await request('email-intake', role, {
          sourceEmail: 'test@example.test',
          subject: 'test',
          body: 'secret',
        })
      ).status,
      403,
    );
    assert.equal((await request(`email-intake/${id(20)}/discard`, role, {})).status, 403);
  }
  assert.equal(
    (await database.query<{ status: string }>('SELECT status FROM email_intake_items')).rows[0]
      .status,
    'pending_review',
  );
  assert.equal((await database.query('SELECT * FROM audit_log')).rows.length, 0);
  const response = await request('email-intake', 'finance');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).length, 1);
});

test('authorized discard records the actor atomically with mailbox state', async () => {
  const response = await request(`email-intake/${id(20)}/discard`, 'finance', {});
  assert.equal(response.status, 201);
  const audit = (await database.query('SELECT user_id, action FROM audit_log')).rows;
  assert.deepEqual(audit, [{ user_id: owner, action: 'discarded' }]);
  assert.equal(
    (await database.query<{ status: string }>('SELECT status FROM email_intake_items')).rows[0]
      .status,
    'discarded',
  );
});
