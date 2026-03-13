import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { eq, and, ilike, or, desc } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db } from '@betterspend/db';
import { catalogItems, catalogPriceProposals } from '@betterspend/db';
import { NotificationsService } from '../notifications/notifications.service';

export interface CreateCatalogItemInput {
  vendorId?: string;
  sku?: string;
  name: string;
  description?: string;
  category?: string;
  unitOfMeasure?: string;
  unitPrice: number;
  currency?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateCatalogItemInput {
  vendorId?: string;
  sku?: string;
  name?: string;
  description?: string;
  category?: string;
  unitOfMeasure?: string;
  unitPrice?: number;
  currency?: string;
  isActive?: boolean;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class CatalogService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly notificationsService: NotificationsService,
  ) {}

  async findAll(organizationId: string, filters?: { vendorId?: string; category?: string; activeOnly?: boolean }) {
    return this.db.query.catalogItems.findMany({
      where: (c, { and, eq }) => {
        const conditions = [eq(c.organizationId, organizationId)];
        if (filters?.vendorId) conditions.push(eq(c.vendorId, filters.vendorId));
        if (filters?.category) conditions.push(eq(c.category, filters.category));
        if (filters?.activeOnly) conditions.push(eq(c.isActive, true));
        return and(...conditions);
      },
      with: { vendor: true },
      orderBy: (c, { asc }) => [asc(c.category), asc(c.name)],
    });
  }

  async search(organizationId: string, q: string) {
    const term = `%${q}%`;
    return this.db.query.catalogItems.findMany({
      where: (c, { and, eq, or, ilike }) =>
        and(
          eq(c.organizationId, organizationId),
          eq(c.isActive, true),
          or(ilike(c.name, term), ilike(c.sku, term), ilike(c.description, term)),
        ),
      with: { vendor: true },
      orderBy: (c, { asc }) => asc(c.name),
      limit: 20,
    });
  }

  async findOne(id: string, organizationId: string) {
    const item = await this.db.query.catalogItems.findFirst({
      where: (c, { and, eq }) => and(eq(c.id, id), eq(c.organizationId, organizationId)),
      with: { vendor: true },
    });
    if (!item) throw new NotFoundException(`Catalog item ${id} not found`);
    return item;
  }

  async create(organizationId: string, input: CreateCatalogItemInput) {
    const [item] = await this.db
      .insert(catalogItems)
      .values({
        organizationId,
        vendorId: input.vendorId ?? null,
        sku: input.sku ?? null,
        name: input.name,
        description: input.description ?? null,
        category: input.category ?? null,
        unitOfMeasure: input.unitOfMeasure ?? 'each',
        unitPrice: String(input.unitPrice),
        currency: input.currency ?? 'USD',
        metadata: input.metadata ?? {},
      })
      .returning();
    return this.findOne(item.id, organizationId);
  }

  async update(id: string, organizationId: string, input: UpdateCatalogItemInput) {
    await this.findOne(id, organizationId);
    await this.db
      .update(catalogItems)
      .set({
        ...input,
        unitPrice: input.unitPrice !== undefined ? String(input.unitPrice) : undefined,
        updatedAt: new Date(),
      })
      .where(and(eq(catalogItems.id, id), eq(catalogItems.organizationId, organizationId)));
    return this.findOne(id, organizationId);
  }

  async remove(id: string, organizationId: string) {
    await this.findOne(id, organizationId);
    await this.db
      .delete(catalogItems)
      .where(and(eq(catalogItems.id, id), eq(catalogItems.organizationId, organizationId)));
  }

  async getCategories(organizationId: string): Promise<string[]> {
    const items = await this.db.query.catalogItems.findMany({
      where: (c, { eq }) => eq(c.organizationId, organizationId),
      columns: { category: true },
    });
    const cats = [...new Set(items.map((i) => i.category).filter(Boolean))] as string[];
    return cats.sort();
  }

  async listPriceProposals(organizationId: string, status?: string) {
    return this.db.query.catalogPriceProposals.findMany({
      where: (p, { and, eq }) =>
        and(
          eq(p.organizationId, organizationId),
          status ? eq(p.status, status) : undefined,
        ),
      with: {
        item: { with: { vendor: true } },
        vendor: true,
        reviewer: true,
      },
      orderBy: (p, { desc }) => desc(p.submittedAt),
    });
  }

  async reviewPriceProposal(
    proposalId: string,
    organizationId: string,
    reviewerId: string,
    input: { status: 'approved' | 'rejected'; reviewNote?: string },
  ) {
    const proposal = await this.db.query.catalogPriceProposals.findFirst({
      where: (p, { and, eq }) =>
        and(eq(p.id, proposalId), eq(p.organizationId, organizationId)),
      with: {
        item: true,
      },
    });
    if (!proposal) throw new NotFoundException(`Catalog price proposal ${proposalId} not found`);

    const [updated] = await this.db
      .update(catalogPriceProposals)
      .set({
        status: input.status,
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        reviewNote: input.reviewNote ?? null,
      })
      .where(and(eq(catalogPriceProposals.id, proposalId), eq(catalogPriceProposals.organizationId, organizationId)))
      .returning();

    if (input.status === 'approved') {
      await this.db
        .update(catalogItems)
        .set({
          unitPrice: String(updated.proposedPrice),
          updatedAt: new Date(),
        })
        .where(eq(catalogItems.id, proposal.itemId));
    }

    if (proposal.item?.vendorId) {
      const vendor = await this.db.query.vendors.findFirst({
        where: (v, { and, eq }) =>
          and(eq(v.id, proposal.vendorId), eq(v.organizationId, organizationId)),
      });
      if (vendor) {
        const vendorOwnerId = null;
        if (vendorOwnerId) {
          await this.notificationsService.create(
            organizationId,
            vendorOwnerId,
            'catalog_price_proposal_reviewed',
            `${proposal.item.name} price proposal ${input.status}`,
            input.reviewNote ?? undefined,
            'catalog_price_proposal',
            proposalId,
          );
        }
      }
    }

    return this.db.query.catalogPriceProposals.findFirst({
      where: (p, { eq }) => eq(p.id, proposalId),
      with: {
        item: { with: { vendor: true } },
        vendor: true,
        reviewer: true,
      },
    });
  }
}
