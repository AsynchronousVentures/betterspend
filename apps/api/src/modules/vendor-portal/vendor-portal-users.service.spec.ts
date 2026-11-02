import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import type { Db } from '@betterspend/db';
import { hashVendorPortalPassword } from '@betterspend/db';
import { VendorPortalUsersService } from './vendor-portal-users.service';

type Row = Record<string, unknown>;

/** Minimal chainable stand-in for the drizzle query builder used by the service. */
function createDb(options: { selectRows?: Row[][]; insertRow?: Row; updateRow?: Row }) {
  const selectQueue = [...(options.selectRows ?? [])];
  const calls: { inserts: Row[]; updates: Row[]; deletes: number } = {
    inserts: [],
    updates: [],
    deletes: 0,
  };
  const chain = (result: unknown) => {
    const builder: Record<string, unknown> = {};
    for (const method of ['from', 'innerJoin', 'where', 'orderBy', 'limit', 'set', 'returning']) {
      builder[method] = () => builder;
    }
    builder['then'] = (resolve: (value: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject);
    return builder;
  };
  const db = {
    select: jest.fn(() => chain(selectQueue.shift() ?? [])),
    insert: jest.fn(() => ({
      values: (row: Row) => {
        calls.inserts.push(row);
        return chain([options.insertRow ?? { id: 'created', ...row }]);
      },
    })),
    update: jest.fn(() => ({
      set: (row: Row) => {
        calls.updates.push(row);
        return chain([options.updateRow ?? row]);
      },
    })),
    delete: jest.fn(() => {
      calls.deletes += 1;
      return chain([]);
    }),
  };
  return { db: db as unknown as Db, calls };
}

describe('VendorPortalUsersService', () => {
  const vendorsService = { findOne: jest.fn(async () => ({ id: 'vendor' })) };

  it('authenticates an active login and records the sign-in', async () => {
    const passwordHash = await hashVendorPortalPassword('hunter2hunter2');
    const { db, calls } = createDb({
      selectRows: [
        [
          {
            id: 'user-1',
            organizationId: 'org-1',
            vendorId: 'vendor-1',
            status: 'active',
            passwordHash,
            vendorStatus: 'active',
          },
        ],
      ],
    });
    const service = new VendorPortalUsersService(db, vendorsService as never);

    await expect(service.authenticate(' Billing@Vendor.Test ', 'hunter2hunter2')).resolves.toEqual({
      organizationId: 'org-1',
      vendorId: 'vendor-1',
      portalUserId: 'user-1',
    });
    expect(calls.updates[0]).toHaveProperty('lastLoginAt');
  });

  it('rejects wrong passwords, disabled logins, blocked vendors, and unknown emails alike', async () => {
    const passwordHash = await hashVendorPortalPassword('hunter2hunter2');
    const base = {
      id: 'user-1',
      organizationId: 'org-1',
      vendorId: 'vendor-1',
      status: 'active',
      passwordHash,
      vendorStatus: 'active',
    };
    const cases: Array<[Row[], string]> = [
      [[base], 'wrong-password'],
      [[{ ...base, status: 'disabled' }], 'hunter2hunter2'],
      [[{ ...base, vendorStatus: 'blocked' }], 'hunter2hunter2'],
      [[], 'hunter2hunter2'],
    ];
    for (const [rows, password] of cases) {
      const { db, calls } = createDb({ selectRows: [rows] });
      const service = new VendorPortalUsersService(db, vendorsService as never);
      await expect(service.authenticate('billing@vendor.test', password)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(calls.updates).toHaveLength(0);
    }
  });

  it('creates a login with a normalized email and a hashed password', async () => {
    const { db, calls } = createDb({ selectRows: [[]] });
    const service = new VendorPortalUsersService(db, vendorsService as never);

    await service.create(
      { vendorId: 'vendor-1', email: ' New@Vendor.Test ', password: 'longenough', name: ' Pat ' },
      'org-1',
    );

    expect(vendorsService.findOne).toHaveBeenCalledWith(
      'vendor-1',
      'org-1',
      undefined,
      'vendors:edit',
    );
    const inserted = calls.inserts[0]!;
    expect(inserted).toMatchObject({
      organizationId: 'org-1',
      vendorId: 'vendor-1',
      email: 'new@vendor.test',
      name: 'Pat',
    });
    expect(inserted['passwordHash']).toMatch(/^scrypt\$/);
    expect(inserted['passwordHash']).not.toContain('longenough');
  });

  it('refuses duplicate emails, bad emails, and short passwords', async () => {
    const service = (rows: Row[]) =>
      new VendorPortalUsersService(createDb({ selectRows: [rows] }).db, vendorsService as never);

    await expect(
      service([{ id: 'existing' }]).createForVendor('vendor-1', 'org-1', {
        email: 'dup@vendor.test',
        password: 'longenough',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service([]).createForVendor('vendor-1', 'org-1', { email: 'nope', password: 'longenough' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service([]).createForVendor('vendor-1', 'org-1', {
        email: 'ok@vendor.test',
        password: 'short',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('revokes open sessions when an admin resets a password or disables a login', async () => {
    const { db, calls } = createDb({
      selectRows: [
        [{ id: 'user-1', vendorId: 'vendor-1' }],
        [{ id: 'user-1', vendorId: 'vendor-1' }],
      ],
    });
    const service = new VendorPortalUsersService(db, vendorsService as never);

    await service.resetPassword('user-1', 'freshpassword', 'org-1');
    await service.setStatus('user-1', 'disabled', 'org-1');

    expect(calls.updates.map((row) => Object.keys(row).sort())).toEqual([
      ['passwordHash', 'updatedAt'],
      ['revokedAt'],
      ['status', 'updatedAt'],
      ['revokedAt'],
    ]);
  });
});
