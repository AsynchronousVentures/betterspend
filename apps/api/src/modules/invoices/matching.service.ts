import { Injectable, Inject } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db } from '@betterspend/db';
import { invoices, invoiceLines, matchResults } from '@betterspend/db';

// Configurable tolerances
const PRICE_TOLERANCE_PCT = 2;   // 2% price variance allowed
const QTY_TOLERANCE_PCT = 5;     // 5% quantity variance allowed

@Injectable()
export class MatchingService {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  async runMatch(invoiceId: string): Promise<{
    matchStatus: string;
    lineResults: Array<{
      invoiceLineId: string;
      poLineId: string | null;
      priceMatch: boolean;
      quantityMatch: boolean;
      status: string;
    }>;
  }> {
    const invoice = await this.db.query.invoices.findFirst({
      where: (i, { eq }) => eq(i.id, invoiceId),
      with: {
        lines: true,
        purchaseOrder: { with: { lines: true, goodsReceipts: { with: { lines: true } } } },
      },
    });

    if (!invoice || !invoice.purchaseOrder) {
      // No PO linked — mark as unmatched
      await this.db.update(invoices)
        .set({ matchStatus: 'unmatched', updatedAt: new Date() })
        .where(eq(invoices.id, invoiceId));
      return { matchStatus: 'unmatched', lineResults: [] };
    }

    const po = invoice.purchaseOrder as any;
    const poLines: any[] = po.lines ?? [];
    const allGrnLines: any[] = (po.goodsReceipts ?? []).flatMap((g: any) => g.lines ?? []);
    const invoiceLineIds = (invoice.lines as any[]).map((line) => line.id);

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
    }> = [];

    for (const invLine of invoice.lines as any[]) {
      const poLine = poLines.find((p: any) => p.id === invLine.poLineId);
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
        });
        continue;
      }

      // Price match
      const invoicedPrice = parseFloat(invLine.unitPrice);
      const poPrice = parseFloat(poLine.unitPrice);
      const priceVariance = Math.abs(invoicedPrice - poPrice);
      const priceVariancePct = poPrice > 0 ? (priceVariance / poPrice) * 100 : 0;
      const priceMatch = priceVariancePct <= PRICE_TOLERANCE_PCT;

      // Quantity match: invoice qty vs total received for this PO line
      const totalReceived = allGrnLines
        .filter((gl: any) => gl.poLineId === poLine.id)
        .reduce((sum: number, gl: any) => sum + parseFloat(gl.quantityReceived), 0);

      const invoicedQty = parseFloat(invLine.quantity);
      const qtyVariance = Math.abs(invoicedQty - totalReceived);
      const qtyVariancePct = totalReceived > 0 ? (qtyVariance / totalReceived) * 100 : invoicedQty > 0 ? 100 : 0;
      const quantityMatch = qtyVariancePct <= QTY_TOLERANCE_PCT;

      // Find the GRN line (use first matching one for FK reference)
      const grnLine = allGrnLines.find((gl: any) => gl.poLineId === poLine.id) ?? null;

      const status = priceMatch && quantityMatch ? 'match'
        : (priceVariancePct <= PRICE_TOLERANCE_PCT * 3 && qtyVariancePct <= QTY_TOLERANCE_PCT * 3) ? 'within_tolerance'
        : 'exception';

      lineResults.push({
        invoiceLineId: invLine.id,
        poLineId: poLine.id,
        priceMatch,
        quantityMatch,
        status,
        priceVariance,
        quantityVariance: qtyVariance,
        variancePct: Math.max(priceVariancePct, qtyVariancePct),
        grnLineId: grnLine?.id ?? null,
      });
    }

    if (invoiceLineIds.length > 0) {
      await this.db.delete(matchResults).where(inArray(matchResults.invoiceLineId, invoiceLineIds));
    }

    // Persist match results
    for (const r of lineResults) {
      if (!r.poLineId) continue;
      await this.db.insert(matchResults).values({
        invoiceLineId: r.invoiceLineId,
        poLineId: r.poLineId,
        grnLineId: r.grnLineId,
        priceMatch: r.priceMatch,
        quantityMatch: r.quantityMatch,
        priceVariance: String(r.priceVariance),
        quantityVariance: String(r.quantityVariance),
        variancePct: String(r.variancePct.toFixed(2)),
        status: r.status,
        toleranceApplied: String(Math.max(PRICE_TOLERANCE_PCT, QTY_TOLERANCE_PCT)),
      });
    }

    // Overall invoice match status
    const hasException = lineResults.some((r) => r.status === 'exception');
    const allMatch = lineResults.every((r) => r.status === 'match');
    const matchStatus = allMatch ? 'full_match' : hasException ? 'exception' : 'partial_match';

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

    await this.db.update(invoices)
      .set({ matchStatus, matchDetails, updatedAt: new Date() })
      .where(eq(invoices.id, invoiceId));

    return { matchStatus, lineResults };
  }
}
