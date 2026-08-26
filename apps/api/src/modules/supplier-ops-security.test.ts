import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Db } from '@betterspend/db';
import type { AccessPolicy } from './auth/access-policy';
import type { AuditService } from './audit/audit.service';
import type { DocumentsService } from './documents/documents.service';
import type { NotificationsService } from './notifications/notifications.service';
import type { EntitiesService } from './entities/entities.service';
import type { SettingsService } from './settings/settings.service';
import type { RequisitionsService } from './requisitions/requisitions.service';
import type { RfqService } from './rfq/rfq.service';
import type { MailService } from '../common/mail/mail.service';
import { CatalogService } from './catalog/catalog.service';
import { ContractsService } from './contracts/contracts.service';
import { SoftwareLicensesService } from './software-licenses/software-licenses.service';
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
    const db = {
      insert: () => {
        insertCalled = true;
        throw new Error('vendorless item escaped scope validation');
      },
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
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({}),
        }),
      }),
      query: {
        catalogItems: {
          findFirst: async () => ({
            id: 'item-1',
            organizationId,
            vendorId: 'vendor-1',
            name: 'Scoped item',
          }),
        },
        catalogPriceProposals: {
          findMany: async () => [],
        },
      },
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
});
