import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db } from '@betterspend/db';
import { vendors } from '@betterspend/db';
import { EntitiesService } from '../entities/entities.service';

@Injectable()
export class VendorsService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly entitiesService: EntitiesService,
  ) {}

  async findAll(organizationId: string, entityId?: string) {
    return this.db.query.vendors.findMany({
      where: (v, { and, eq, isNull, or }) =>
        and(
          eq(v.organizationId, organizationId),
          entityId ? or(eq(v.entityId, entityId), isNull(v.entityId)) : undefined,
        ),
      orderBy: (v, { asc }) => asc(v.name),
      with: { entity: true },
    });
  }

  async findOne(id: string, organizationId: string) {
    const vendor = await this.db.query.vendors.findFirst({
      where: (v, { and, eq }) =>
        and(eq(v.id, id), eq(v.organizationId, organizationId)),
      with: { entity: true },
    });

    if (!vendor) throw new NotFoundException(`Vendor ${id} not found`);
    return vendor;
  }

  async create(data: typeof vendors.$inferInsert) {
    await this.entitiesService.assertBelongsToOrg(data.organizationId, data.entityId);
    const [vendor] = await this.db.insert(vendors).values(data).returning();
    return vendor;
  }

  async update(id: string, organizationId: string, data: Partial<typeof vendors.$inferInsert>) {
    await this.findOne(id, organizationId);
    await this.entitiesService.assertBelongsToOrg(organizationId, data.entityId);
    const [vendor] = await this.db
      .update(vendors)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(vendors.id, id), eq(vendors.organizationId, organizationId)))
      .returning();

    if (!vendor) throw new NotFoundException(`Vendor ${id} not found`);
    return vendor;
  }

  async updateEsg(id: string, organizationId: string, data: {
    diversityCategories?: string[];
    esgRating?: string;
    carbonFootprintTons?: string;
    sustainabilityCertifications?: string[];
    esgNotes?: string;
    diversityVerifiedAt?: string;
  }) {
    await this.findOne(id, organizationId);
    const [vendor] = await this.db
      .update(vendors)
      .set({
        ...(data.diversityCategories !== undefined && { diversityCategories: data.diversityCategories }),
        ...(data.esgRating !== undefined && { esgRating: data.esgRating }),
        ...(data.carbonFootprintTons !== undefined && { carbonFootprintTons: data.carbonFootprintTons }),
        ...(data.sustainabilityCertifications !== undefined && { sustainabilityCertifications: data.sustainabilityCertifications }),
        ...(data.esgNotes !== undefined && { esgNotes: data.esgNotes }),
        ...(data.diversityVerifiedAt && { diversityVerifiedAt: new Date(data.diversityVerifiedAt) }),
        updatedAt: new Date(),
      })
      .where(and(eq(vendors.id, id), eq(vendors.organizationId, organizationId)))
      .returning();
    return vendor;
  }

  async getDiversitySummary(organizationId: string) {
    const allVendors = await this.db.query.vendors.findMany({
      where: eq(vendors.organizationId, organizationId),
    });

    const diversityCategories: Record<string, number> = {};
    const esgRatings: Record<string, number> = {};
    let diverseCount = 0;
    let ratedCount = 0;

    for (const v of allVendors) {
      const cats = (v.diversityCategories as string[]) ?? [];
      if (cats.length > 0) diverseCount++;
      for (const c of cats) {
        diversityCategories[c] = (diversityCategories[c] ?? 0) + 1;
      }
      if (v.esgRating) {
        ratedCount++;
        esgRatings[v.esgRating] = (esgRatings[v.esgRating] ?? 0) + 1;
      }
    }

    return {
      totalVendors: allVendors.length,
      diverseVendors: diverseCount,
      diversityRate: allVendors.length ? Math.round((diverseCount / allVendors.length) * 100) : 0,
      esgRatedVendors: ratedCount,
      diversityBreakdown: diversityCategories,
      esgRatingBreakdown: esgRatings,
      topDiverseVendors: allVendors
        .filter((v) => ((v.diversityCategories as string[]) ?? []).length > 0)
        .slice(0, 10)
        .map((v) => ({ id: v.id, name: v.name, categories: v.diversityCategories, esgRating: v.esgRating })),
    };
  }

    async getTransactions(id: string, organizationId: string) {
    await this.findOne(id, organizationId);

    const [invoiceRows, poRows] = await Promise.all([
      this.db.execute(sql`
        SELECT
          i.id, i.internal_number AS number, i.invoice_number AS "vendorInvoiceNumber",
          i.status, i.match_status AS "matchStatus", i.total_amount::numeric AS amount,
          i.invoice_date AS date, i.approved_at AS "approvedAt"
        FROM invoices i
        WHERE i.vendor_id = ${id} AND i.organization_id = ${organizationId}
        ORDER BY i.created_at DESC
        LIMIT 50
      `),
      this.db.execute(sql`
        SELECT
          po.id, po.internal_number AS number, po.status,
          po.total_amount::numeric AS amount, po.issued_at AS "issuedAt", po.created_at AS date
        FROM purchase_orders po
        WHERE po.vendor_id = ${id} AND po.organization_id = ${organizationId}
        ORDER BY po.created_at DESC
        LIMIT 50
      `),
    ]);

    return { invoices: invoiceRows, purchaseOrders: poRows };
  }
}
