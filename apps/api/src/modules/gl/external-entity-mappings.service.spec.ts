import { PgDialect } from 'drizzle-orm/pg-core';
import * as dbModule from '@betterspend/db';
import { ExternalEntityMappingsService } from './external-entity-mappings.service';

type MappingRow = Record<string, unknown>;

function database(rows: MappingRow[]) {
  for (const row of rows) {
    if (row.provider === 'qbo') {
      row.connectionId ??= 'connection-1';
      row.realmId ??= 'realm-1';
    }
  }
  const updates: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  const locks: unknown[] = [];
  const column = new Proxy({} as Record<string, string>, {
    get: (_target, property) => String(property),
  });
  const whereMatches = (where: unknown, row: MappingRow) => {
    if (typeof where !== 'function') return true;
    const operators = {
      and: (...conditions: unknown[]) => conditions.every(Boolean),
      eq: (left: unknown, right: unknown) => row[String(left)] === right,
      ne: (left: unknown, right: unknown) => row[String(left)] !== right,
      inArray: (left: unknown, values: unknown[]) => values.includes(row[String(left)]),
      isNotNull: (left: unknown) => row[String(left)] !== null,
    };
    return Boolean(where(column, operators));
  };
  type FakeDb = {
    query: {
      externalEntityMappings: {
        findFirst: jest.Mock;
        findMany: jest.Mock;
      };
      integrationConnections: { findFirst: jest.Mock };
      vendors: { findFirst: jest.Mock };
      departments: { findFirst: jest.Mock };
      projects: { findFirst: jest.Mock };
      taxCodes: { findFirst: jest.Mock };
    };
    transaction: jest.Mock;
    select: jest.Mock;
    update: jest.Mock;
    insert: jest.Mock;
    execute: jest.Mock;
  };
  const db = {} as FakeDb;
  db.query = {
    externalEntityMappings: {
      findFirst: jest.fn(
        async ({ where }: { where?: unknown }) =>
          rows.find((row) => whereMatches(where, row)) ?? null,
      ),
      findMany: jest.fn(async ({ where }: { where?: unknown }) =>
        rows.filter((row) => whereMatches(where, row)),
      ),
    },
    integrationConnections: {
      findFirst: jest.fn(async () => ({ id: 'connection-1', realmId: 'realm-1' })),
    },
    vendors: { findFirst: jest.fn(async () => ({ id: 'vendor' })) },
    departments: { findFirst: jest.fn(async () => ({ id: 'department' })) },
    projects: { findFirst: jest.fn(async () => ({ id: 'project' })) },
    taxCodes: { findFirst: jest.fn(async () => ({ id: 'tax-code' })) },
  };
  db.transaction = jest.fn(async (callback: (transaction: unknown) => Promise<unknown>) =>
    callback(db),
  );
  db.select = jest.fn(() => {
    const query = {
      from: jest.fn(),
      where: jest.fn(),
      for: jest.fn(),
      limit: jest.fn(async () => [{ id: 'local' }]),
    };
    query.from.mockReturnValue(query);
    query.where.mockReturnValue(query);
    query.for.mockReturnValue(query);
    return query;
  });
  db.update = jest.fn(() => ({
    set: jest.fn((values: Record<string, unknown>) => {
      updates.push(values);
      return {
        where: jest.fn(() => ({
          returning: jest.fn(async () => [{ ...rows[0], ...values }]),
        })),
      };
    }),
  }));
  db.insert = jest.fn(() => ({
    values: jest.fn(async (values: Record<string, unknown>) => {
      audits.push(values);
    }),
  }));
  db.execute = jest.fn(async (query: unknown) => {
    locks.push(query);
    return [];
  });
  return { db, updates, audits, locks };
}

describe('ExternalEntityMappingsService', () => {
  beforeEach(() => {
    jest.spyOn(dbModule, 'appendAuditLog').mockImplementation(async (transaction, input) => {
      await (transaction as never as { insert: jest.Mock }).insert(null).values(input);
      return undefined as never;
    });
  });

  it('resolves only an active, non-deleted link in the requested organization', async () => {
    const harness = database([
      {
        id: 'other-org',
        organizationId: 'organization-2',
        provider: 'qbo',
        direction: 'inbound',
        externalEntity: 'Account',
        localEntity: 'gl_account',
        localKey: '6100',
        externalId: 'qbo-other',
        isActive: true,
        isDeleted: false,
      },
      {
        id: 'inactive',
        organizationId: 'organization-1',
        provider: 'qbo',
        direction: 'inbound',
        externalEntity: 'Account',
        localEntity: 'gl_account',
        localKey: '6100',
        externalId: 'qbo-inactive',
        isActive: false,
        isDeleted: false,
      },
      {
        id: 'deleted',
        organizationId: 'organization-1',
        provider: 'qbo',
        direction: 'inbound',
        externalEntity: 'Account',
        localEntity: 'gl_account',
        localKey: '6100',
        externalId: 'qbo-deleted',
        isActive: true,
        isDeleted: true,
      },
      {
        id: 'linked',
        organizationId: 'organization-1',
        provider: 'qbo',
        direction: 'inbound',
        externalEntity: 'Account',
        localEntity: 'gl_account',
        localKey: '6100',
        externalId: 'qbo-linked',
        displayName: 'Travel',
        isActive: true,
        isDeleted: false,
      },
    ]);
    const service = new ExternalEntityMappingsService(harness.db as never);

    await expect(
      service.resolve({
        organizationId: 'organization-1',
        provider: 'qbo',
        direction: 'inbound',
        externalEntity: 'Account',
        localEntity: 'gl_account',
        localId: '6100',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'linked',
        externalId: 'qbo-linked',
        displayName: 'Travel',
        source: 'linked',
      }),
    );
  });

  it('resolves multiple GL account identities in one batch', async () => {
    const harness = database([
      {
        id: 'travel-account',
        organizationId: 'organization-1',
        provider: 'qbo',
        direction: 'inbound',
        externalEntity: 'Account',
        localEntity: 'gl_account',
        localId: null,
        localKey: '6100',
        externalId: 'qbo-travel',
        displayName: 'Travel',
        isActive: true,
        isDeleted: false,
      },
      {
        id: 'software-account',
        organizationId: 'organization-1',
        provider: 'qbo',
        direction: 'inbound',
        externalEntity: 'Account',
        localEntity: 'gl_account',
        localId: null,
        localKey: '6200',
        externalId: 'qbo-software',
        displayName: 'Software',
        isActive: true,
        isDeleted: false,
      },
    ]);
    const service = new ExternalEntityMappingsService(harness.db as never);

    await expect(
      service.resolveMany({
        organizationId: 'organization-1',
        provider: 'qbo',
        direction: 'inbound',
        externalEntity: 'Account',
        localEntity: 'gl_account',
        localIds: ['6100', '6200'],
      }),
    ).resolves.toEqual(
      new Map([
        ['6100', expect.objectContaining({ id: 'travel-account', externalId: 'qbo-travel' })],
        ['6200', expect.objectContaining({ id: 'software-account', externalId: 'qbo-software' })],
      ]),
    );
    expect(harness.db.query.externalEntityMappings.findMany).toHaveBeenCalledTimes(1);
  });

  it('falls back to one active default when a local department has no link', async () => {
    const harness = database([
      {
        id: 'outbound-default-class',
        organizationId: 'organization-1',
        provider: 'qbo',
        direction: 'outbound',
        externalEntity: 'Class',
        localEntity: 'department',
        localId: null,
        externalId: 'class-outbound',
        displayName: 'Outbound Operations',
        isDefault: true,
        isActive: true,
        isDeleted: false,
      },
      {
        id: 'default-class',
        organizationId: 'organization-1',
        provider: 'qbo',
        direction: 'inbound',
        externalEntity: 'Class',
        localEntity: 'department',
        localId: null,
        externalId: 'class-1',
        displayName: 'Operations',
        isDefault: true,
        isActive: true,
        isDeleted: false,
      },
    ]);
    const service = new ExternalEntityMappingsService(harness.db as never);

    await expect(
      service.resolve({
        organizationId: 'organization-1',
        provider: 'qbo',
        direction: 'inbound',
        externalEntity: 'Class',
        localEntity: 'department',
        localId: '00000000-0000-4000-8000-000000000002',
        fallbackToDefault: true,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'default-class',
        externalId: 'class-1',
        displayName: 'Operations',
        source: 'default',
      }),
    );
  });

  it('rejects staged rows without provider identity before mutation or audit', async () => {
    const harness = database([
      {
        id: 'staged-account',
        organizationId: 'organization-1',
        provider: 'qbo',
        direction: 'inbound',
        externalEntity: 'Account',
        localEntity: 'gl_account',
        localId: null,
        externalId: null,
        isActive: true,
        isDeleted: false,
      },
    ]);
    const service = new ExternalEntityMappingsService(harness.db as never);

    await expect(
      service.replaceLink({
        mappingId: 'staged-account',
        organizationId: 'organization-1',
        provider: 'qbo',
        direction: 'inbound',
        localId: '6100',
      }),
    ).rejects.toThrow('external provider ID');
    expect(harness.updates).toHaveLength(0);
    expect(harness.audits).toHaveLength(0);
  });

  it('stores GL account codes in local_key and serializes them as localId', async () => {
    const harness = database([
      {
        id: 'gl-account',
        organizationId: 'organization-1',
        provider: 'qbo',
        direction: 'inbound',
        externalEntity: 'Account',
        localEntity: 'gl_account',
        localId: null,
        localKey: null,
        externalId: 'qbo-account-1',
        autoCreated: false,
        isDefault: false,
        isActive: true,
        isDeleted: false,
      },
    ]);
    const service = new ExternalEntityMappingsService(harness.db as never);

    const result = await service.replaceLink({
      mappingId: 'gl-account',
      organizationId: 'organization-1',
      provider: 'qbo',
      direction: 'inbound',
      localId: '6100',
    });

    expect(harness.updates).toEqual([expect.objectContaining({ localId: null, localKey: '6100' })]);
    expect(result.localId).toBe('6100');
    expect(result).not.toHaveProperty('localKey');
    const lockQueries = harness.locks.map((query) => new PgDialect().sqlToQuery(query as never));
    expect(lockQueries).toHaveLength(3);
    expect(lockQueries.every((query) => query.sql.includes('pg_advisory_xact_lock'))).toBe(true);
  });

  it('clears a persisted department default when a local identity is supplied without isDefault', async () => {
    const harness = database([
      {
        id: 'default-class',
        organizationId: 'organization-1',
        provider: 'qbo',
        direction: 'inbound',
        externalEntity: 'Class',
        localEntity: 'department',
        localId: null,
        localKey: null,
        externalId: 'qbo-class-1',
        autoCreated: false,
        isDefault: true,
        isActive: true,
        isDeleted: false,
      },
    ]);
    const service = new ExternalEntityMappingsService(harness.db as never);

    await expect(
      service.replaceLink({
        mappingId: 'default-class',
        organizationId: 'organization-1',
        provider: 'qbo',
        direction: 'inbound',
        localId: '00000000-0000-4000-8000-000000000003',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        localId: '00000000-0000-4000-8000-000000000003',
        isDefault: false,
      }),
    );
    expect(harness.updates).toEqual([
      expect.objectContaining({
        localId: '00000000-0000-4000-8000-000000000003',
        localKey: null,
        isDefault: false,
      }),
    ]);
  });

  it('rejects only an explicit default when a local identity is supplied', async () => {
    const harness = database([
      {
        id: 'account',
        organizationId: 'organization-1',
        provider: 'qbo',
        direction: 'inbound',
        externalEntity: 'Account',
        localEntity: 'gl_account',
        localId: null,
        localKey: null,
        externalId: 'qbo-account-1',
        autoCreated: false,
        isDefault: false,
        isActive: true,
        isDeleted: false,
      },
    ]);
    const service = new ExternalEntityMappingsService(harness.db as never);

    await expect(
      service.replaceLink({
        mappingId: 'account',
        organizationId: 'organization-1',
        provider: 'qbo',
        direction: 'inbound',
        localId: '6100',
        isDefault: true,
      }),
    ).rejects.toThrow('Default mappings cannot be linked to a local record');
    expect(harness.updates).toHaveLength(0);
  });

  it('replaces an existing department default under the same serialized lock', async () => {
    const harness = database([
      {
        id: 'new-class',
        organizationId: 'organization-1',
        provider: 'qbo',
        direction: 'inbound',
        externalEntity: 'Class',
        localEntity: 'department',
        localId: null,
        localKey: null,
        externalId: 'qbo-class-new',
        autoCreated: false,
        isDefault: false,
        isActive: true,
        isDeleted: false,
      },
      {
        id: 'old-class',
        organizationId: 'organization-1',
        provider: 'qbo',
        direction: 'inbound',
        externalEntity: 'Class',
        localEntity: 'department',
        localId: null,
        localKey: null,
        externalId: 'qbo-class-old',
        autoCreated: false,
        isDefault: true,
        isActive: true,
        isDeleted: false,
      },
    ]);
    const service = new ExternalEntityMappingsService(harness.db as never);

    await service.replaceLink({
      mappingId: 'new-class',
      organizationId: 'organization-1',
      provider: 'qbo',
      direction: 'inbound',
      localId: null,
      isDefault: true,
      userId: 'user-1',
    });

    expect(harness.updates).toEqual([
      expect.objectContaining({ isDefault: false }),
      expect.objectContaining({ localId: null, localKey: null, isDefault: true }),
    ]);
    expect(harness.audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityId: 'old-class', action: 'default_cleared' }),
        expect.objectContaining({ entityId: 'new-class', action: 'default_set' }),
      ]),
    );
  });

  it('rejects non-UUID identifiers for UUID-backed local entities before mutation', async () => {
    const harness = database([
      {
        id: 'vendor-link',
        organizationId: 'organization-1',
        provider: 'qbo',
        direction: 'inbound',
        externalEntity: 'Vendor',
        localEntity: 'vendor',
        localId: null,
        localKey: null,
        externalId: 'qbo-vendor-1',
        isActive: true,
        isDeleted: false,
      },
    ]);
    const service = new ExternalEntityMappingsService(harness.db as never);

    await expect(
      service.replaceLink({
        mappingId: 'vendor-link',
        organizationId: 'organization-1',
        provider: 'qbo',
        direction: 'inbound',
        localId: '6100',
      }),
    ).rejects.toThrow('valid local record');
    expect(harness.updates).toHaveLength(0);
    expect(harness.audits).toHaveLength(0);
  });

  it('replaces an existing local link atomically and audits both sides', async () => {
    const harness = database([
      {
        id: 'new-link',
        organizationId: 'organization-1',
        provider: 'qbo',
        direction: 'inbound',
        externalEntity: 'Account',
        localEntity: 'gl_account',
        localId: null,
        externalId: 'qbo-new',
        autoCreated: false,
        isDefault: false,
        isActive: true,
        isDeleted: false,
      },
      {
        id: 'old-link',
        organizationId: 'organization-1',
        provider: 'qbo',
        direction: 'inbound',
        externalEntity: 'Account',
        localEntity: 'gl_account',
        localKey: '6100',
        externalId: 'qbo-old',
        autoCreated: false,
        isDefault: false,
        isActive: true,
        isDeleted: false,
      },
      {
        id: 'old-link-duplicate',
        organizationId: 'organization-1',
        provider: 'qbo',
        direction: 'inbound',
        externalEntity: 'Account',
        localEntity: 'gl_account',
        localKey: '6100',
        externalId: 'qbo-old-duplicate',
        autoCreated: false,
        isDefault: false,
        isActive: true,
        isDeleted: false,
      },
    ]);
    const service = new ExternalEntityMappingsService(harness.db as never);

    await service.replaceLink({
      mappingId: 'new-link',
      organizationId: 'organization-1',
      provider: 'qbo',
      direction: 'inbound',
      localId: '6100',
      userId: 'user-1',
    });

    expect(harness.db.transaction).toHaveBeenCalledTimes(1);
    expect(harness.updates).toEqual([
      expect.objectContaining({ localId: null, localKey: null, isDefault: false }),
      expect.objectContaining({ localId: null, localKey: null, isDefault: false }),
      expect.objectContaining({ localId: null, localKey: '6100', isDefault: false }),
    ]);
    expect(harness.audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityId: 'old-link', action: 'unlinked' }),
        expect.objectContaining({ entityId: 'old-link-duplicate', action: 'unlinked' }),
        expect.objectContaining({ entityId: 'new-link', action: 'linked' }),
      ]),
    );
  });
});
