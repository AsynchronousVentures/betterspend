import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { Db } from '@betterspend/db';
import { taxCodes } from '@betterspend/db';
import { DB_TOKEN } from '../../database/database.module';

export interface CreateTaxCodeInput {
  name: string;
  code: string;
  ratePercent: number;
  taxType: 'VAT' | 'GST' | 'SALES_TAX' | 'EXEMPT';
  isRecoverable?: boolean;
  glAccountCode?: string;
}

export interface UpdateTaxCodeInput {
  name?: string;
  code?: string;
  ratePercent?: number;
  taxType?: 'VAT' | 'GST' | 'SALES_TAX' | 'EXEMPT';
  isRecoverable?: boolean;
  glAccountCode?: string | null;
}

@Injectable()
export class TaxCodesService {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  findAll(organizationId: string) {
    return this.db.query.taxCodes.findMany({
      where: (taxCode, { eq }) => eq(taxCode.orgId, organizationId),
      orderBy: (taxCode, { asc }) => asc(taxCode.name),
    });
  }

  async findOne(id: string, organizationId: string) {
    const taxCode = await this.db.query.taxCodes.findFirst({
      where: (record, { and, eq }) => and(eq(record.id, id), eq(record.orgId, organizationId)),
    });
    if (!taxCode) throw new NotFoundException(`Tax code ${id} not found`);
    return taxCode;
  }

  async create(organizationId: string, input: CreateTaxCodeInput) {
    const [taxCode] = await this.db.insert(taxCodes).values({
      orgId: organizationId,
      name: input.name,
      code: input.code.toUpperCase(),
      ratePercent: String(input.ratePercent),
      taxType: input.taxType,
      isRecoverable: input.isRecoverable ?? true,
      glAccountCode: input.glAccountCode ?? null,
    }).returning();
    return taxCode;
  }

  async update(id: string, organizationId: string, input: UpdateTaxCodeInput) {
    await this.findOne(id, organizationId);
    const [taxCode] = await this.db.update(taxCodes)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.code !== undefined ? { code: input.code.toUpperCase() } : {}),
        ...(input.ratePercent !== undefined ? { ratePercent: String(input.ratePercent) } : {}),
        ...(input.taxType !== undefined ? { taxType: input.taxType } : {}),
        ...(input.isRecoverable !== undefined ? { isRecoverable: input.isRecoverable } : {}),
        ...(input.glAccountCode !== undefined ? { glAccountCode: input.glAccountCode } : {}),
      })
      .where(and(eq(taxCodes.id, id), eq(taxCodes.orgId, organizationId)))
      .returning();
    return taxCode;
  }

  async remove(id: string, organizationId: string) {
    await this.findOne(id, organizationId);
    await this.db.delete(taxCodes).where(and(eq(taxCodes.id, id), eq(taxCodes.orgId, organizationId)));
    return { ok: true };
  }
}
