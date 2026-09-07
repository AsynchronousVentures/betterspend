import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { ConflictException } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@betterspend/db';
import { SequenceService } from '../../common/services/sequence.service';
import { InvoicesService } from './invoices.service';
import { MatchingService } from './matching.service';

// Run against a disposable database after pnpm db:migrate. Separate PostgreSQL
// connections are required to exercise transaction waits; PGlite serializes them.
const url = process.env.FINANCIAL_TEST_DATABASE_URL;
test(
  'migrated PostgreSQL prevents duplicate creation and cumulative receipt consumption',
  { skip: !url, timeout: 30_000 },
  async () => {
    const client = postgres(url!, { max: 5 });
    const db = drizzle(client, { schema });
    const organizationId = randomUUID();
    const vendorId = randomUUID();
    const userId = randomUUID();
    const poId = randomUUID();
    const poLineId = randomUUID();
    try {
      await db
        .insert(schema.organizations)
        .values({ id: organizationId, name: 'Financial test', slug: organizationId });
      await db.insert(schema.vendors).values({ id: vendorId, organizationId, name: 'Vendor' });
      await db
        .insert(schema.users)
        .values({ id: userId, organizationId, name: 'Maker', email: `${userId}@example.test` });
      // Internal numbers are globally unique while sequences are per organization.
      // Start beyond prior fixtures so this isolated-database test is repeatable.
      await client`INSERT INTO sequences (organization_id, entity_type, year, last_value)
        SELECT ${organizationId}, 'invoice', ${new Date().getFullYear()}, coalesce(max(last_value), 0) + 1 FROM sequences`;
      const matching = new MatchingService(db);
      // Nonfinancial collaborators are stubbed. Creation, sequence, lines, audit,
      // constraints, transaction rollback, and matching all use the real database.
      const collaborators = [
        db,
        new SequenceService(db),
        matching,
        { emit() {} },
        {},
        {},
        {},
        undefined,
        { assertBelongsToOrg: async () => {} },
        {
          convertToBase: async () => ({ baseCurrency: 'USD', exchangeRate: 1, baseAmount: 10 }),
          roundMoney: (value: number) => value,
        },
        { analyzeInvoice: async () => {} },
        {},
        {},
        {},
        {},
      ] as unknown as ConstructorParameters<typeof InvoicesService>;
      const service = new InvoicesService(...collaborators);
      // Hold both requests after their duplicate lookup, ensuring both observe no
      // existing invoice before either reaches the sequence or unique constraint.
      let arrived = 0;
      let release!: () => void;
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      collaborators[9].convertToBase = async () => {
        if (++arrived === 2) release();
        await barrier;
        return { baseCurrency: 'USD', exchangeRate: 1, baseAmount: 10 };
      };
      const input = {
        vendorId,
        invoiceNumber: 'DUPLICATE',
        invoiceDate: '2026-09-01',
        lines: [{ lineNumber: 1, description: 'Item', quantity: 1, unitPrice: 10 }],
      };
      const creations = await Promise.allSettled([
        service.create(organizationId, userId, input),
        service.create(organizationId, userId, input),
      ]);
      assert.equal(creations.filter((result) => result.status === 'fulfilled').length, 1);
      const rejected = creations.find((result) => result.status === 'rejected');
      assert.ok(rejected?.status === 'rejected' && rejected.reason instanceof ConflictException);
      const [counts] = await client`SELECT
      (SELECT count(*) FROM invoices WHERE organization_id = ${organizationId})::int AS invoices,
      (SELECT count(*) FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id WHERE i.organization_id = ${organizationId})::int AS lines,
      (SELECT count(*) FROM audit_log WHERE organization_id = ${organizationId} AND entity_type = 'invoice' AND action = 'created')::int AS audits`;
      assert.deepEqual({ ...counts }, { invoices: 1, lines: 1, audits: 1 });

      await db
        .insert(schema.purchaseOrders)
        .values({ id: poId, organizationId, vendorId, number: poId });
      await db.insert(schema.poLines).values({
        id: poLineId,
        purchaseOrderId: poId,
        lineNumber: 1,
        description: 'Item',
        quantity: '10',
        unitPrice: '10',
        totalPrice: '100',
      });
      const receiptIds = new Map<string, string>();
      for (const status of ['draft', 'cancelled', 'confirmed']) {
        const id = randomUUID();
        receiptIds.set(status, id);
        await db.insert(schema.goodsReceipts).values({
          id,
          organizationId,
          purchaseOrderId: poId,
          number: id,
          receivedBy: userId,
          receivedDate: new Date(),
          status,
        });
        await db.insert(schema.goodsReceiptLines).values({
          goodsReceiptId: id,
          poLineId,
          quantityReceived: '10',
          quantityRejected: status === 'confirmed' ? '5' : '0',
        });
      }
      const insertInvoice = async (
        executor: schema.Db | schema.DbTransaction,
        quantity: string,
        status = 'pending_match',
      ) => {
        const id = randomUUID();
        await executor.insert(schema.invoices).values({
          id,
          organizationId,
          vendorId,
          purchaseOrderId: poId,
          invoiceNumber: id,
          internalNumber: id,
          invoiceDate: new Date(),
          status,
        });
        await executor.insert(schema.invoiceLines).values({
          invoiceId: id,
          poLineId,
          lineNumber: '1',
          description: 'Item',
          quantity,
          unitPrice: '10',
          totalPrice: '50',
        });
        return id;
      };
      // Synchronize before matching, while each new invoice is still uncommitted.
      let matchingArrived = 0;
      let releaseMatching!: () => void;
      const matchingBarrier = new Promise<void>((resolve) => {
        releaseMatching = resolve;
      });
      const consume = () =>
        db.transaction(async (tx) => {
          const id = await insertInvoice(tx, '5');
          if (++matchingArrived === 2) releaseMatching();
          await matchingBarrier;
          return { id, result: await matching.runMatch(id, tx) };
        });
      const consumption = await Promise.all([consume(), consume()]);
      assert.deepEqual(consumption.map(({ result }) => result.matchStatus).sort(), [
        'exception',
        'full_match',
      ]);
      const first = consumption[0].id;
      await client`UPDATE invoices SET status = 'cancelled' WHERE organization_id = ${organizationId} AND id <> ${first}::uuid AND purchase_order_id = ${poId}`;
      assert.equal((await matching.runMatch(first)).matchStatus, 'full_match');
      await insertInvoice(db, '100', 'rejected');
      assert.equal((await matching.runMatch(first)).matchStatus, 'full_match');
      const releasedInvoice = await insertInvoice(db, '5', 'ready_for_release');
      assert.equal((await matching.runMatch(first)).matchStatus, 'exception');
      await client`UPDATE invoices SET status = 'cancelled' WHERE id = ${releasedInvoice}`;
      // A second line on the same invoice must not reuse the first line's receipt.
      await db.insert(schema.invoiceLines).values({
        invoiceId: first,
        poLineId,
        lineNumber: '2',
        description: 'Duplicate allocation',
        quantity: '5',
        unitPrice: '10',
        totalPrice: '50',
      });
      assert.equal((await matching.runMatch(first)).matchStatus, 'exception');
      await insertInvoice(db, '99999999.99');
      await insertInvoice(db, '99999999.99');
      const overflow = await matching.runMatch(first);
      assert.equal(overflow.matchStatus, 'exception');
      const diagnostics = await client`SELECT quantity_variance, quantity_match
        FROM match_results mr JOIN invoice_lines il ON il.id = mr.invoice_line_id
        WHERE il.invoice_id = ${first}`;
      assert.ok(diagnostics.length > 0);
      assert.ok(
        diagnostics.every(
          (row) => row.quantity_variance === '99999999.99' && row.quantity_match === false,
        ),
      );
      await client`UPDATE goods_receipts SET status = 'cancelled' WHERE id = ${receiptIds.get('confirmed')!}`;
      const withoutReceipt = await matching.runMatch(first);
      assert.equal(withoutReceipt.matchStatus, 'exception');
      assert.ok(withoutReceipt.lineResults.every((line) => !line.quantityMatch));
    } finally {
      await client.end({ timeout: 5 });
    }
  },
);
