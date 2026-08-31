import assert from 'node:assert/strict';
import test from 'node:test';
import { and, eq } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { spendGuardAlerts } from '@betterspend/db';
import { SpendGuardService } from './spend-guard.service';

const scope = {
  organizationId: 'org-1',
  userId: 'user-1',
  unrestricted: false,
  ownOnly: false,
  departmentIds: ['department-1'],
  projectIds: [],
  entityIds: [],
};

function createService(db: Record<string, unknown>) {
  const transactionalDb = {
    ...db,
    transaction: async (callback: (tx: Record<string, unknown>) => Promise<unknown>) =>
      callback(db),
  };
  return new SpendGuardService(
    transactionalDb as never,
    { recordSpendGuardReviewSignal: async () => undefined } as never,
    undefined,
  );
}

test('scoped alert reads fail closed before loading unrestricted rows', async () => {
  const queries: unknown[] = [];
  let findManyCalled = false;
  const service = createService({
    query: {
      spendGuardAlerts: {
        findMany: async (options: {
          where: (
            alert: typeof spendGuardAlerts,
            operators: { and: typeof and; eq: typeof eq },
          ) => unknown;
        }) => {
          findManyCalled = true;
          queries.push(options.where(spendGuardAlerts, { and, eq }));
          return [];
        },
      },
    },
  });

  const alerts = await service.list('org-1', 'open', scope);

  assert.deepEqual(alerts, []);
  assert.equal(findManyCalled, true);
  const query = new PgDialect().sqlToQuery(queries[0] as never);
  assert.match(query.sql, /SELECT a\.id/);
  assert.match(query.sql, /record_type/);
  assert.ok(query.params.includes('department-1'));
});

test('scoped alert mutations reject records outside the granted scope', async () => {
  const queries: unknown[] = [];
  const service = createService({
    update: () => {
      return {
        set: () => ({
          where: (condition: unknown) => {
            queries.push(condition);
            return { returning: async () => [] };
          },
        }),
      };
    },
  });

  await assert.rejects(
    service.updateStatus('alert-outside-scope', 'org-1', 'user-1', 'dismissed', undefined, scope),
    /not found/,
  );
  const query = new PgDialect().sqlToQuery(queries[0] as never);
  assert.match(query.sql, /SELECT a\.id/);
  assert.match(query.sql, /record_type/);
  assert.ok(query.params.includes('department-1'));
});

test('scoped alert mutations return the updated row from the atomic predicate', async () => {
  const queries: unknown[] = [];
  const updated = { id: 'alert-in-scope', status: 'dismissed' };
  const service = createService({
    update: () => ({
      set: () => ({
        where: (condition: unknown) => {
          queries.push(condition);
          return { returning: async () => [updated] };
        },
      }),
    }),
  });

  const result = await service.updateStatus(
    'alert-in-scope',
    'org-1',
    'user-1',
    'dismissed',
    undefined,
    scope,
  );

  assert.deepEqual(result, updated);
  const query = new PgDialect().sqlToQuery(queries[0] as never);
  assert.match(query.sql, /SELECT a\.id/);
  assert.match(query.sql, /spend_guard_alerts/);
  assert.ok(query.params.includes('department-1'));
});

test('entity-scoped alert reads include requisitions through their purchase order entity', async () => {
  let predicate: unknown;
  const service = createService({
    query: {
      spendGuardAlerts: {
        findMany: async (options: {
          where: (
            alert: typeof spendGuardAlerts,
            operators: { and: typeof and; eq: typeof eq },
          ) => unknown;
        }) => {
          predicate = options.where(spendGuardAlerts, { and, eq });
          return [{ id: 'alert-entity-requisition' }];
        },
      },
    },
  });

  const alerts = await service.list('org-1', 'open', {
    ...scope,
    departmentIds: [],
    entityIds: ['entity-1'],
  });

  assert.deepEqual(alerts, [{ id: 'alert-entity-requisition' }]);
  const query = new PgDialect().sqlToQuery(predicate as never);
  assert.match(query.sql, /SELECT a\.id/);
  assert.match(query.sql, /purchase_orders/);
  assert.match(query.sql, /po\.entity_id/);
  assert.ok(query.params.includes('entity-1'));
});

test('alert lifecycle updates refresh the linked invoice review signal in the same transaction', async () => {
  const calls: Array<{ input: Record<string, unknown>; executor?: unknown }> = [];
  const transaction = {
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => [
            {
              id: 'alert-invoice',
              orgId: 'org-1',
              recordType: 'invoice',
              recordId: 'invoice-1',
              alertType: 'duplicate_invoice_amount',
              severity: 'high',
              status: 'dismissed',
              createdAt: new Date('2026-08-30T00:00:00Z'),
              updatedAt: new Date('2026-08-30T00:01:00Z'),
            },
          ],
        }),
      }),
    }),
  };
  const db = {
    transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
  };
  const invoiceReviews = {
    recordSpendGuardReviewSignal: async (input: Record<string, unknown>, executor?: unknown) => {
      calls.push({ input, executor });
    },
  } as never;
  const service = new SpendGuardService(db as never, invoiceReviews, undefined);

  await service.updateStatus('alert-invoice', 'org-1', 'user-1', 'dismissed');

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.input.status, 'dismissed');
  assert.equal(calls[0]?.input.sourceRecordId, 'alert-invoice');
  assert.equal(calls[0]?.executor, transaction);
});

test('review signal failures do not suppress spend guard analysis results', async () => {
  let nextAlertId = 0;
  const invoice = {
    id: 'invoice-1',
    organizationId: 'org-1',
    vendorId: 'vendor-1',
    invoiceNumber: 'INV-1',
    totalAmount: '100.00',
    invoiceDate: new Date('2026-08-30T23:00:00Z'),
    vendor: { name: 'Vendor' },
  };
  const alertRows: Array<Record<string, unknown>> = [];
  const insert = () => ({
    values: (values: Record<string, unknown>) => ({
      returning: async () => {
        const alert = {
          ...values,
          id: `alert-${++nextAlertId}`,
          createdAt: new Date('2026-08-30T23:00:00Z'),
          updatedAt: new Date('2026-08-30T23:00:00Z'),
        };
        alertRows.push(alert);
        return [alert];
      },
    }),
  });
  const db = {
    query: {
      invoices: {
        findFirst: async () => invoice,
        findMany: async () => [
          {
            id: 'invoice-2',
            invoiceNumber: 'INV-2',
            totalAmount: '100.00',
          },
        ],
      },
      spendGuardAlerts: { findFirst: async () => undefined },
    },
    insert,
    transaction: async <T>(callback: (tx: unknown) => Promise<T>) => {
      const snapshot = alertRows.map((alert) => ({ ...alert }));
      const tx = {
        select: () => ({
          from: () => ({
            where: () => ({ for: async () => [invoice] }),
          }),
        }),
        query: {
          spendGuardAlerts: {
            findFirst: async () => undefined,
          },
        },
        insert,
      };
      try {
        return await callback(tx);
      } catch (error) {
        alertRows.splice(0, alertRows.length, ...snapshot);
        throw error;
      }
    },
  };
  const invoiceReviews = {
    recordSpendGuardReviewSignal: async () => {
      throw new Error('review signal unavailable');
    },
  } as never;
  const service = new SpendGuardService(db as never, invoiceReviews, undefined);

  const alerts = await service.analyzeInvoice('org-1', 'invoice-1');

  assert.deepEqual(alerts, [
    'duplicate_invoice_amount',
    'near_duplicate_invoice',
    'off_hours_submission',
  ]);
  assert.equal(alertRows.length, 3);
});

test('invoice analysis does not report an alert that failed to persist', async () => {
  const invoice = {
    id: 'invoice-1',
    organizationId: 'org-1',
    vendorId: 'vendor-1',
    invoiceNumber: 'INV-1',
    totalAmount: '100.00',
    invoiceDate: new Date('2026-08-30T23:00:00Z'),
    vendor: { name: 'Vendor' },
  };
  const db = {
    query: {
      invoices: {
        findFirst: async () => invoice,
        findMany: async () => [],
      },
    },
    transaction: async () => {
      throw new Error('alert persistence unavailable');
    },
  };
  const service = new SpendGuardService(
    db as never,
    { recordSpendGuardReviewSignal: async () => undefined } as never,
    undefined,
  );

  const alerts = await service.analyzeInvoice('org-1', 'invoice-1');

  assert.deepEqual(alerts, []);
});

test('repeated invoice analysis refreshes one normalized signal and case', async () => {
  type SignalInput = {
    organizationId: string;
    invoiceId: string;
    sourceRecordId: string;
    alertType: string;
    severity: 'low' | 'medium' | 'high';
    status: 'open' | 'dismissed' | 'escalated';
    observedAt?: Date;
  };
  type NormalizedSignal = {
    lastSeenAt: Date;
    details: Record<string, unknown>;
  };

  const alerts: Array<Record<string, unknown>> = [];
  const normalizedSignals = new Map<string, NormalizedSignal>();
  const invoice = {
    id: 'invoice-1',
    organizationId: 'org-1',
    vendorId: 'vendor-1',
    invoiceNumber: 'INV-1',
    totalAmount: '100.00',
    invoiceDate: new Date('2026-08-30T23:00:00Z'),
    vendor: { name: 'Vendor' },
  };
  const insert = () => ({
    values: (values: Record<string, unknown>) => ({
      returning: async () => {
        const timestamp = new Date('2026-08-30T00:00:00Z');
        const alert = {
          ...values,
          id: 'alert-1',
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        alerts.push(alert);
        return [alert];
      },
    }),
  });
  const update = () => ({
    set: (values: Record<string, unknown>) => ({
      where: () => ({
        returning: async () => {
          const alert = alerts.find((row) => row.status === 'open');
          if (!alert) return [];
          Object.assign(alert, values);
          return [alert];
        },
      }),
    }),
  });
  const transaction = async <T>(callback: (tx: unknown) => Promise<T>) =>
    callback({
      select: () => ({
        from: () => ({
          where: () => ({ for: async () => [invoice] }),
        }),
      }),
      query: {
        spendGuardAlerts: {
          findFirst: async () => alerts.find((row) => row.status === 'open'),
        },
      },
      insert,
      update,
    });
  const db = {
    query: {
      invoices: {
        findFirst: async () => invoice,
        findMany: async () => [],
      },
    },
    transaction,
  };
  let caseCount = 0;
  const invoiceReviews = {
    recordSpendGuardReviewSignal: async (input: SignalInput) => {
      const key = `${input.organizationId}:${input.invoiceId}:${input.sourceRecordId}`;
      const existing = normalizedSignals.get(key);
      const observedAt = input.observedAt ?? new Date();
      const details = {
        alertType: input.alertType,
        alertSeverity: input.severity,
        alertStatus: input.status,
      };
      if (!existing) {
        caseCount += 1;
        normalizedSignals.set(key, { lastSeenAt: observedAt, details });
      } else if (observedAt > existing.lastSeenAt) {
        normalizedSignals.set(key, { lastSeenAt: observedAt, details });
      }
    },
  };
  const service = new SpendGuardService(db as never, invoiceReviews as never, undefined);

  await service.analyzeInvoice('org-1', 'invoice-1');
  const firstSignal = normalizedSignals.get('org-1:invoice-1:alert-1');
  assert.ok(firstSignal);

  await service.analyzeInvoice('org-1', 'invoice-1');
  const secondSignal = normalizedSignals.get('org-1:invoice-1:alert-1');
  assert.ok(secondSignal);

  assert.equal(alerts.length, 1);
  assert.equal(caseCount, 1);
  assert.equal(normalizedSignals.size, 1);
  assert.deepEqual(secondSignal.details, firstSignal.details);
  assert.ok(secondSignal.lastSeenAt > firstSignal.lastSeenAt);
});

test('concurrent first-time invoice analyses create one alert, signal, and case', async () => {
  type SignalInput = {
    organizationId: string;
    invoiceId: string;
    sourceRecordId: string;
    alertType: string;
    severity: 'low' | 'medium' | 'high';
    status: 'open' | 'dismissed' | 'escalated';
  };

  const invoice = {
    id: 'invoice-1',
    organizationId: 'org-1',
    vendorId: 'vendor-1',
    invoiceNumber: 'INV-1',
    totalAmount: '100.00',
    invoiceDate: new Date('2026-08-30T23:00:00Z'),
    vendor: { name: 'Vendor' },
  };
  const alerts: Array<Record<string, unknown>> = [];
  const normalizedSignals = new Map<string, SignalInput>();
  let caseCount = 0;
  let nextAlertId = 0;
  let lockHeld = false;
  let spendGuardAlertQueries = 0;
  let releaseFirstQuery: (() => void) | undefined;
  const firstQuery = new Promise<void>((resolve) => {
    releaseFirstQuery = resolve;
  });
  const waiters: Array<() => void> = [];

  const acquireInvoiceLock = async () => {
    if (!lockHeld) {
      lockHeld = true;
      return;
    }
    await new Promise<void>((resolve) => waiters.push(resolve));
  };
  const releaseInvoiceLock = () => {
    const next = waiters.shift();
    if (next) next();
    else lockHeld = false;
  };
  const insert = () => ({
    values: (values: Record<string, unknown>) => ({
      returning: async () => {
        const timestamp = new Date('2026-08-30T00:00:00Z');
        const alert = {
          ...values,
          id: `alert-${++nextAlertId}`,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        alerts.push(alert);
        return [alert];
      },
    }),
  });
  const update = () => ({
    set: (values: Record<string, unknown>) => ({
      where: () => ({
        returning: async () => {
          const alert = alerts.find((row) => row.status === 'open');
          if (!alert) return [];
          Object.assign(alert, values);
          return [alert];
        },
      }),
    }),
  });
  const transaction = async <T>(callback: (tx: unknown) => Promise<T>) => {
    let transactionHoldsLock = false;
    const tx = {
      select: () => ({
        from: () => ({
          where: () => ({
            for: async () => {
              await acquireInvoiceLock();
              transactionHoldsLock = true;
              return [invoice];
            },
          }),
        }),
      }),
      query: {
        spendGuardAlerts: {
          findFirst: async () => {
            spendGuardAlertQueries += 1;
            if (!lockHeld && spendGuardAlertQueries === 1) await firstQuery;
            if (!lockHeld && spendGuardAlertQueries === 2) releaseFirstQuery?.();
            return alerts.find((row) => row.status === 'open');
          },
        },
      },
      insert,
      update,
    };
    try {
      return await callback(tx);
    } finally {
      if (transactionHoldsLock) releaseInvoiceLock();
    }
  };
  const db = {
    query: {
      invoices: {
        findFirst: async () => invoice,
        findMany: async () => [],
      },
    },
    transaction,
  };
  const invoiceReviews = {
    recordSpendGuardReviewSignal: async (input: SignalInput) => {
      const key = `${input.organizationId}:${input.invoiceId}:${input.sourceRecordId}`;
      if (!normalizedSignals.has(key)) caseCount += 1;
      normalizedSignals.set(key, input);
    },
  };
  const service = new SpendGuardService(db as never, invoiceReviews as never, undefined);

  await Promise.all([
    service.analyzeInvoice('org-1', 'invoice-1'),
    service.analyzeInvoice('org-1', 'invoice-1'),
  ]);

  assert.equal(alerts.length, 1);
  assert.equal(normalizedSignals.size, 1);
  assert.equal(caseCount, 1);
  assert.deepEqual([...normalizedSignals.keys()], ['org-1:invoice-1:alert-1']);
});

test('invoice alert remains visible when review signal persistence fails', async () => {
  const rows: Array<Record<string, unknown>> = [];
  let transactions = 0;
  let signalExecutor: unknown;
  const invoice = {
    id: 'invoice-1',
    organizationId: 'org-1',
    vendorId: 'vendor-1',
    invoiceNumber: 'INV-1',
    totalAmount: '100.00',
    invoiceDate: new Date('2026-08-30T23:00:00Z'),
    vendor: { name: 'Vendor' },
  };
  const insert = () => ({
    values: (values: Record<string, unknown>) => ({
      returning: async () => {
        const row = {
          ...values,
          id: 'alert-1',
          createdAt: new Date('2026-08-30T23:00:00Z'),
          updatedAt: new Date('2026-08-30T23:00:00Z'),
        };
        rows.push(row);
        return [row];
      },
    }),
  });
  const db = {
    query: {
      invoices: {
        findFirst: async () => invoice,
        findMany: async () => [],
      },
      spendGuardAlerts: {
        findFirst: async () => rows.find((row) => row.status === 'open'),
      },
    },
    insert,
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      transactions += 1;
      const snapshot = rows.map((row) => ({ ...row }));
      const tx = {
        select: () => ({
          from: () => ({
            where: () => ({ for: async () => [invoice] }),
          }),
        }),
        query: {
          spendGuardAlerts: {
            findFirst: async () => rows.find((row) => row.status === 'open'),
          },
        },
        insert,
      };
      try {
        return await callback(tx);
      } catch (error) {
        rows.splice(0, rows.length, ...snapshot);
        throw error;
      }
    },
  };
  const invoiceReviews = {
    recordSpendGuardReviewSignal: async (_input: unknown, executor: unknown) => {
      signalExecutor = executor;
      throw new Error('review signal unavailable');
    },
  } as never;
  const service = new SpendGuardService(db as never, invoiceReviews, undefined);

  const alerts = await service.analyzeInvoice('org-1', 'invoice-1');

  assert.deepEqual(alerts, ['off_hours_submission']);
  assert.equal(transactions, 2);
  assert.ok(signalExecutor);
  assert.equal(rows.length, 1);
});
