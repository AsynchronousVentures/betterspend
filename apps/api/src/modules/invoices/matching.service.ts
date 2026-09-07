import { Injectable, Inject } from '@nestjs/common';
import { and, asc, eq, inArray, notInArray, or, sql } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db, DbTransaction } from '@betterspend/db';
import { invoices, invoiceLines, matchResults, poLines } from '@betterspend/db';

// Configurable tolerances
const PRICE_TOLERANCE_PCT = 2; // 2% price variance allowed
const QTY_TOLERANCE_PCT = 5; // 5% quantity variance allowed

interface OverallLineMatch {
  status: string;
  grnLineId: string | null;
  invoicedQuantity: number;
}

export function overallInvoiceMatchStatus(lineResults: OverallLineMatch[]): string {
  const hasException = lineResults.some((result) => result.status === 'exception');
  const allMatch =
    lineResults.length > 0 &&
    lineResults.every(
      (result) =>
        result.status === 'match' && result.grnLineId !== null && result.invoicedQuantity > 0,
    );
  return allMatch ? 'full_match' : hasException ? 'exception' : 'partial_match';
}

export function invoiceStatusFromMatchStatus(
  matchStatus: string,
): 'matched' | 'exception' | 'partial_match' {
  return matchStatus === 'full_match'
    ? 'matched'
    : matchStatus === 'exception'
      ? 'exception'
      : 'partial_match';
}

@Injectable()
export class MatchingService {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  async runMatch(
    invoiceId: string,
    executor: Db | DbTransaction = this.db,
  ): Promise<{
    matchStatus: string;
    lineResults: Array<{
      invoiceLineId: string;
      poLineId: string | null;
      priceMatch: boolean;
      quantityMatch: boolean;
      status: string;
    }>;
  }> {
    if (executor === this.db) {
      return this.db.transaction((tx) => this.runMatch(invoiceId, tx));
    }
    // Serialize evaluations against shared PO quantities. Re-read sources after
    // acquiring the lock so a waiting transaction sees the preceding commit.
    // NO KEY UPDATE permits invoice-line FK key-share locks, avoiding lock
    // upgrade deadlocks when two portal submissions insert before evaluation.
    const source = await executor.query.invoices.findFirst({
      where: (i, { eq }) => eq(i.id, invoiceId),
      columns: { purchaseOrderId: true },
    });
    if (source?.purchaseOrderId) {
      await executor
        .select({ id: poLines.id })
        .from(poLines)
        .where(eq(poLines.purchaseOrderId, source.purchaseOrderId))
        .orderBy(asc(poLines.id))
        .for('no key update');
    }
    const invoice = await executor.query.invoices.findFirst({
      where: (i, { eq }) => eq(i.id, invoiceId),
      with: {
        lines: true,
        purchaseOrder: { with: { lines: true, goodsReceipts: { with: { lines: true } } } },
      },
    });

    if (!invoice || !invoice.purchaseOrder) {
      // No PO linked — mark as unmatched
      await executor
        .update(invoices)
        .set({ matchStatus: 'unmatched', updatedAt: new Date() })
        .where(eq(invoices.id, invoiceId));
      return { matchStatus: 'unmatched', lineResults: [] };
    }

    const po = invoice.purchaseOrder;
    const purchaseOrderLines = po.lines;
    const allGrnLines = po.goodsReceipts
      .filter(
        (receipt) =>
          receipt.status === 'confirmed' && receipt.organizationId === invoice.organizationId,
      )
      .flatMap((receipt) => receipt.lines);
    const invoiceLineIds = invoice.lines.map((line) => line.id);
    // Include every active invoice, including sibling lines on this invoice.
    // Other rejected, cancelled, and unsubmitted draft invoices do not consume
    // receipts. Released invoices remain active, including ready_for_release.
    const activeQuantities = await executor
      .select({
        poLineId: invoiceLines.poLineId,
        quantity: sql<string>`sum(${invoiceLines.quantity})::text`,
      })
      .from(invoiceLines)
      .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
      .where(
        and(
          eq(invoices.organizationId, invoice.organizationId),
          eq(invoices.purchaseOrderId, po.id),
          or(
            eq(invoices.id, invoiceId),
            notInArray(invoices.status, ['draft', 'rejected', 'cancelled']),
          ),
        ),
      )
      .groupBy(invoiceLines.poLineId);
    const quantities = new Map(activeQuantities.map((line) => [line.poLineId, line.quantity]));

    const lineResults: Array<{
      invoiceLineId: string;
      poLineId: string | null;
      priceMatch: boolean;
      quantityMatch: boolean;
      status: string;
      priceVariance: number;
      quantityVariance: number;
      variancePct: number;
      grnLineId: string | null;
      invoicedQuantity: number;
    }> = [];

    for (const invLine of invoice.lines) {
      const poLine = purchaseOrderLines.find((p) => p.id === invLine.poLineId);
      if (!poLine) {
        lineResults.push({
          invoiceLineId: invLine.id,
          poLineId: null,
          priceMatch: false,
          quantityMatch: false,
          status: 'exception',
          priceVariance: 0,
          quantityVariance: 0,
          variancePct: 0,
          grnLineId: null,
          invoicedQuantity: parseFloat(invLine.quantity),
        });
        continue;
      }

      const received = allGrnLines.filter((line) => line.poLineId === poLine.id);
      const match = evaluateInvoiceQuantitiesAndPrice({
        invoicePrice: invLine.unitPrice,
        poPrice: poLine.unitPrice,
        cumulativeQuantity: quantities.get(poLine.id) ?? invLine.quantity,
        receipts: received,
      });
      const grnLine =
        received.find(
          (line) =>
            decimalHundredths(line.quantityReceived) > decimalHundredths(line.quantityRejected),
        ) ?? null;

      lineResults.push({
        invoiceLineId: invLine.id,
        poLineId: poLine.id,
        ...match,
        grnLineId: grnLine?.id ?? null,
        invoicedQuantity: Number(invLine.quantity),
      });
    }

    if (invoiceLineIds.length > 0) {
      await executor
        .delete(matchResults)
        .where(inArray(matchResults.invoiceLineId, invoiceLineIds));
    }

    // Persist match results
    for (const r of lineResults) {
      if (!r.poLineId) continue;
      await executor.insert(matchResults).values({
        invoiceLineId: r.invoiceLineId,
        poLineId: r.poLineId,
        grnLineId: r.grnLineId,
        priceMatch: r.priceMatch,
        quantityMatch: r.quantityMatch,
        priceVariance: String(r.priceVariance),
        quantityVariance: String(r.quantityVariance),
        // The legacy numeric(5,2) diagnostic cannot store ratios >= 1000%.
        // Match decisions above use uncapped integer inputs.
        variancePct: String(Math.min(r.variancePct, 999.99).toFixed(2)),
        status: r.status,
        toleranceApplied: String(Math.max(PRICE_TOLERANCE_PCT, QTY_TOLERANCE_PCT)),
      });
    }

    // Overall invoice match status
    const matchStatus = overallInvoiceMatchStatus(lineResults);

    const matchDetails = {
      priceTolerance: PRICE_TOLERANCE_PCT,
      qtyTolerance: QTY_TOLERANCE_PCT,
      lines: lineResults.map((r) => ({
        invoiceLineId: r.invoiceLineId,
        status: r.status,
        priceMatch: r.priceMatch,
        quantityMatch: r.quantityMatch,
      })),
    };

    await executor
      .update(invoices)
      .set({ matchStatus, matchDetails, updatedAt: new Date() })
      .where(eq(invoices.id, invoiceId));

    return { matchStatus, lineResults };
  }
}

// Prices and quantities are numeric(..., 2) in the database. Compare integer
// hundredths exactly, converting only display diagnostics back to numbers.
function decimalHundredths(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
}

export function evaluateInvoiceQuantitiesAndPrice(input: {
  invoicePrice: string;
  poPrice: string;
  cumulativeQuantity: string;
  receipts: Array<{ quantityReceived: string; quantityRejected: string }>;
}) {
  const price = decimalHundredths(input.invoicePrice);
  const poPrice = decimalHundredths(input.poPrice);
  const priceDifference = price > poPrice ? price - poPrice : poPrice - price;
  const quantity = decimalHundredths(input.cumulativeQuantity);
  const received = input.receipts.reduce((sum, line) => {
    const accepted =
      decimalHundredths(line.quantityReceived) - decimalHundredths(line.quantityRejected);
    return sum + (accepted > 0n ? accepted : 0n);
  }, 0n);
  // Partial invoices consume only their share of receipts. Underbilling is safe.
  const excess = quantity > received ? quantity - received : 0n;
  const validPrice = poPrice > 0n || price === 0n;
  const hasReceipt = received > 0n;
  const priceMatch = validPrice && priceDifference * 100n <= poPrice * BigInt(PRICE_TOLERANCE_PCT);
  const quantityMatch = hasReceipt && excess * 100n <= received * BigInt(QTY_TOLERANCE_PCT);
  const withinTolerance =
    validPrice &&
    hasReceipt &&
    priceDifference * 100n <= poPrice * BigInt(PRICE_TOLERANCE_PCT * 3) &&
    excess * 100n <= received * BigInt(QTY_TOLERANCE_PCT * 3);
  return {
    priceMatch,
    quantityMatch,
    status:
      priceMatch && quantityMatch ? 'match' : withinTolerance ? 'within_tolerance' : 'exception',
    priceVariance: Number(priceDifference) / 100,
    quantityVariance: Number(excess) / 100,
    variancePct: Math.max(
      poPrice > 0n ? (Number(priceDifference) / Number(poPrice)) * 100 : price > 0n ? 100 : 0,
      received > 0n ? (Number(excess) / Number(received)) * 100 : quantity > 0n ? 100 : 0,
    ),
  };
}
