import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, and, desc, sql } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db } from '@betterspend/db';
import { recurringPos, purchaseOrders, poLines, sequences, vendors } from '@betterspend/db';

type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'annually';

interface RecurringPoLine {
  description: string;
  quantity: number;
  unitPrice: number;
  unitOfMeasure?: string;
}

interface RecurringPoHistoryItem {
  id: string;
  number: string;
  status: string;
  totalAmount: string;
  currency: string;
  createdAt: Date;
}

@Injectable()
export class RecurringPoService {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  // ── Helpers ─────────────────────────────────────────────────────────────────

  computeNextRunAt(frequency: Frequency, dayOfMonth?: number | null, from?: Date): Date {
    const base = from ? new Date(from) : new Date();
    const day = dayOfMonth ?? 1;

    switch (frequency) {
      case 'weekly': {
        const d = new Date(base);
        d.setDate(d.getDate() + 7);
        return d;
      }
      case 'monthly': {
        const d = new Date(base);
        d.setMonth(d.getMonth() + 1);
        d.setDate(Math.min(day, 28));
        return d;
      }
      case 'quarterly': {
        const d = new Date(base);
        d.setMonth(d.getMonth() + 3);
        d.setDate(Math.min(day, 28));
        return d;
      }
      case 'annually': {
        const d = new Date(base);
        d.setFullYear(d.getFullYear() + 1);
        d.setDate(Math.min(day, 28));
        return d;
      }
      default:
        throw new BadRequestException(`Invalid frequency: ${frequency}`);
    }
  }

  private buildUpcomingRuns(
    frequency: Frequency,
    dayOfMonth: number | null | undefined,
    nextRunAt: Date,
    runCount: number,
    maxRuns?: number | null,
    count = 5,
  ): string[] {
    const runs: string[] = [];
    let cursor = new Date(nextRunAt);
    let projectedRunCount = runCount;

    while (runs.length < count) {
      if (maxRuns !== null && maxRuns !== undefined && projectedRunCount >= maxRuns) break;
      runs.push(cursor.toISOString());
      projectedRunCount += 1;
      cursor = this.computeNextRunAt(frequency, dayOfMonth, cursor);
    }

    return runs;
  }

  private async recentHistory(recurringPoId: string, organizationId: string, limit = 10): Promise<RecurringPoHistoryItem[]> {
    return this.db
      .select({
        id: purchaseOrders.id,
        number: purchaseOrders.number,
        status: purchaseOrders.status,
        totalAmount: purchaseOrders.totalAmount,
        currency: purchaseOrders.currency,
        createdAt: purchaseOrders.createdAt,
      })
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.organizationId, organizationId), eq(purchaseOrders.recurringPoId, recurringPoId)))
      .orderBy(desc(purchaseOrders.createdAt))
      .limit(limit);
  }

  private async historyCount(recurringPoId: string, organizationId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.organizationId, organizationId), eq(purchaseOrders.recurringPoId, recurringPoId)));

    return row?.count ?? 0;
  }

  private async projectRecurringPo(
    recurringPo: any,
    vendor: { id: string; name: string } | null | undefined,
    organizationId: string,
    includeHistory = false,
  ) {
    const upcomingRuns = this.buildUpcomingRuns(
      recurringPo.frequency as Frequency,
      recurringPo.dayOfMonth,
      recurringPo.nextRunAt,
      recurringPo.runCount,
      recurringPo.maxRuns,
    );
    const count = await this.historyCount(recurringPo.id, organizationId);
    const history = includeHistory ? await this.recentHistory(recurringPo.id, organizationId) : [];

    return {
      ...recurringPo,
      vendor: vendor?.id ? vendor : null,
      upcomingRuns,
      historyCount: count,
      recentHistory: history,
    };
  }

  private async nextPoNumber(orgId: string): Promise<string> {
    const year = new Date().getFullYear();
    const rows = await this.db
      .update(sequences)
      .set({ lastValue: sql`${sequences.lastValue} + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(sequences.organizationId, orgId),
          eq(sequences.entityType, 'purchase_order'),
          eq(sequences.year, year),
        ),
      )
      .returning();

    if (!rows.length) {
      await this.db.insert(sequences).values({
        organizationId: orgId,
        entityType: 'purchase_order',
        year,
        lastValue: 1,
      });
      return `PO-${year}-0001`;
    }
    return `PO-${year}-${String(rows[0].lastValue).padStart(4, '0')}`;
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────────

  async findAll(organizationId: string) {
    const rows = await this.db
      .select({
        rpo: recurringPos,
        vendor: { id: vendors.id, name: vendors.name },
      })
      .from(recurringPos)
      .leftJoin(vendors, eq(recurringPos.vendorId, vendors.id))
      .where(eq(recurringPos.organizationId, organizationId))
      .orderBy(desc(recurringPos.createdAt));

    return Promise.all(rows.map((r) => this.projectRecurringPo(r.rpo, r.vendor?.id ? r.vendor : null, organizationId)));
  }

  async findOne(id: string, organizationId: string) {
    const [row] = await this.db
      .select({
        rpo: recurringPos,
        vendor: { id: vendors.id, name: vendors.name },
      })
      .from(recurringPos)
      .leftJoin(vendors, eq(recurringPos.vendorId, vendors.id))
      .where(and(eq(recurringPos.id, id), eq(recurringPos.organizationId, organizationId)));

    if (!row) throw new NotFoundException(`Recurring PO ${id} not found`);
    return this.projectRecurringPo(row.rpo, row.vendor?.id ? row.vendor : null, organizationId, true);
  }

  async create(
    organizationId: string,
    createdById: string,
    input: {
      title: string;
      description?: string;
      vendorId?: string;
      frequency: Frequency;
      dayOfMonth?: number;
      totalAmount: number;
      currency?: string;
      lines: RecurringPoLine[];
      glAccount?: string;
      notes?: string;
      maxRuns?: number;
      startDate?: string; // ISO string for first nextRunAt; defaults to computed
    },
  ) {
    if (!input.title) throw new BadRequestException('title is required');
    if (!['weekly', 'monthly', 'quarterly', 'annually'].includes(input.frequency)) {
      throw new BadRequestException('frequency must be weekly | monthly | quarterly | annually');
    }
    if (!input.lines?.length) throw new BadRequestException('at least one line is required');

    const nextRunAt = input.startDate
      ? new Date(input.startDate)
      : this.computeNextRunAt(input.frequency, input.dayOfMonth);

    const [rpo] = await this.db
      .insert(recurringPos)
      .values({
        organizationId,
        createdById,
        vendorId: input.vendorId ?? null,
        title: input.title,
        description: input.description ?? null,
        frequency: input.frequency,
        dayOfMonth: input.dayOfMonth ?? null,
        nextRunAt,
        active: true,
        totalAmount: String(input.totalAmount),
        currency: input.currency ?? 'USD',
        lines: input.lines as any,
        glAccount: input.glAccount ?? null,
        notes: input.notes ?? null,
        runCount: 0,
        maxRuns: input.maxRuns ?? null,
      })
      .returning();

    return this.findOne(rpo.id, organizationId);
  }

  async update(
    id: string,
    organizationId: string,
    input: {
      title?: string;
      description?: string;
      vendorId?: string;
      active?: boolean;
      frequency?: Frequency;
      dayOfMonth?: number;
      totalAmount?: number;
      currency?: string;
      lines?: RecurringPoLine[];
      glAccount?: string;
      notes?: string;
      maxRuns?: number;
    },
  ) {
    const existing = await this.findOne(id, organizationId);

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (input.title !== undefined) updates.title = input.title;
    if (input.description !== undefined) updates.description = input.description;
    if (input.vendorId !== undefined) updates.vendorId = input.vendorId;
    if (input.active !== undefined) updates.active = input.active;
    if (input.currency !== undefined) updates.currency = input.currency;
    if (input.totalAmount !== undefined) updates.totalAmount = String(input.totalAmount);
    if (input.lines !== undefined) updates.lines = input.lines;
    if (input.glAccount !== undefined) updates.glAccount = input.glAccount;
    if (input.notes !== undefined) updates.notes = input.notes;
    if (input.maxRuns !== undefined) updates.maxRuns = input.maxRuns;

    // If frequency or dayOfMonth changed, recompute nextRunAt
    if (input.frequency !== undefined || input.dayOfMonth !== undefined) {
      const freq = (input.frequency ?? existing.frequency) as Frequency;
      const dom = input.dayOfMonth ?? existing.dayOfMonth;
      updates.frequency = freq;
      updates.dayOfMonth = dom;
      updates.nextRunAt = this.computeNextRunAt(freq, dom);
    }

    await this.db
      .update(recurringPos)
      .set(updates as any)
      .where(and(eq(recurringPos.id, id), eq(recurringPos.organizationId, organizationId)));

    return this.findOne(id, organizationId);
  }

  async remove(id: string, organizationId: string) {
    await this.findOne(id, organizationId); // verify existence & ownership
    await this.db
      .delete(recurringPos)
      .where(and(eq(recurringPos.id, id), eq(recurringPos.organizationId, organizationId)));
    return { success: true };
  }

  async triggerRun(id: string, organizationId: string, triggeredBy: string) {
    const rpo = await this.findOne(id, organizationId);

    if (!rpo.active) throw new BadRequestException('Recurring PO is paused');
    if (!rpo.vendorId) throw new BadRequestException('A vendor must be set before running');

    const lines = (rpo.lines as RecurringPoLine[]) ?? [];
    if (!lines.length) throw new BadRequestException('No line items configured');

    // Check maxRuns
    if (rpo.maxRuns !== null && rpo.maxRuns !== undefined && rpo.runCount >= rpo.maxRuns) {
      throw new BadRequestException(`Max runs (${rpo.maxRuns}) already reached`);
    }

    const poNumber = await this.nextPoNumber(organizationId);

    const subtotal = lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);

    let createdPoId: string;

    await this.db.transaction(async (tx) => {
      const [po] = await tx
        .insert(purchaseOrders)
        .values({
          organizationId,
          recurringPoId: id,
          vendorId: rpo.vendorId!,
          number: poNumber,
          version: 1,
          poType: 'standard',
          status: 'draft',
          issuedBy: triggeredBy,
          currency: rpo.currency,
          notes: rpo.notes ?? undefined,
          subtotal: String(subtotal),
          taxAmount: '0',
          totalAmount: String(subtotal),
          shippingAddress: {},
          billingAddress: {},
        })
        .returning();

      createdPoId = po.id;

      await tx.insert(poLines).values(
        lines.map((l, i) => ({
          purchaseOrderId: po.id,
          lineNumber: i + 1,
          description: l.description,
          quantity: String(l.quantity),
          unitOfMeasure: l.unitOfMeasure ?? 'each',
          unitPrice: String(l.unitPrice),
          totalPrice: String(l.quantity * l.unitPrice),
          glAccount: rpo.glAccount ?? undefined,
        })),
      );
    });

    // Compute new runCount and check if we should deactivate
    const newRunCount = rpo.runCount + 1;
    const reachedMax = rpo.maxRuns !== null && rpo.maxRuns !== undefined && newRunCount >= rpo.maxRuns;
    const nextRunAt = reachedMax
      ? rpo.nextRunAt
      : this.computeNextRunAt(rpo.frequency as Frequency, rpo.dayOfMonth);

    await this.db
      .update(recurringPos)
      .set({
        runCount: newRunCount,
        lastRunAt: new Date(),
        nextRunAt,
        active: reachedMax ? false : true,
        updatedAt: new Date(),
      })
      .where(eq(recurringPos.id, id));

    return {
      purchaseOrderId: createdPoId!,
      purchaseOrderNumber: poNumber,
      runCount: newRunCount,
      reachedMax,
    };
  }

  async skipNext(id: string, organizationId: string) {
    const rpo = await this.findOne(id, organizationId);
    const skippedRunAt = rpo.nextRunAt;
    const nextRunAt = this.computeNextRunAt(rpo.frequency as Frequency, rpo.dayOfMonth, new Date(rpo.nextRunAt));

    await this.db
      .update(recurringPos)
      .set({
        nextRunAt,
        updatedAt: new Date(),
      })
      .where(and(eq(recurringPos.id, id), eq(recurringPos.organizationId, organizationId)));

    return {
      skippedRunAt,
      nextRunAt,
    };
  }
}
