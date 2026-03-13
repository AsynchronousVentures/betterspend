import { Injectable, Inject, Optional, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import { SequenceService } from '../../common/services/sequence.service';
import { WebhookEventService } from '../webhooks/webhook-event.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ContractComplianceService } from './contract-compliance.service';
import { EntitiesService } from '../entities/entities.service';
import type { Db } from '@betterspend/db';
import { purchaseOrders, poLines, poVersions, blanketReleases, requisitions, taxCodes } from '@betterspend/db';

const DEMO_ADMIN_USER_ID = '00000000-0000-0000-0000-000000000002';
import { z } from 'zod';

const createPoSchema = z.object({
  entityId: z.string().uuid().optional(),
  vendorId: z.string().uuid(),
  requisitionId: z.string().uuid().optional(),
  paymentTerms: z.string().optional(),
  currency: z.string().length(3).default('USD'),
  notes: z.string().optional(),
  poType: z.enum(['standard', 'blanket']).default('standard'),
  shippingAddress: z.record(z.unknown()).optional(),
  billingAddress: z.record(z.unknown()).optional(),
  // Blanket PO fields
  blanketStartDate: z.string().datetime().optional(),
  blanketEndDate: z.string().datetime().optional(),
  blanketTotalLimit: z.number().optional(),
  lines: z.array(z.object({
    description: z.string().min(1),
    quantity: z.number().positive(),
    unitOfMeasure: z.string().default('each'),
    unitPrice: z.number().nonnegative(),
    glAccount: z.string().optional(),
    taxCodeId: z.string().uuid().optional(),
    taxInclusive: z.boolean().optional(),
    catalogItemId: z.string().uuid().optional(),
    requisitionLineId: z.string().uuid().optional(),
  })).min(1),
});

const changeOrderSchema = z.object({
  changeReason: z.string().min(1),
  lines: z.array(z.object({
    id: z.string().uuid().optional(), // existing line ID to update
    description: z.string().min(1),
    quantity: z.number().positive(),
    unitOfMeasure: z.string().default('each'),
    unitPrice: z.number().nonnegative(),
    glAccount: z.string().optional(),
    taxCodeId: z.string().uuid().optional(),
    taxInclusive: z.boolean().optional(),
  })).optional(),
  notes: z.string().optional(),
  paymentTerms: z.string().optional(),
});

export type CreatePoInput = z.infer<typeof createPoSchema>;
export type ChangeOrderInput = z.infer<typeof changeOrderSchema>;
export { createPoSchema, changeOrderSchema };

interface LineTaxSnapshot {
  taxCodeId?: string;
  taxInclusive?: boolean;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
}

@Injectable()
export class PurchaseOrdersService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly sequenceService: SequenceService,
    private readonly webhookEvents: WebhookEventService,
    private readonly audit: AuditService,
    @Optional() private readonly notifications: NotificationsService,
    @Optional() private readonly contractCompliance: ContractComplianceService,
    private readonly entitiesService: EntitiesService,
  ) {}

  private calculateLineTax(quantity: number, unitPrice: number, ratePercent: number, taxInclusive: boolean): LineTaxSnapshot {
    const rawAmount = quantity * unitPrice;
    if (taxInclusive) {
      const subtotal = ratePercent > 0 ? rawAmount / (1 + ratePercent / 100) : rawAmount;
      return {
        subtotal,
        taxAmount: rawAmount - subtotal,
        totalAmount: rawAmount,
      };
    }

    const subtotal = rawAmount;
    const taxAmount = subtotal * (ratePercent / 100);
    return {
      subtotal,
      taxAmount,
      totalAmount: subtotal + taxAmount,
    };
  }

  private async getTaxCodeMap(organizationId: string, taxCodeIds: string[]) {
    if (taxCodeIds.length === 0) return new Map<string, any>();
    const records = await this.db.query.taxCodes.findMany({
      where: (record, { and, eq, inArray }) =>
        and(eq(record.orgId, organizationId), inArray(record.id, taxCodeIds)),
    });
    if (records.length !== taxCodeIds.length) {
      throw new BadRequestException('One or more tax codes are invalid for this organization');
    }
    return new Map(records.map((record) => [record.id, record]));
  }

  async findAll(organizationId: string, filters?: { status?: string; vendorId?: string; entityId?: string }) {
    return this.db.query.purchaseOrders.findMany({
      where: (po, { and, eq }) => {
        const conditions = [eq(po.organizationId, organizationId)];
        if (filters?.status) conditions.push(eq(po.status, filters.status));
        if (filters?.vendorId) conditions.push(eq(po.vendorId, filters.vendorId));
        if (filters?.entityId) conditions.push(eq(po.entityId, filters.entityId));
        return and(...conditions);
      },
      with: { vendor: true, lines: { with: { taxCode: true } }, entity: true },
      orderBy: (po, { desc }) => desc(po.createdAt),
    });
  }

  async findOne(id: string, organizationId: string) {
    const po = await this.db.query.purchaseOrders.findFirst({
      where: (po, { and, eq }) => and(eq(po.id, id), eq(po.organizationId, organizationId)),
      with: { vendor: true, lines: { with: { taxCode: true } }, versions: true, entity: true },
    });
    if (!po) throw new NotFoundException(`Purchase Order ${id} not found`);
    return po;
  }

  async create(organizationId: string, issuedBy: string, input: CreatePoInput) {
    await this.entitiesService.assertBelongsToOrg(organizationId, input.entityId);
    const number = await this.sequenceService.next(organizationId, 'purchase_order');
    const taxCodeMap = await this.getTaxCodeMap(
      organizationId,
      input.lines.map((line) => line.taxCodeId).filter((value): value is string => !!value),
    );

    // Run compliance checks for each line before the transaction
    const lineComplianceResults = this.contractCompliance
      ? await Promise.all(
          input.lines.map((l) =>
            this.contractCompliance!.checkCompliance(
              organizationId,
              input.vendorId,
              l.unitPrice,
              l.catalogItemId ?? null,
              l.description,
            ).catch(() => null),
          ),
        )
      : input.lines.map(() => null);

    const createdId = await this.db.transaction(async (tx) => {
      const lineAmounts = input.lines.map((line) => {
        const taxCode = line.taxCodeId ? taxCodeMap.get(line.taxCodeId) : null;
        const ratePercent = taxCode ? parseFloat(String(taxCode.ratePercent ?? '0')) : 0;
        return this.calculateLineTax(line.quantity, line.unitPrice, ratePercent, !!line.taxInclusive);
      });
      const subtotal = lineAmounts.reduce((sum, line) => sum + line.subtotal, 0);
      const taxAmount = lineAmounts.reduce((sum, line) => sum + line.taxAmount, 0);
      const totalAmount = lineAmounts.reduce((sum, line) => sum + line.totalAmount, 0);

      const [po] = await tx.insert(purchaseOrders).values({
        organizationId,
        entityId: input.entityId ?? null,
        vendorId: input.vendorId,
        requisitionId: input.requisitionId,
        number,
        version: 1,
        poType: input.poType ?? 'standard',
        status: 'draft',
        paymentTerms: input.paymentTerms,
        currency: input.currency ?? 'USD',
        notes: input.notes,
        shippingAddress: input.shippingAddress ?? {},
        billingAddress: input.billingAddress ?? {},
        subtotal: String(subtotal.toFixed(2)),
        taxAmount: String(taxAmount.toFixed(2)),
        totalAmount: String(totalAmount.toFixed(2)),
        blanketStartDate: input.blanketStartDate ? new Date(input.blanketStartDate) : null,
        blanketEndDate: input.blanketEndDate ? new Date(input.blanketEndDate) : null,
        blanketTotalLimit: input.blanketTotalLimit ? String(input.blanketTotalLimit) : null,
      }).returning();

      await tx.insert(poLines).values(
        input.lines.map((l, i) => {
          const cr = lineComplianceResults[i];
          const amounts = lineAmounts[i];
          return {
            purchaseOrderId: po.id,
            lineNumber: i + 1,
            description: l.description,
            taxCodeId: l.taxCodeId ?? null,
            taxAmount: String(amounts.taxAmount.toFixed(2)),
            taxInclusive: l.taxInclusive ?? false,
            quantity: String(l.quantity),
            unitOfMeasure: l.unitOfMeasure,
            unitPrice: String(l.unitPrice),
            totalPrice: String(amounts.totalAmount.toFixed(2)),
            glAccount: l.glAccount,
            catalogItemId: l.catalogItemId,
            requisitionLineId: l.requisitionLineId,
            contractComplianceStatus: cr?.status ?? null,
            contractComplianceDeltaPercent: cr?.deltaPercent != null ? String(cr.deltaPercent) : null,
            matchedContractId: cr?.contractId ?? null,
            contractedUnitPrice: cr?.contractedUnitPrice != null ? String(cr.contractedUnitPrice) : null,
          };
        }),
      );

      // If created from a requisition, mark it as converted
      if (input.requisitionId) {
        await tx.update(requisitions)
          .set({ status: 'converted', updatedAt: new Date() })
          .where(eq(requisitions.id, input.requisitionId));
      }

      return po.id;
    });

    const created = await this.findOne(createdId, organizationId);
    this.audit.log(organizationId, null, 'purchase_order', createdId, 'created', { internalNumber: (created as any).internalNumber, totalAmount: (created as any).totalAmount }).catch(() => {});
    return created;
  }

  async issue(id: string, organizationId: string, issuedBy: string) {
    const po = await this.findOne(id, organizationId);
    if (!['draft', 'approved'].includes(po.status)) {
      throw new BadRequestException(`Cannot issue a PO with status "${po.status}"`);
    }

    const [updated] = await this.db.update(purchaseOrders)
      .set({ status: 'issued', issuedBy, issuedAt: new Date(), updatedAt: new Date() })
      .where(eq(purchaseOrders.id, id))
      .returning();
    this.webhookEvents.emit(organizationId, 'po.issued', { purchaseOrder: updated });
    this.audit.log(organizationId, issuedBy ?? null, 'purchase_order', id, 'issued', { totalAmount: updated.totalAmount }).catch(() => {});
    if (this.notifications) {
      this.notifications.create(
        organizationId,
        DEMO_ADMIN_USER_ID,
        'po_issued',
        'Purchase Order Issued',
        `Purchase Order ${updated.number} has been issued to the vendor.`,
        'purchase_order',
        id,
      ).catch(() => {});
    }
    return updated;
  }

  async createChangeOrder(id: string, organizationId: string, changedBy: string, input: ChangeOrderInput) {
    const po = await this.findOne(id, organizationId);

    if (['closed', 'cancelled'].includes(po.status)) {
      throw new BadRequestException(`Cannot create change order for ${po.status} PO`);
    }

    return this.db.transaction(async (tx) => {
      // Snapshot current state before modifying
      await tx.insert(poVersions).values({
        purchaseOrderId: id,
        version: po.version,
        changeReason: input.changeReason,
        changedBy,
        snapshot: { po, lines: po.lines } as any,
        diffSummary: {
          previousVersion: po.version,
          notes: input.notes,
          linesChanged: !!input.lines,
        } as any,
      });

      const newVersion = po.version + 1;

      if (input.lines) {
        await tx.delete(poLines).where(eq(poLines.purchaseOrderId, id));
        const taxCodeMap = await this.getTaxCodeMap(
          organizationId,
          input.lines.map((line) => line.taxCodeId).filter((value): value is string => !!value),
        );
        const lineAmounts = input.lines.map((line) => {
          const taxCode = line.taxCodeId ? taxCodeMap.get(line.taxCodeId) : null;
          const ratePercent = taxCode ? parseFloat(String(taxCode.ratePercent ?? '0')) : 0;
          return this.calculateLineTax(line.quantity, line.unitPrice, ratePercent, !!line.taxInclusive);
        });
        const subtotal = lineAmounts.reduce((sum, line) => sum + line.subtotal, 0);
        const taxAmount = lineAmounts.reduce((sum, line) => sum + line.taxAmount, 0);
        const totalAmount = lineAmounts.reduce((sum, line) => sum + line.totalAmount, 0);

        // Compliance checks for change order lines
        const changeLineCompliance = this.contractCompliance
          ? await Promise.all(
              input.lines.map((l) =>
                this.contractCompliance!.checkCompliance(
                  organizationId,
                  po.vendorId,
                  l.unitPrice,
                  null,
                  l.description,
                ).catch(() => null),
              ),
            )
          : input.lines.map(() => null);

        await tx.insert(poLines).values(
          input.lines.map((l, i) => {
            const cr = changeLineCompliance[i];
            const amounts = lineAmounts[i];
            return {
              purchaseOrderId: id,
              lineNumber: i + 1,
              description: l.description,
              taxCodeId: l.taxCodeId ?? null,
              taxAmount: String(amounts.taxAmount.toFixed(2)),
              taxInclusive: l.taxInclusive ?? false,
              quantity: String(l.quantity),
              unitOfMeasure: l.unitOfMeasure,
              unitPrice: String(l.unitPrice),
              totalPrice: String(amounts.totalAmount.toFixed(2)),
              glAccount: l.glAccount,
              contractComplianceStatus: cr?.status ?? null,
              contractComplianceDeltaPercent: cr?.deltaPercent != null ? String(cr.deltaPercent) : null,
              matchedContractId: cr?.contractId ?? null,
              contractedUnitPrice: cr?.contractedUnitPrice != null ? String(cr.contractedUnitPrice) : null,
            };
          }),
        );

        const subtotalStr = String(subtotal);
        await tx.update(purchaseOrders).set({
          version: newVersion,
          notes: input.notes ?? po.notes,
          paymentTerms: input.paymentTerms ?? po.paymentTerms,
          subtotal: String(subtotal.toFixed(2)),
          taxAmount: String(taxAmount.toFixed(2)),
          totalAmount: String(totalAmount.toFixed(2)),
          status: 'draft', // Change orders reset to draft for re-approval
          updatedAt: new Date(),
        }).where(eq(purchaseOrders.id, id));
      } else {
        await tx.update(purchaseOrders).set({
          version: newVersion,
          notes: input.notes ?? po.notes,
          paymentTerms: input.paymentTerms ?? po.paymentTerms,
          status: 'draft',
          updatedAt: new Date(),
        }).where(eq(purchaseOrders.id, id));
      }

    });

    return this.findOne(id, organizationId);
  }

  async cancel(id: string, organizationId: string) {
    const po = await this.findOne(id, organizationId);
    if (['closed', 'cancelled', 'received', 'invoiced'].includes(po.status)) {
      throw new BadRequestException(`Cannot cancel a ${po.status} PO`);
    }
    const [updated] = await this.db.update(purchaseOrders)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(purchaseOrders.id, id))
      .returning();
    this.webhookEvents.emit(organizationId, 'po.cancelled', { purchaseOrderId: id });
    this.audit.log(organizationId, null, 'purchase_order', id, 'cancelled').catch(() => {});
    return updated;
  }

  async getVersionHistory(id: string, organizationId: string) {
    await this.findOne(id, organizationId); // verify exists + org access
    return this.db.query.poVersions.findMany({
      where: eq(poVersions.purchaseOrderId, id),
      orderBy: (v, { asc }) => asc(v.version),
    });
  }

  async listReleases(blanketPoId: string, organizationId: string) {
    await this.findOne(blanketPoId, organizationId); // verify access
    return this.db.query.blanketReleases.findMany({
      where: eq(blanketReleases.blanketPoId, blanketPoId),
      orderBy: (r, { asc }) => asc(r.releaseNumber),
    });
  }

  async createRelease(blanketPoId: string, organizationId: string, releasedBy: string, input: { amount: number; description?: string }) {
    const po = await this.findOne(blanketPoId, organizationId);
    if (po.poType !== 'blanket') throw new BadRequestException('Releases can only be created against blanket POs');
    if (!['issued', 'approved', 'partially_received'].includes(po.status)) {
      throw new BadRequestException('Blanket PO must be issued or approved to create releases');
    }

    const limit = po.blanketTotalLimit ? parseFloat(po.blanketTotalLimit) : null;
    const released = parseFloat(po.blanketReleasedAmount ?? '0');
    if (limit !== null && released + input.amount > limit) {
      throw new BadRequestException(`Release amount $${input.amount} would exceed blanket limit $${limit} (released so far: $${released})`);
    }

    // Get next release number
    const existing = await this.db.query.blanketReleases.findMany({
      where: eq(blanketReleases.blanketPoId, blanketPoId),
    });
    const releaseNumber = existing.length + 1;

    const [release] = await this.db.insert(blanketReleases).values({
      blanketPoId,
      releaseNumber,
      amount: String(input.amount),
      description: input.description ?? null,
      status: 'approved',
      releasedBy,
    }).returning();

    // Update accumulated released amount
    await this.db.update(purchaseOrders)
      .set({
        blanketReleasedAmount: String(released + input.amount),
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, blanketPoId));

    return release;
  }

  async cancelRelease(blanketPoId: string, releaseId: string, organizationId: string) {
    await this.findOne(blanketPoId, organizationId); // verify access
    const release = await this.db.query.blanketReleases.findFirst({
      where: (r, { and, eq }) => and(eq(r.id, releaseId), eq(r.blanketPoId, blanketPoId)),
    });
    if (!release) throw new NotFoundException(`Release ${releaseId} not found`);
    if (release.status === 'cancelled') return release;

    const [updated] = await this.db.update(blanketReleases)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(blanketReleases.id, releaseId))
      .returning();

    // Subtract from released amount
    const po = await this.db.query.purchaseOrders.findFirst({ where: eq(purchaseOrders.id, blanketPoId) });
    if (po) {
      const released = parseFloat(po.blanketReleasedAmount ?? '0');
      const amount = parseFloat(release.amount);
      await this.db.update(purchaseOrders)
        .set({ blanketReleasedAmount: String(Math.max(0, released - amount)), updatedAt: new Date() })
        .where(eq(purchaseOrders.id, blanketPoId));
    }

    return updated;
  }

  async getComplianceReport(id: string, organizationId: string) {
    const po = await this.findOne(id, organizationId);
    const lines = po.lines ?? [];
    const totalLines = lines.length;
    const compliantLines = lines.filter((l: any) => l.contractComplianceStatus === 'compliant').length;
    const deviationLines = lines.filter((l: any) => l.contractComplianceStatus === 'deviation').length;
    const noContractLines = lines.filter((l: any) => l.contractComplianceStatus === 'no_contract' || !l.contractComplianceStatus).length;

    return {
      purchaseOrderId: id,
      number: po.number,
      summary: {
        totalLines,
        compliantLines,
        deviationLines,
        noContractLines,
      },
      lines: lines.map((l: any) => ({
        id: l.id,
        lineNumber: l.lineNumber,
        description: l.description,
        unitPrice: l.unitPrice,
        contractComplianceStatus: l.contractComplianceStatus ?? 'no_contract',
        contractComplianceDeltaPercent: l.contractComplianceDeltaPercent,
        matchedContractId: l.matchedContractId,
        contractedUnitPrice: l.contractedUnitPrice,
      })),
    };
  }

  async checkLineCompliance(
    organizationId: string,
    vendorId: string,
    unitPrice: number,
    catalogItemId?: string,
    description?: string,
  ) {
    if (!this.contractCompliance) {
      return { status: 'no_contract', deltaPercent: null, contractId: null, contractedUnitPrice: null };
    }
    return this.contractCompliance.checkCompliance(
      organizationId,
      vendorId,
      unitPrice,
      catalogItemId,
      description,
    );
  }

  async getReceivingSummary(id: string, organizationId: string) {
    await this.findOne(id, organizationId); // validate access
    const rows = await this.db.execute(sql`
      SELECT
        pl.id                                                            AS "poLineId",
        pl.line_number                                                   AS "lineNumber",
        pl.description,
        pl.quantity::numeric                                             AS "orderedQty",
        pl.unit_of_measure                                              AS "uom",
        COALESCE(SUM(grl.quantity_received::numeric), 0)::numeric       AS "receivedQty",
        COALESCE(SUM(grl.quantity_rejected::numeric), 0)::numeric       AS "rejectedQty",
        (pl.quantity::numeric - COALESCE(SUM(grl.quantity_received::numeric), 0))::numeric AS "outstandingQty",
        CASE
          WHEN pl.quantity::numeric = 0 THEN 0
          ELSE ROUND(COALESCE(SUM(grl.quantity_received::numeric), 0) / pl.quantity::numeric * 100, 1)
        END                                                              AS "receivedPct",
        COUNT(DISTINCT gr.id)::int                                       AS "grnCount"
      FROM po_lines pl
      LEFT JOIN goods_receipt_lines grl ON grl.po_line_id = pl.id
      LEFT JOIN goods_receipts gr ON gr.id = grl.goods_receipt_id AND gr.status != 'cancelled'
      WHERE pl.purchase_order_id = ${id}
      GROUP BY pl.id, pl.line_number, pl.description, pl.quantity, pl.unit_of_measure
      ORDER BY pl.line_number ASC
    `);
    return rows;
  }
}
