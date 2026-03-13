import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { Db } from '@betterspend/db';
import { exchangeRates, organizations } from '@betterspend/db';
import { DB_TOKEN } from '../../database/database.module';

export interface UpsertExchangeRateInput {
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  isManual?: boolean;
}

@Injectable()
export class ExchangeRatesService {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  private normalizeCurrency(code: string, fieldName: string) {
    const normalized = code.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalized)) {
      throw new BadRequestException(`${fieldName} must be a 3-letter currency code`);
    }
    return normalized;
  }

  private validateRate(rate: number) {
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new BadRequestException('Exchange rate must be greater than zero');
    }
    return rate;
  }

  async getOrganizationBaseCurrency(organizationId: string) {
    const org = await this.db.query.organizations.findFirst({
      where: (record, { eq }) => eq(record.id, organizationId),
    });
    if (!org) throw new BadRequestException(`Organization ${organizationId} not found`);
    return org.baseCurrency ?? 'USD';
  }

  async list(organizationId: string) {
    const rows = await this.db.query.exchangeRates.findMany({
      where: (record, { eq }) => eq(record.orgId, organizationId),
      orderBy: (record, { desc, asc }) => [asc(record.fromCurrency), asc(record.toCurrency), desc(record.fetchedAt)],
    });

    const latest = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const key = `${row.fromCurrency}:${row.toCurrency}`;
      if (!latest.has(key)) latest.set(key, row);
    }
    return Array.from(latest.values());
  }

  async upsert(organizationId: string, input: UpsertExchangeRateInput) {
    const fromCurrency = this.normalizeCurrency(input.fromCurrency, 'From currency');
    const toCurrency = this.normalizeCurrency(input.toCurrency, 'To currency');
    const rate = this.validateRate(input.rate);

    const [row] = await this.db.insert(exchangeRates).values({
      orgId: organizationId,
      fromCurrency,
      toCurrency,
      rate: String(rate),
      isManual: input.isManual ?? true,
    }).onConflictDoUpdate({
      target: [exchangeRates.orgId, exchangeRates.fromCurrency, exchangeRates.toCurrency],
      set: {
        rate: String(rate),
        isManual: input.isManual ?? true,
        fetchedAt: new Date(),
      },
    }).returning();

    return row;
  }

  async update(organizationId: string, id: string, input: UpsertExchangeRateInput) {
    const existing = await this.db.query.exchangeRates.findFirst({
      where: (record, { and, eq }) => and(eq(record.id, id), eq(record.orgId, organizationId)),
    });
    if (!existing) {
      throw new BadRequestException(`Exchange rate ${id} not found`);
    }

    const fromCurrency = this.normalizeCurrency(input.fromCurrency, 'From currency');
    const toCurrency = this.normalizeCurrency(input.toCurrency, 'To currency');
    const rate = this.validateRate(input.rate);

    const [row] = await this.db.update(exchangeRates)
      .set({
        fromCurrency,
        toCurrency,
        rate: String(rate),
        isManual: input.isManual ?? true,
        fetchedAt: new Date(),
      })
      .where(and(eq(exchangeRates.id, id), eq(exchangeRates.orgId, organizationId)))
      .returning();

    return row;
  }

  async remove(organizationId: string, id: string) {
    const [row] = await this.db.delete(exchangeRates)
      .where(and(eq(exchangeRates.id, id), eq(exchangeRates.orgId, organizationId)))
      .returning();

    if (!row) {
      throw new BadRequestException(`Exchange rate ${id} not found`);
    }

    return row;
  }

  async getRate(organizationId: string, fromCurrency: string, toCurrency: string, overrideRate?: number | null) {
    const from = fromCurrency.toUpperCase();
    const to = toCurrency.toUpperCase();
    if (from === to) return 1;
    if (overrideRate != null) return overrideRate;

    const latest = await this.db.query.exchangeRates.findFirst({
      where: (record, { and, eq }) =>
        and(eq(record.orgId, organizationId), eq(record.fromCurrency, from), eq(record.toCurrency, to)),
      orderBy: (record, { desc }) => desc(record.fetchedAt),
    });

    if (!latest) {
      throw new BadRequestException(`No exchange rate configured for ${from} -> ${to}`);
    }

    return Number(latest.rate);
  }

  roundMoney(amount: number) {
    return Math.round(amount * 100) / 100;
  }

  async convertToBase(organizationId: string, amount: number, currency: string, overrideRate?: number | null) {
    const baseCurrency = await this.getOrganizationBaseCurrency(organizationId);
    const exchangeRate = await this.getRate(organizationId, currency, baseCurrency, overrideRate);
    const baseAmount = this.roundMoney(amount * exchangeRate);
    return { baseCurrency, exchangeRate, baseAmount };
  }

  async updateOrganizationBaseCurrency(organizationId: string, baseCurrency: string) {
    const normalizedBaseCurrency = this.normalizeCurrency(baseCurrency, 'Base currency');
    const [org] = await this.db.update(organizations)
      .set({ baseCurrency: normalizedBaseCurrency, updatedAt: new Date() })
      .where(eq(organizations.id, organizationId))
      .returning();
    return org;
  }
}
