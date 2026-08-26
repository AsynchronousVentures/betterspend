import assert from 'node:assert/strict';
import test from 'node:test';
import type { Db } from '@betterspend/db';
import { poLines, purchaseOrders, recurringPos } from '@betterspend/db';
import type { AuditService } from '../audit/audit.service';
import type { SequenceService } from '../../common/services/sequence.service';
import { RecurringPoService } from './recurring-po.service';

const organizationId = 'organization-1';
const schedule = {
  id: 'schedule-1',
  organizationId,
  title: 'Monthly office supplies',
  vendorId: 'vendor-1',
  active: true,
  maxRuns: 1,
  runCount: 0,
  frequency: 'monthly',
  dayOfMonth: 1,
  nextRunAt: new Date('2026-09-01T00:00:00.000Z'),
  currency: 'USD',
  notes: null,
  glAccount: null,
  lines: [{ description: 'Paper clips', quantity: '3.00', unitPrice: '0.10' }],
};

test('triggerRun locks the schedule and persists exact line totals before advancing it', async () => {
  const locks: string[] = [];
  const purchaseOrderValues: Array<Record<string, unknown>> = [];
  const lineValues: Array<Array<Record<string, unknown>>> = [];
  const scheduleUpdates: Array<Record<string, unknown>> = [];
  let sequenceArgs: unknown[] | undefined;

  const tx = {
    select: () => ({
      from: (table: unknown) => {
        assert.equal(table, recurringPos);
        return {
          where: () => ({
            for: async (mode: string) => {
              locks.push(mode);
              return [schedule];
            },
          }),
        };
      },
    }),
    insert: (table: unknown) => {
      if (table === purchaseOrders) {
        return {
          values: (values: Record<string, unknown>) => {
            purchaseOrderValues.push(values);
            return { returning: async () => [{ id: 'po-1' }] };
          },
        };
      }
      assert.equal(table, poLines);
      return {
        values: async (values: Array<Record<string, unknown>>) => {
          lineValues.push(values);
        },
      };
    },
    update: (table: unknown) => {
      assert.equal(table, recurringPos);
      return {
        set: (values: Record<string, unknown>) => {
          scheduleUpdates.push(values);
          return { where: async () => [] };
        },
      };
    },
  };
  const db = {
    transaction: async (run: (transaction: typeof tx) => Promise<unknown>) => run(tx),
  } as unknown as Db;
  const sequence = {
    next: async (...args: unknown[]) => {
      sequenceArgs = args;
      return 'PO-2026-0001';
    },
  } as unknown as SequenceService;
  const service = new RecurringPoService(db, sequence, {} as AuditService);

  const result = await service.triggerRun(schedule.id, organizationId, 'user-1');

  assert.deepEqual(result, {
    purchaseOrderId: 'po-1',
    purchaseOrderNumber: 'PO-2026-0001',
    runCount: 1,
    reachedMax: true,
  });
  assert.deepEqual(locks, ['update']);
  assert.deepEqual(sequenceArgs, [organizationId, 'purchase_order', tx]);
  assert.equal(purchaseOrderValues[0]?.subtotal, '0.30');
  assert.equal(purchaseOrderValues[0]?.totalAmount, '0.30');
  assert.equal(lineValues[0]?.[0]?.quantity, '3.00');
  assert.equal(lineValues[0]?.[0]?.unitPrice, '0.10');
  assert.equal(lineValues[0]?.[0]?.totalPrice, '0.30');
  assert.equal(scheduleUpdates[0]?.runCount, 1);
  assert.equal(scheduleUpdates[0]?.active, false);
});

test('remove locks the schedule and writes its audit entry in the deletion transaction', async () => {
  const locks: string[] = [];
  const auditCalls: unknown[][] = [];
  const tx = {
    select: () => ({
      from: (table: unknown) => {
        assert.equal(table, recurringPos);
        return {
          where: () => ({
            for: async (mode: string) => {
              locks.push(mode);
              return [schedule];
            },
          }),
        };
      },
    }),
    delete: (table: unknown) => {
      assert.equal(table, recurringPos);
      return {
        where: () => ({ returning: async () => [{ id: schedule.id }] }),
      };
    },
  };
  const db = {
    transaction: async (run: (transaction: typeof tx) => Promise<unknown>) => run(tx),
  } as unknown as Db;
  const audit = {
    log: async (...args: unknown[]) => {
      auditCalls.push(args);
    },
  } as unknown as AuditService;
  const service = new RecurringPoService(db, {} as SequenceService, audit);

  await assert.doesNotReject(() => service.remove(schedule.id, organizationId, 'user-1'));

  assert.deepEqual(locks, ['update']);
  assert.deepEqual(auditCalls[0]?.slice(0, 6), [
    organizationId,
    'user-1',
    'recurring_purchase_order',
    schedule.id,
    'deleted',
    { title: schedule.title, runCount: schedule.runCount },
  ]);
  assert.equal(auditCalls[0]?.[7], tx);
});
