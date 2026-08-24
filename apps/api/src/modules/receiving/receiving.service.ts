import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db } from '@betterspend/db';
import { goodsReceipts, goodsReceiptLines, purchaseOrders, poLines } from '@betterspend/db';
import { SequenceService } from '../../common/services/sequence.service';
import { WebhookEventService } from '../webhooks/webhook-event.service';
import { AuditService } from '../audit/audit.service';
import { InventoryService } from '../inventory/inventory.service';

export interface CreateGrnInput {
  purchaseOrderId: string;
  receivedBy: string;
  receivedDate: string;
  notes?: string;
  lines: Array<{
    poLineId: string;
    quantityReceived: number;
    quantityRejected?: number;
    rejectionReason?: string;
    storageLocation?: string;
  }>;
}

@Injectable()
export class ReceivingService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly sequenceService: SequenceService,
    private readonly webhookEvents: WebhookEventService,
    private readonly audit: AuditService,
    private readonly inventoryService: InventoryService,
  ) {}

  async findAll(organizationId: string) {
    return this.db.query.goodsReceipts.findMany({
      where: (g, { eq }) => eq(g.organizationId, organizationId),
      with: { lines: true },
      orderBy: (g, { desc }) => desc(g.createdAt),
    });
  }

  async findOne(id: string, organizationId: string) {
    const grn = await this.db.query.goodsReceipts.findFirst({
      where: (g, { and, eq }) => and(eq(g.id, id), eq(g.organizationId, organizationId)),
      with: {
        lines: { with: { poLine: true } },
        purchaseOrder: { with: { vendor: true, lines: true } },
      },
    });
    if (!grn) throw new NotFoundException(`GRN ${id} not found`);
    return grn;
  }

  async create(organizationId: string, input: CreateGrnInput) {
    // Validate PO exists and is issued
    const po = await this.db.query.purchaseOrders.findFirst({
      where: (p, { and, eq }) => and(eq(p.id, input.purchaseOrderId), eq(p.organizationId, organizationId)),
      with: { lines: true },
    });
    if (!po) throw new NotFoundException(`PO ${input.purchaseOrderId} not found`);
    if (!['approved', 'issued', 'partially_received'].includes(po.status)) {
      throw new BadRequestException(`PO must be in approved/issued/partially_received status to receive against`);
    }

    const grnId = await this.db.transaction(async (tx) => {
      const number = await this.sequenceService.next(organizationId, 'goods_receipt', tx);
      const [grn] = await tx.insert(goodsReceipts).values({
        organizationId,
        purchaseOrderId: input.purchaseOrderId,
        number,
        receivedBy: input.receivedBy,
        receivedDate: new Date(input.receivedDate),
        status: 'confirmed',
        notes: input.notes ?? null,
      }).returning();

      if (input.lines && input.lines.length > 0) {
        await tx.insert(goodsReceiptLines).values(
          input.lines.map((l) => ({
            goodsReceiptId: grn.id,
            poLineId: l.poLineId,
            quantityReceived: String(l.quantityReceived),
            quantityRejected: String(l.quantityRejected ?? 0),
            rejectionReason: l.rejectionReason ?? null,
            storageLocation: l.storageLocation ?? null,
          })),
        );
      }

      return grn.id;
    });

    // Update PO status based on receipt completeness
    await this.updatePoReceiptStatus(input.purchaseOrderId, organizationId);

    const grn = await this.findOne(grnId, organizationId);
    this.webhookEvents.emit(organizationId, 'grn.created', { goodsReceipt: grn });
    this.audit.log(organizationId, input.receivedBy, 'goods_receipt', grnId, 'created', { purchaseOrderId: input.purchaseOrderId }).catch(() => {});

    // Update inventory stock levels for confirmed receipt lines
    if (input.lines && input.lines.length > 0) {
      const inventoryLines = await Promise.all(
        input.lines.map(async (line) => {
          const poLine = await this.db.query.poLines.findFirst({
            where: (p, { eq }) => eq(p.id, line.poLineId),
          });
          return {
            description: poLine?.description,
            quantityReceived: line.quantityReceived,
            referenceId: grnId,
          };
        }),
      );
      this.inventoryService.recordReceipt(organizationId, inventoryLines).catch(() => {});
    }

    return grn;
  }

  async confirm(id: string, organizationId: string) {
    const grn = await this.findOne(id, organizationId);
    if (grn.status === 'confirmed') return grn;
    if (grn.status === 'cancelled') throw new BadRequestException('Cannot confirm a cancelled GRN');
    await this.db.update(goodsReceipts).set({ status: 'confirmed', updatedAt: new Date() }).where(eq(goodsReceipts.id, id));
    return this.findOne(id, organizationId);
  }

  async cancelGrn(id: string, organizationId: string) {
    const grn = await this.findOne(id, organizationId);
    if (grn.status === 'cancelled') return grn;
    await this.db.update(goodsReceipts).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(goodsReceipts.id, id));
    return this.findOne(id, organizationId);
  }

  private async updatePoReceiptStatus(poId: string, organizationId: string) {
    // Fetch all GRN lines for this PO to compute received totals
    const po = await this.db.query.purchaseOrders.findFirst({
      where: (p, { eq }) => eq(p.id, poId),
      with: { lines: true, goodsReceipts: { with: { lines: true } } },
    });
    if (!po) return;

    const allGrnLines = (po.goodsReceipts as any[]).flatMap((g: any) => g.lines ?? []);

    const allFullyReceived = (po.lines as any[]).every((poLine: any) => {
      const received = allGrnLines
        .filter((gl: any) => gl.poLineId === poLine.id)
        .reduce((sum: number, gl: any) => sum + parseFloat(gl.quantityReceived), 0);
      return received >= parseFloat(poLine.quantity);
    });

    const anyReceived = allGrnLines.length > 0;
    const newStatus = allFullyReceived ? 'received' : anyReceived ? 'partially_received' : po.status;

    await this.db.update(purchaseOrders)
      .set({ status: newStatus, updatedAt: new Date() })
      .where(eq(purchaseOrders.id, poId));
  }
}
