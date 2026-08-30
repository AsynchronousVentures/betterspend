import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { and, eq, isNull, lte } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  catalogPriceProposals,
  contractClauses,
  contractExtractions,
  contractObligations,
  vendors,
} from '@betterspend/db';
import type { Db } from '@betterspend/db';
import type { AccessPolicy } from './auth/access-policy';
import type { AuditService } from './audit/audit.service';
import type { DocumentsService } from './documents/documents.service';
import type { NotificationsService } from './notifications/notifications.service';
import type { CredentialCryptoService } from './ai-providers/credential-crypto.service';
import type { EntitiesService } from './entities/entities.service';
import type { SettingsService } from './settings/settings.service';
import type { RequisitionsService } from './requisitions/requisitions.service';
import type { RfqService } from './rfq/rfq.service';
import type { MailService } from '../common/mail/mail.service';
import { CatalogService } from './catalog/catalog.service';
import { ContractsService } from './contracts/contracts.service';
import { PunchoutService } from './punchout/punchout.service';
import { SoftwareLicensesService } from './software-licenses/software-licenses.service';
import {
  SupplierScorecardService,
  type ScorecardDatabase,
} from './supplier-scorecard/supplier-scorecard.service';
import { VendorsService } from './vendors/vendors.service';

const organizationId = 'organization-1';

function globalAccess(): AccessPolicy {
  return {
    can: () => true,
    scopeFor: () => ({
      organizationId,
      userId: 'user-1',
      unrestricted: true,
      ownOnly: false,
      departmentIds: [],
      projectIds: [],
      entityIds: [],
    }),
    isGlobalBuiltInAdmin: () => true,
    toDocument: () => ({ permissions: [], scopes: {} }),
  };
}

function entityScopedAccess(): AccessPolicy {
  return {
    can: () => true,
    scopeFor: () => ({
      organizationId,
      userId: 'user-1',
      unrestricted: false,
      ownOnly: false,
      departmentIds: [],
      projectIds: [],
      entityIds: ['entity-1'],
    }),
    isGlobalBuiltInAdmin: () => false,
    toDocument: () => ({ permissions: [], scopes: {} }),
  };
}

describe('supplier operational authorization regressions', () => {
  it('passes the scoped access policy to onboarding questionnaire lookup', async () => {
    const access = globalAccess();
    const db = {
      query: {
        vendors: {
          findFirst: async () => ({
            id: 'vendor-1',
            organizationId,
            name: 'Supplier One',
            entityId: 'entity-1',
          }),
        },
        vendorOnboardingSubmissions: {
          findMany: async () => [],
        },
      },
    } as unknown as Db;
    const service = new VendorsService(db, undefined as unknown as EntitiesService);
    let receivedAccess: AccessPolicy | undefined;
    service.listOnboardingQuestionnaires = async (_organizationId, passedAccess) => {
      receivedAccess = passedAccess;
      return [];
    };

    await service.getOnboardingDetail('vendor-1', organizationId, access);

    assert.equal(receivedAccess, access);
  });

  it('rejects a contract create when its vendor belongs to another organization', async () => {
    let insertCalled = false;
    const transaction = {
      select: () => ({
        from: () => ({
          where: () => ({
            for: async () => [],
          }),
        }),
      }),
      insert: () => {
        insertCalled = true;
        return undefined;
      },
    };
    const db = {
      transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    } as unknown as Db;
    const service = new ContractsService(
      db,
      undefined as unknown as AuditService,
      undefined as unknown as NotificationsService,
      undefined as unknown as DocumentsService,
    );

    await assert.rejects(
      service.create({
        organizationId,
        vendorId: 'vendor-from-another-organization',
        title: 'Cross-tenant contract',
        contractNumber: 'CTR-2026-0001',
        createdBy: 'user-1',
      }),
      (error: unknown) => error instanceof ForbiddenException,
    );
    assert.equal(insertCalled, false);
  });

  it('keeps vendorless catalog items global-only under an entity-scoped grant', async () => {
    let insertCalled = false;
    const transaction = {
      insert: () => {
        insertCalled = true;
        throw new Error('vendorless item escaped scope validation');
      },
    };
    const db = {
      transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    } as unknown as Db;
    const service = new CatalogService(
      db,
      undefined as unknown as MailService,
      undefined as unknown as SettingsService,
    );

    await assert.rejects(
      service.create(
        organizationId,
        { name: 'Internal item', unitPrice: 10 },
        entityScopedAccess(),
      ),
      (error: unknown) => error instanceof ForbiddenException,
    );
    assert.equal(insertCalled, false);
  });

  it('does not update a catalog item after its vendor leaves scope', async () => {
    let updateCalled = false;
    const existing = {
      id: 'item-1',
      organizationId,
      vendorId: 'vendor-1',
      name: 'Scoped item',
    };
    const transaction = {
      select: (selection?: unknown) => ({
        from: () => ({
          where: () => ({
            for: async () =>
              selection === undefined ? [existing] : [{ id: 'vendor-1', entityId: 'entity-1' }],
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => ({
            returning: async () => {
              updateCalled = true;
              return [];
            },
          }),
        }),
      }),
    };
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({}),
        }),
      }),
      transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    } as unknown as Db;
    const service = new CatalogService(
      db,
      undefined as unknown as MailService,
      undefined as unknown as SettingsService,
    );

    await assert.rejects(
      service.update('item-1', organizationId, { name: 'Updated item' }, entityScopedAccess()),
      (error: unknown) => error instanceof NotFoundException,
    );
    assert.equal(updateCalled, true);
  });

  it('locks a license before checking both the current and replacement vendors', async () => {
    const events: string[] = [];
    let vendorChecks = 0;
    let vendorShareLocks = 0;
    const existing = {
      id: 'license-1',
      organizationId,
      vendorId: 'vendor-old',
      productName: 'Supplier platform',
      renewalDate: null,
      status: 'active',
    };
    const updated = { ...existing, vendorId: 'vendor-new' };
    const transaction = {
      select(selection?: unknown) {
        if (selection === undefined) {
          return {
            from: () => ({
              where: () => ({
                for: async () => {
                  events.push('lock-license');
                  return [existing];
                },
              }),
            }),
          };
        }

        return {
          from: () => ({
            where: () => ({
              for: async (lockMode: string) => {
                assert.equal(lockMode, 'share');
                vendorShareLocks += 1;
                vendorChecks += 1;
                events.push(vendorChecks === 1 ? 'check-current-vendor' : 'check-new-vendor');
                return [
                  {
                    id: vendorChecks === 1 ? 'vendor-old' : 'vendor-new',
                    entityId: 'entity-1',
                  },
                ];
              },
            }),
          }),
        };
      },
      update: () => ({
        set: () => ({
          where: () => ({
            returning: async () => {
              events.push('update-license');
              return [updated];
            },
          }),
        }),
      }),
    };
    const db = {
      transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
      query: {
        softwareLicenses: {
          findFirst: async () => {
            events.push('read-updated-license');
            return updated;
          },
        },
      },
      select: () => {
        events.push('outside-transaction-select');
        throw new Error('vendor validation escaped the transaction');
      },
    } as unknown as Db;
    const service = new SoftwareLicensesService(
      db,
      undefined as unknown as NotificationsService,
      undefined as unknown as RequisitionsService,
      undefined as unknown as RfqService,
      undefined as never,
    );

    const result = await service.update(
      'license-1',
      organizationId,
      { vendorId: 'vendor-new' },
      globalAccess(),
    );

    assert.equal(result.vendorId, 'vendor-new');
    assert.equal(vendorShareLocks, 2);
    assert.deepEqual(events, [
      'lock-license',
      'check-current-vendor',
      'check-new-vendor',
      'update-license',
      'read-updated-license',
    ]);
  });

  it('renders the scoped scorecard predicate as valid SQL', async () => {
    let renderedSql = '';
    const db: ScorecardDatabase = {
      execute: async (query: unknown) => {
        renderedSql = new PgDialect().sqlToQuery(query as SQL).sql;
        return [];
      },
    };
    const service = new SupplierScorecardService(db);

    await service.listScores(organizationId, 50, entityScopedAccess());

    assert.match(renderedSql, /v\.status = 'active'\s+AND\s+v\.entity_id in/);
  });

  it('locks the contract before process intelligence writes related rows', async () => {
    const lockedContract = {
      id: 'contract-1',
      organizationId,
      vendorId: 'vendor-1',
      title: 'Supplier agreement',
      description: 'Service agreement',
      internalNotes: null,
      terms: null,
      type: 'service',
      ownerId: 'owner-1',
      createdBy: 'creator-1',
      endDate: null,
      autoRenew: false,
      renewalNoticeDays: null,
      clauses: [],
      obligations: [],
      extractions: [],
      lines: [],
      amendments: [],
      vendor: null,
      owner: null,
      createdByUser: null,
    };
    const insertedTables: unknown[] = [];
    const lockModes: string[] = [];
    const extraction = { id: 'extraction-1' };
    const clause = { id: 'clause-1', clauseType: 'data_security' };
    const obligations = [
      { id: 'obligation-1', ownerId: 'owner-1', dueDate: null, title: 'Insurance review' },
      { id: 'obligation-2', ownerId: 'owner-1', dueDate: null, title: 'Security review' },
    ];
    const transaction = {
      select(selection?: unknown) {
        return {
          from: () => ({
            where: () => ({
              for: async (lockMode: string) => {
                lockModes.push(lockMode);
                return selection === undefined
                  ? [lockedContract]
                  : [{ id: 'vendor-1', entityId: 'entity-1' }];
              },
            }),
          }),
        };
      },
      insert(table: unknown) {
        insertedTables.push(table);
        return {
          values: () => ({
            returning: async () => {
              if (table === contractExtractions) return [extraction];
              if (table === contractClauses) return [clause];
              if (table === contractObligations) return obligations;
              throw new Error('unexpected process intelligence insert');
            },
          }),
        };
      },
    };
    const db = {
      query: {
        contracts: {
          findFirst: async () => lockedContract,
        },
      },
      transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
      insert: () => {
        throw new Error('process intelligence wrote outside its transaction');
      },
    } as unknown as Db;
    const service = new ContractsService(
      db,
      { log: async () => undefined } as unknown as AuditService,
      undefined as unknown as NotificationsService,
      undefined as unknown as DocumentsService,
    );

    await service.processIntelligence(
      'contract-1',
      organizationId,
      'user-1',
      { documentText: 'Data security terms include a certificate of insurance.' },
      globalAccess(),
    );

    assert.deepEqual(lockModes, ['update', 'share', 'share']);
    assert.deepEqual(insertedTables, [contractExtractions, contractClauses, contractObligations]);
  });

  it('applies due catalog proposals only through the caller vendor scope', async () => {
    let renderedSql = '';
    const db = {
      select: () => ({
        from: () => ({
          where: (predicate: SQL) => predicate,
        }),
      }),
      query: {
        catalogPriceProposals: {
          findMany: async (config: {
            where: (table: typeof catalogPriceProposals, operators: unknown) => SQL;
          }) => {
            renderedSql = new PgDialect().sqlToQuery(
              config.where(catalogPriceProposals, { and, eq, isNull, lte }),
            ).sql;
            return [];
          },
        },
      },
    } as unknown as Db;
    const service = new CatalogService(
      db,
      undefined as unknown as MailService,
      undefined as unknown as SettingsService,
    );

    await service.applyDueApprovedProposals(organizationId, entityScopedAccess());

    assert.match(renderedSql, /entity_id/);
  });

  it('passes scoped vendor access into PunchOut setup lookup', async () => {
    let renderedSql = '';
    const db = {
      select: () => ({
        from: () => ({
          where: (predicate: SQL) => predicate,
        }),
      }),
      query: {
        vendors: {
          findFirst: async (config: {
            where: (table: typeof vendors, operators: unknown) => SQL;
          }) => {
            renderedSql = new PgDialect().sqlToQuery(config.where(vendors, { and, eq })).sql;
            return {
              id: 'vendor-1',
              organizationId,
              name: 'Scoped vendor',
              punchoutEnabled: true,
            };
          },
        },
      },
    } as unknown as Db;
    const service = new PunchoutService(
      db,
      { encrypt: (value: string) => value } as CredentialCryptoService,
      { createIdempotent: async () => undefined } as unknown as NotificationsService,
      { log: async () => undefined } as unknown as AuditService,
    );

    await service.handleSetupRequest(
      'vendor-1',
      organizationId,
      {
        header: {
          from: { credential: { identity: 'buyer' } },
          to: { credential: { identity: 'supplier' } },
          sender: { credential: { identity: 'sender' }, userAgent: 'test' },
        },
        buyerCookie: 'cookie-1',
        operation: 'create',
        browserFormPost: { url: 'https://buyer.example/return' },
      },
      entityScopedAccess(),
    );

    assert.match(renderedSql, /entity_id/);
  });
});
