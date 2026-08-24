import { Injectable, Inject, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { eq, and, ilike, or, desc, isNull } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db } from '@betterspend/db';
import { auditLog, catalogItems, catalogPriceProposals } from '@betterspend/db';
import { z } from 'zod';
import { MailService } from '../../common/mail/mail.service';
import { SettingsService } from '../settings/settings.service';

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
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly mailService: MailService,
    private readonly settingsService: SettingsService,
  ) {}

  async findAll(organizationId: string, filters?: { vendorId?: string; category?: string; activeOnly?: boolean }) {
    await this.applyDueApprovedProposals(organizationId);
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
    await this.applyDueApprovedProposals(organizationId);
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
    await this.applyDueApprovedProposals(organizationId);
    const item = await this.db.query.catalogItems.findFirst({
      where: (c, { and, eq }) => and(eq(c.id, id), eq(c.organizationId, organizationId)),
      with: { vendor: true },
    });
    if (!item) throw new NotFoundException(`Catalog item ${id} not found`);
    const proposals = await this.db.query.catalogPriceProposals.findMany({
      where: (proposal, { and, eq }) =>
        and(eq(proposal.organizationId, organizationId), eq(proposal.itemId, id)),
      with: {
        vendor: true,
        reviewer: true,
      },
      orderBy: (proposal, { desc }) => desc(proposal.submittedAt),
    });
    return {
      ...item,
      priceProposals: proposals,
    };
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
    await this.applyDueApprovedProposals(organizationId);
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

    // Guard on pending state so a second review cannot re-apply an old price
    // or clobber the original application metadata.
    const [updated] = await this.db
      .update(catalogPriceProposals)
      .set({
        status: input.status,
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        reviewNote: input.reviewNote ?? null,
      })
      .where(
        and(
          eq(catalogPriceProposals.id, proposalId),
          eq(catalogPriceProposals.organizationId, organizationId),
          eq(catalogPriceProposals.status, 'pending'),
        ),
      )
      .returning();
    if (!updated) {
      throw new BadRequestException(`Catalog price proposal ${proposalId} was already reviewed`);
    }

    // Approved proposals take effect immediately unless the supplier set a
    // future effective date; those are applied by applyDueApprovedProposals.
    if (input.status === 'approved') {
      await this.applyProposalIfDue(updated);
    }

    await this.notifyVendorOfDecision(updated, input.status, input.reviewNote);

    return this.db.query.catalogPriceProposals.findFirst({
      where: (p, { eq }) => eq(p.id, proposalId),
      with: {
        item: { with: { vendor: true } },
        vendor: true,
        reviewer: true,
      },
    });
  }

  /**
   * Auto-approve a just-submitted proposal when the org allows price changes
   * within `catalog_auto_approve_price_change_pct` percent through without
   * manual review. Called by the vendor portal right after insertion; a no-op
   * when the setting is disabled or the change exceeds the threshold.
   */
  async considerAutoApproval(proposalId: string, organizationId: string): Promise<boolean> {
    const threshold = await this.settingsService.get(
      organizationId,
      'catalog_auto_approve_price_change_pct',
    );
    const thresholdBasisPoints = decimalToScaledInteger(threshold, 2);
    if (thresholdBasisPoints == null || thresholdBasisPoints <= 0n) return false;

    const proposal = await this.db.query.catalogPriceProposals.findFirst({
      where: (p, { and, eq }) =>
        and(eq(p.id, proposalId), eq(p.organizationId, organizationId), eq(p.status, 'pending')),
    });
    if (!proposal) return false;

    const currentCents = decimalToScaledInteger(proposal.currentPrice, 2);
    const proposedCents = decimalToScaledInteger(proposal.proposedPrice, 2);
    if (currentCents == null || proposedCents == null || currentCents <= 0n) return false;

    const differenceCents =
      proposedCents >= currentCents
        ? proposedCents - currentCents
        : currentCents - proposedCents;
    if (differenceCents * 10_000n > currentCents * thresholdBasisPoints) return false;

    const changeBasisPoints = (differenceCents * 10_000n + currentCents / 2n) / currentCents;
    const reviewNote = `Auto-approved: ${formatBasisPoints(changeBasisPoints)}% change is within the ${formatBasisPoints(thresholdBasisPoints)}% threshold`;
    const approved = await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(catalogPriceProposals)
        .set({ status: 'approved', reviewedAt: new Date(), reviewNote })
        .where(
          and(
            eq(catalogPriceProposals.id, proposal.id),
            eq(catalogPriceProposals.status, 'pending'),
          ),
        )
        .returning();
      if (!updated) return undefined;
      await tx.insert(auditLog).values({
        organizationId,
        userId: null,
        entityType: 'catalog_price_proposal',
        entityId: proposal.id,
        action: 'auto_approved',
        changes: {
          currentPrice: proposal.currentPrice,
          proposedPrice: proposal.proposedPrice,
          thresholdPercent: threshold,
        },
      });
      return updated;
    });
    if (!approved) return false;

    await this.applyProposalIfDue(approved);
    await this.notifyVendorOfDecision(approved, 'approved', approved.reviewNote);
    this.logger.log(
      `Auto-approved catalog price proposal ${approved.id} (${formatBasisPoints(changeBasisPoints)}% <= ${formatBasisPoints(thresholdBasisPoints)}%)`,
    );
    return true;
  }

  /** Apply approved proposals whose effective date has arrived. Idempotent; runs lazily on buyer reads. */
  async applyDueApprovedProposals(organizationId: string): Promise<void> {
    const due = await this.db.query.catalogPriceProposals.findMany({
      where: (p, { and, eq, isNull, lte }) =>
        and(
          eq(p.organizationId, organizationId),
          eq(p.status, 'approved'),
          isNull(p.appliedAt),
          or(isNull(p.effectiveDate), lte(p.effectiveDate, new Date())),
        ),
      // Apply in effective-date order so the chronologically latest due
      // proposal ends up as the item's final price.
      orderBy: (p, { asc, sql: orderBySql }) =>
        [
          orderBySql`${p.effectiveDate} asc nulls first`,
          asc(p.reviewedAt),
          asc(p.id),
        ],
      limit: 50,
    });

    for (const proposal of due) {
      try {
        await this.applyProposalIfDue(proposal);
      } catch (error) {
        this.logger.warn(`Failed to apply price proposal ${proposal.id}: ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  /** Write the proposed price to the catalog item once its effective date has arrived. */
  private async applyProposalIfDue(proposal: typeof catalogPriceProposals.$inferSelect): Promise<boolean> {
    const due = !proposal.effectiveDate || proposal.effectiveDate.getTime() <= Date.now();
    if (!due) return false;

    // Single transaction so a crash between the two writes cannot leave the
    // item repriced with appliedAt still null (which would re-apply later).
    return this.db.transaction(async (tx) => {
      // Approved scheduled prices intentionally override later manual edits.
      // Lock and capture the live value so the audit records what was actually
      // replaced, including an intervening edit or earlier due proposal.
      const [item] = await tx
        .select({ unitPrice: catalogItems.unitPrice })
        .from(catalogItems)
        .where(eq(catalogItems.id, proposal.itemId))
        .for('update');
      if (!item) return false;
      const [claimed] = await tx
        .update(catalogPriceProposals)
        .set({ appliedAt: new Date() })
        .where(
          and(
            eq(catalogPriceProposals.id, proposal.id),
            eq(catalogPriceProposals.status, 'approved'),
            isNull(catalogPriceProposals.appliedAt),
          ),
        )
        .returning({ id: catalogPriceProposals.id });
      if (!claimed) return false;
      await tx
        .update(catalogItems)
        .set({ unitPrice: String(proposal.proposedPrice), updatedAt: new Date() })
        .where(eq(catalogItems.id, proposal.itemId));
      await tx.insert(auditLog).values({
        organizationId: proposal.organizationId,
        userId: null,
        entityType: 'catalog_item',
        entityId: proposal.itemId,
        action: 'scheduled_price_applied',
        changes: {
          proposalId: proposal.id,
          previousPrice: item.unitPrice,
          unitPrice: proposal.proposedPrice,
        },
      });
      return true;
    });
  }

  /**
   * Email the vendor contact about an approve/reject outcome and record it in
   * notified_vendor so buyers can see delivery happened. Vendors are not app
   * users; email plus the portal's proposal history is the channel.
   */
  private async notifyVendorOfDecision(
    proposal: typeof catalogPriceProposals.$inferSelect,
    status: 'approved' | 'rejected',
    reviewNote?: string | null,
  ): Promise<void> {
    try {
      const vendor = await this.db.query.vendors.findFirst({
        where: (v, { and, eq }) =>
          and(eq(v.id, proposal.vendorId), eq(v.organizationId, proposal.organizationId)),
      });
      const email = extractContactEmail(vendor?.contactInfo);
      if (!vendor || !email) return;

      const settings = await this.settingsService.getAll(proposal.organizationId);
      const smtpHost = settings['smtp_host'] || '';
      if (!smtpHost) {
        this.logger.log(`SMTP not configured; skipping vendor notification for proposal ${proposal.id}`);
        return;
      }
      const appName = escapeHtml(settings['app_name'] || 'BetterSpend');
      const vendorName = escapeHtml(vendor.name);
      const statusLabel = status === 'approved' ? 'Approved' : 'Rejected';
      const escapedNote = reviewNote ? escapeHtml(reviewNote) : null;
      const sent = await this.mailService.sendMail(
        {
          host: smtpHost,
          port: parseInt(settings['smtp_port'] || '587', 10),
          secure: settings['smtp_secure'] === 'true',
          user: settings['smtp_user'] || '',
          pass: settings['smtp_pass'] || '',
          from: settings['smtp_from'] || `noreply@${smtpHost}`,
        },
        {
          to: email,
          subject: `[${appName}] Catalog Price Proposal ${statusLabel}`,
          html: `
            <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
              <h2 style="color:#0f172a">Catalog Price Proposal ${statusLabel}</h2>
              <p>Dear ${vendorName},</p>
              <p>Your price proposal for <strong>${escapeHtml(proposal.currentPrice)} &rarr; ${escapeHtml(proposal.proposedPrice)}</strong> has been <strong>${statusLabel}</strong>.</p>
              ${escapedNote ? `<p><strong>Note from the buyer:</strong> ${escapedNote}</p>` : ''}
              <hr style="margin:24px 0;border:none;border-top:1px solid #e2e8f0">
              <p style="color:#94a3b8;font-size:12px">This is an automated notification from ${appName}.</p>
            </div>
          `,
          text: `Your price proposal (${proposal.currentPrice} -> ${proposal.proposedPrice}) has been ${statusLabel}.${reviewNote ? `\n\nBuyer note: ${reviewNote}` : ''}`,
        },
      );
      if (sent) {
        await this.db
          .update(catalogPriceProposals)
          .set({ notifiedVendor: true })
          .where(eq(catalogPriceProposals.id, proposal.id));
      }
    } catch (error) {
      this.logger.warn(`Failed to notify vendor for proposal ${proposal.id}: ${error instanceof Error ? error.message : error}`);
    }
  }
}

function extractContactEmail(contactInfo: unknown): string | undefined {
  if (!contactInfo || typeof contactInfo !== 'object') return undefined;
  const email = (contactInfo as Record<string, unknown>)['email'];
  if (typeof email !== 'string' || /[,;\r\n]/.test(email)) return undefined;
  const parsed = z.string().trim().email().safeParse(email);
  return parsed.success ? parsed.data : undefined;
}

function decimalToScaledInteger(value: string, scale: number): bigint | null {
  const match = value.trim().match(/^(\d+)(?:\.(\d+))?$/);
  if (!match || (match[2]?.length ?? 0) > scale) return null;
  const fraction = (match[2] ?? '').padEnd(scale, '0');
  return BigInt(`${match[1]}${fraction}`);
}

function formatBasisPoints(value: bigint): string {
  const whole = value / 100n;
  const fraction = String(value % 100n).padStart(2, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
