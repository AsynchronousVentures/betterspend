import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
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
    const fromCurrency = input.fromCurrency.toUpperCase();
    const toCurrency = input.toCurrency.toUpperCase();

    const [row] = await this.db.insert(exchangeRates).values({
      orgId: organizationId,
      fromCurrency,
      toCurrency,
      rate: String(input.rate),
      isManual: input.isManual ?? true,
    }).returning();

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
    const [org] = await this.db.update(organizations)
      .set({ baseCurrency: baseCurrency.toUpperCase(), updatedAt: new Date() })
      .where(eq(organizations.id, organizationId))
      .returning();
    return org;
  }
}
