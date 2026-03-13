import {
  Injectable,
  Inject,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { eq, and, gt, sql } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { DB_TOKEN } from '../../database/database.module';
import type { Db } from '@betterspend/db';
import {
  vendorPortalTokens,
  vendors,
  purchaseOrders,
  invoices,
  invoiceLines,
  catalogItems,
  catalogPriceProposals,
} from '@betterspend/db';
import { MailService } from '../../common/mail/mail.service';
import { SettingsService } from '../settings/settings.service';
import { SequenceService } from '../../common/services/sequence.service';
import { MatchingService } from '../invoices/matching.service';
import { VendorsService } from '../vendors/vendors.service';

export interface SubmitInvoiceInput {
  purchaseOrderId: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string;
  currency?: string;
  lines: Array<{
    poLineId?: string;
    lineNumber: number;
    description: string;
    quantity: number;
    unitPrice: number;
  }>;
}

export interface SubmitCatalogPriceProposalInput {
  itemId: string;
  proposedPrice: number;
  effectiveDate?: string;
  note?: string;
}

export interface BulkCatalogPriceProposalRow {
  itemId?: string;
  sku?: string;
  proposedPrice: number;
  effectiveDate?: string;
  note?: string;
}

@Injectable()
export class VendorPortalService {
  private readonly logger = new Logger(VendorPortalService.name);

  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly mailService: MailService,
    private readonly settingsService: SettingsService,
    private readonly sequenceService: SequenceService,
    private readonly matchingService: MatchingService,
    private readonly vendorsService: VendorsService,
  ) {}

  async sendAccessLink(vendorId: string, orgId: string): Promise<{ success: boolean }> {
    const vendor = await this.db.query.vendors.findFirst({
      where: (v, { and, eq }) => and(eq(v.id, vendorId), eq(v.organizationId, orgId)),
    });
    if (!vendor) throw new NotFoundException(`Vendor ${vendorId} not found`);

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await this.db.insert(vendorPortalTokens).values({ vendorId, token, expiresAt });

    const settings = await this.settingsService.getAll(orgId);
    const appName = settings['app_name'] || 'BetterSpend';
    const appUrl = settings['app_url'] || process.env['WEB_URL'] || 'http://localhost:3100';
    const portalLink = `${appUrl}/vendor-portal?token=${token}`;

    const vendorEmail = (vendor.contactInfo as any)?.email;
    if (!vendorEmail) {
      this.logger.warn(`Vendor ${vendorId} has no contact email; access link generated: ${portalLink}`);
      return { success: true };
    }

    const smtpHost = settings['smtp_host'] || '';
    if (smtpHost) {
      const smtpConfig = {
        host: smtpHost,
        port: parseInt(settings['smtp_port'] || '587', 10),
        secure: settings['smtp_secure'] === 'true',
        user: settings['smtp_user'] || '',
        pass: settings['smtp_pass'] || '',
        from: settings['smtp_from'] || `noreply@${smtpHost}`,
      };

      this.mailService
        .sendMail(smtpConfig, {
          to: vendorEmail,
          subject: `[${appName}] Access Your Vendor Portal`,
          html: `
            <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
              <h2 style="color:#0f172a">Your Vendor Portal Access Link</h2>
              <p>Dear ${vendor.name},</p>
              <p>You have been invited to access the ${appName} Vendor Portal. Use the link below to view your purchase orders, track invoices, and submit new invoices.</p>
              <p>This link is valid for <strong>7 days</strong>.</p>
              <a href="${portalLink}" style="display:inline-block;background:#3b82f6;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;margin:16px 0">Access Vendor Portal</a>
              <p style="color:#64748b;font-size:13px">If you did not expect this email, you can safely ignore it.</p>
              <hr style="margin:24px 0;border:none;border-top:1px solid #e2e8f0">
              <p style="color:#94a3b8;font-size:12px">This is an automated notification from ${appName}.</p>
            </div>
          `,
          text: `Vendor Portal Access\n\nDear ${vendor.name},\n\nAccess your vendor portal here:\n${portalLink}\n\nThis link expires in 7 days.`,
        })
        .catch((err) => this.logger.error(`Failed to send vendor portal email: ${err}`));
    } else {
      this.logger.log(`Vendor portal link for ${vendor.name} (${vendorEmail}): ${portalLink}`);
    }

    return { success: true };
  }

  async validateToken(token: string): Promise<string> {
    const record = await this.db.query.vendorPortalTokens.findFirst({
      where: (t, { and, eq, gt }) =>
        and(eq(t.token, token), eq(t.used, false), gt(t.expiresAt, new Date())),
    });
    if (!record) throw new UnauthorizedException('Invalid or expired portal token');
    return record.vendorId;
  }

  async getVendorDashboard(vendorId: string, orgId: string) {
    const vendor = await this.db.query.vendors.findFirst({
      where: (v, { and, eq }) => and(eq(v.id, vendorId), eq(v.organizationId, orgId)),
    });
    if (!vendor) throw new NotFoundException('Vendor not found');

    const [poRows, invoiceRows] = await Promise.all([
      this.db.execute(sql`
        SELECT
          po.id, po.internal_number AS "internalNumber", po.status,
          po.total_amount::numeric AS "totalAmount", po.currency,
          po.issued_at AS "issuedAt", po.created_at AS "createdAt"
        FROM purchase_orders po
        WHERE po.vendor_id = ${vendorId} AND po.organization_id = ${orgId}
        ORDER BY po.created_at DESC
        LIMIT 10
      `),
      this.db.execute(sql`
        SELECT
          i.id, i.internal_number AS "internalNumber",
          i.invoice_number AS "invoiceNumber",
          i.status, i.match_status AS "matchStatus",
          i.total_amount::numeric AS "totalAmount", i.currency,
          i.invoice_date AS "invoiceDate", i.due_date AS "dueDate",
          i.created_at AS "createdAt"
        FROM invoices i
        WHERE i.vendor_id = ${vendorId} AND i.organization_id = ${orgId}
        ORDER BY i.created_at DESC
        LIMIT 10
      `),
    ]);

    // Stats
    const statsRows = await this.db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM purchase_orders WHERE vendor_id = ${vendorId} AND organization_id = ${orgId}) AS "totalPOs",
        (SELECT COALESCE(SUM(total_amount::numeric), 0) FROM invoices WHERE vendor_id = ${vendorId} AND organization_id = ${orgId}) AS "totalInvoiced",
        (SELECT COALESCE(SUM(total_amount::numeric), 0) FROM invoices WHERE vendor_id = ${vendorId} AND organization_id = ${orgId} AND status NOT IN ('paid')) AS "pendingPayment"
    `);

    const stats = statsRows[0] ?? { totalPOs: 0, totalInvoiced: 0, pendingPayment: 0 };

    return {
      vendor,
      purchaseOrders: poRows,
      invoices: invoiceRows,
      stats: {
        totalPOs: Number(stats['totalPOs'] ?? 0),
        totalInvoiced: Number(stats['totalInvoiced'] ?? 0),
        pendingPayment: Number(stats['pendingPayment'] ?? 0),
      },
    };
  }

  async getPurchaseOrderForVendor(poId: string, vendorId: string, orgId: string) {
    const po = await this.db.query.purchaseOrders.findFirst({
      where: (p, { and, eq }) =>
        and(eq(p.id, poId), eq(p.vendorId, vendorId), eq(p.organizationId, orgId)),
      with: { lines: true },
    });
    if (!po) throw new ForbiddenException('Purchase order not found or does not belong to your account');
    return po;
  }

  async submitInvoice(vendorId: string, orgId: string, data: SubmitInvoiceInput) {
    // Verify the PO belongs to this vendor
    const po = await this.db.query.purchaseOrders.findFirst({
      where: (p, { and, eq }) =>
        and(eq(p.id, data.purchaseOrderId), eq(p.vendorId, vendorId), eq(p.organizationId, orgId)),
    });
    if (!po) throw new ForbiddenException('Purchase order not found or does not belong to your account');

    // Check for duplicate invoice
    const duplicate = await this.db.query.invoices.findFirst({
      where: (i, { and, eq }) =>
        and(
          eq(i.organizationId, orgId),
          eq(i.vendorId, vendorId),
          eq(i.invoiceNumber, data.invoiceNumber),
        ),
    });
    if (duplicate) {
      throw new ForbiddenException(`Invoice number ${data.invoiceNumber} already exists for this vendor`);
    }

    const internalNumber = await this.sequenceService.next(orgId, 'invoice');
    const subtotal = data.lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);

    const invoiceId = await this.db.transaction(async (tx) => {
      const [inv] = await tx.insert(invoices).values({
        organizationId: orgId,
        purchaseOrderId: data.purchaseOrderId,
        vendorId,
        invoiceNumber: data.invoiceNumber,
        internalNumber,
        invoiceDate: new Date(data.invoiceDate),
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        currency: data.currency ?? 'USD',
        subtotal: String(subtotal.toFixed(2)),
        taxAmount: '0',
        totalAmount: String(subtotal.toFixed(2)),
        status: 'pending_match',
        matchStatus: 'unmatched',
      }).returning();

      if (data.lines.length > 0) {
        await tx.insert(invoiceLines).values(
          data.lines.map((l) => ({
            invoiceId: inv.id,
            poLineId: l.poLineId ?? null,
            lineNumber: String(l.lineNumber),
            description: l.description,
            quantity: String(l.quantity),
            unitPrice: String(l.unitPrice),
            totalPrice: String((l.quantity * l.unitPrice).toFixed(2)),
          })),
        );
      }

      return inv.id;
    });

    // Auto-run 3-way match
    const matchResult = await this.matchingService.runMatch(invoiceId);
    const newStatus =
      matchResult.matchStatus === 'full_match' ? 'matched'
        : matchResult.matchStatus === 'exception' ? 'exception'
        : 'partial_match';
    await this.db
      .update(invoices)
      .set({ status: newStatus, updatedAt: new Date() })
      .where(eq(invoices.id, invoiceId));

    return this.db.query.invoices.findFirst({
      where: (i, { eq }) => eq(i.id, invoiceId),
      with: { lines: true },
    });
  }

  async listVendorInvoices(vendorId: string, orgId: string) {
    return this.db.query.invoices.findMany({
      where: (i, { and, eq }) => and(eq(i.vendorId, vendorId), eq(i.organizationId, orgId)),
      with: { purchaseOrder: true },
      orderBy: (i, { desc }) => desc(i.createdAt),
    });
  }

  async listVendorCatalog(vendorId: string, orgId: string) {
    const [items, proposals] = await Promise.all([
      this.db.query.catalogItems.findMany({
        where: (c, { and, eq }) => and(eq(c.vendorId, vendorId), eq(c.organizationId, orgId)),
        orderBy: (c, { asc }) => asc(c.name),
      }),
      this.db.query.catalogPriceProposals.findMany({
        where: (p, { and, eq }) => and(eq(p.vendorId, vendorId), eq(p.organizationId, orgId)),
        with: { item: true },
        orderBy: (p, { desc }) => desc(p.submittedAt),
      }),
    ]);

    return { items, proposals };
  }

  async getVendorOnboarding(vendorId: string, orgId: string) {
    return this.vendorsService.getPortalOnboarding(vendorId, orgId);
  }

  async submitVendorOnboarding(
    vendorId: string,
    orgId: string,
    data: {
      questionnaireId?: string;
      companyInfo?: Record<string, unknown>;
      responses?: Record<string, unknown>;
      documentLinks?: Record<string, unknown>;
      bankingDetails?: Record<string, unknown>;
      submit?: boolean;
    },
  ) {
    return this.vendorsService.submitPortalOnboarding(vendorId, orgId, data);
  }

  async submitCatalogPriceProposal(
    vendorId: string,
    orgId: string,
    input: SubmitCatalogPriceProposalInput,
  ) {
    const item = await this.db.query.catalogItems.findFirst({
      where: (c, { and, eq }) =>
        and(eq(c.id, input.itemId), eq(c.vendorId, vendorId), eq(c.organizationId, orgId)),
    });
    if (!item) {
      throw new ForbiddenException('Catalog item not found or does not belong to your account');
    }

    const [proposal] = await this.db
      .insert(catalogPriceProposals)
      .values({
        organizationId: orgId,
        itemId: item.id,
        vendorId,
        proposedPrice: String(input.proposedPrice),
        currentPrice: item.unitPrice,
        effectiveDate: input.effectiveDate ? new Date(input.effectiveDate) : null,
        note: input.note ?? null,
      })
      .returning();

    return proposal;
  }

  async submitBulkCatalogPriceProposals(
    vendorId: string,
    orgId: string,
    rows: BulkCatalogPriceProposalRow[],
  ) {
    const results: Array<{
      row: number;
      itemId?: string;
      sku?: string;
      status: 'created' | 'error';
      message?: string;
    }> = [];

    for (const [index, row] of rows.entries()) {
      try {
        const item = await this.db.query.catalogItems.findFirst({
          where: (c, { and, eq }) =>
            and(
              eq(c.vendorId, vendorId),
              eq(c.organizationId, orgId),
              row.itemId ? eq(c.id, row.itemId) : eq(c.sku, row.sku ?? ''),
            ),
        });

        if (!item) {
          results.push({
            row: index + 1,
            itemId: row.itemId,
            sku: row.sku,
            status: 'error',
            message: 'Catalog item not found for this vendor',
          });
          continue;
        }

        await this.db
          .insert(catalogPriceProposals)
          .values({
            organizationId: orgId,
            itemId: item.id,
            vendorId,
            proposedPrice: String(row.proposedPrice),
            currentPrice: item.unitPrice,
            effectiveDate: row.effectiveDate ? new Date(row.effectiveDate) : null,
            note: row.note ?? null,
          });

        results.push({
          row: index + 1,
          itemId: item.id,
          sku: item.sku ?? row.sku,
          status: 'created',
        });
      } catch (error) {
        results.push({
          row: index + 1,
          itemId: row.itemId,
          sku: row.sku,
          status: 'error',
          message: error instanceof Error ? error.message : 'Bulk import failed',
        });
      }
    }

    return {
      createdCount: results.filter((row) => row.status === 'created').length,
      errorCount: results.filter((row) => row.status === 'error').length,
      results,
    };
  }
}
