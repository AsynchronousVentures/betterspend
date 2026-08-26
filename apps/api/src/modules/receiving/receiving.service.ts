import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db } from '@betterspend/db';
import {
  goodsReceipts,
  goodsReceiptLines,
  purchaseOrders,
  poLines,
  requisitions,
} from '@betterspend/db';
import { SequenceService } from '../../common/services/sequence.service';
import { WebhookEventService } from '../webhooks/webhook-event.service';
import { AuditService } from '../audit/audit.service';
import { InventoryService } from '../inventory/inventory.service';
import type { AccessPolicy } from '../auth/access-policy';
import { permissionScopePredicate, requirePermission } from '../auth/access-scope';
import type { PermissionKey } from '@betterspend/shared';

function receiptScopePredicates(organizationId: string) {
  const poScope = (condition: ReturnType<typeof sql>) =>
    sql`${goodsReceipts.purchaseOrderId} IN (
      SELECT ${purchaseOrders.id}
      FROM ${purchaseOrders}
      LEFT JOIN requisitions ON ${requisitions.id} = ${purchaseOrders.requisitionId}
      WHERE ${purchaseOrders.organizationId} = ${organizationId}
        AND ${condition}
    )`;
  return {
    own: (userId: string) =>
      poScope(sql`(
      ${purchaseOrders.issuedBy} = ${userId}
      OR ${requisitions.requesterId} = ${userId}
    )`),
    department: (departmentId: string) =>
      poScope(sql`${requisitions.departmentId} = ${departmentId}`),
    project: (projectId: string) => poScope(sql`${requisitions.projectId} = ${projectId}`),
    entity: (entityId: string) => poScope(sql`${purchaseOrders.entityId} = ${entityId}`),
  };
}

function purchaseOrderReceiptScopePredicates(organizationId: string) {
  return {
    own: (userId: string) =>
      sql`(
        ${purchaseOrders.issuedBy} = ${userId}
        OR ${purchaseOrders.requisitionId} IN (
          SELECT ${requisitions.id}
          FROM ${requisitions}
          WHERE ${requisitions.requesterId} = ${userId}
            AND ${requisitions.organizationId} = ${organizationId}
        )
      )`,
    department: (departmentId: string) =>
      sql`${purchaseOrders.requisitionId} IN (
        SELECT ${requisitions.id}
        FROM ${requisitions}
        WHERE ${requisitions.departmentId} = ${departmentId}
          AND ${requisitions.organizationId} = ${organizationId}
      )`,
    project: (projectId: string) =>
      sql`${purchaseOrders.requisitionId} IN (
        SELECT ${requisitions.id}
        FROM ${requisitions}
        WHERE ${requisitions.projectId} = ${projectId}
          AND ${requisitions.organizationId} = ${organizationId}
      )`,
    entity: (entityId: string) => eq(purchaseOrders.entityId, entityId),
  };
}

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

export type ReceivingPurchaseOrderSummary = {
  id: string;
  number: string;
  vendor: { id: string; name: string } | null;
};

export type ReceivingListItem = typeof goodsReceipts.$inferSelect & {
  purchaseOrder: ReceivingPurchaseOrderSummary | null;
  lines: (typeof goodsReceiptLines.$inferSelect)[];
};

export type ReceivingDetail = typeof goodsReceipts.$inferSelect & {
  purchaseOrder: ReceivingPurchaseOrderSummary | null;
  lines: Array<
    typeof goodsReceiptLines.$inferSelect & {
      poLine: typeof poLines.$inferSelect | null;
    }
  >;
};

type PurchaseOrderRelation = {
  id: string;
  number: string;
  organizationId?: string;
  vendor?: { id: string; name: string; organizationId?: string } | null;
};

@Injectable()
export class ReceivingService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly sequenceService: SequenceService,
    private readonly webhookEvents: WebhookEventService,
    private readonly audit: AuditService,
    private readonly inventoryService: InventoryService,
  ) {}

  async findAll(organizationId: string, access?: AccessPolicy): Promise<ReceivingListItem[]> {
    const rows = await this.db.query.goodsReceipts.findMany({
      where: (g, { eq }) =>
        and(
          eq(g.organizationId, organizationId),
          permissionScopePredicate(
            access,
            'receiving',
            ['receiving:view', 'receiving:manage'],
            receiptScopePredicates(organizationId),
          ),
        ),
      with: {
        lines: true,
        purchaseOrder: {
          columns: { id: true, number: true, organizationId: true },
          with: { vendor: { columns: { id: true, name: true, organizationId: true } } },
        },
      },
      orderBy: (g, { desc }) => desc(g.createdAt),
    });

    return rows.map((row) => ({
      ...row,
      purchaseOrder: this.toPurchaseOrderSummary(row.purchaseOrder, organizationId),
    }));
  }

  async findOne(
    id: string,
    organizationId: string,
    access?: AccessPolicy,
    permissions: readonly PermissionKey[] = ['receiving:view', 'receiving:manage'],
  ): Promise<ReceivingDetail> {
    const grn = await this.db.query.goodsReceipts.findFirst({
      where: (g, { eq }) =>
        and(
          eq(g.id, id),
          eq(g.organizationId, organizationId),
          permissionScopePredicate(
            access,
            'receiving',
            permissions,
            receiptScopePredicates(organizationId),
          ),
        ),
      with: {
        lines: { with: { poLine: true } },
        purchaseOrder: {
          columns: { id: true, number: true, organizationId: true },
          with: { vendor: { columns: { id: true, name: true, organizationId: true } } },
        },
      },
    });
    if (!grn) throw new NotFoundException(`GRN ${id} not found`);
    return {
      ...grn,
      purchaseOrder: this.toPurchaseOrderSummary(grn.purchaseOrder, organizationId),
    };
  }

  private toPurchaseOrderSummary(
    purchaseOrder: PurchaseOrderRelation | null | undefined,
    organizationId: string,
  ): ReceivingPurchaseOrderSummary | null {
    if (!purchaseOrder || purchaseOrder.organizationId !== organizationId) return null;

    return {
      id: purchaseOrder.id,
      number: purchaseOrder.number,
      vendor:
        purchaseOrder.vendor?.organizationId === organizationId
          ? { id: purchaseOrder.vendor.id, name: purchaseOrder.vendor.name }
          : null,
    };
  }

  async create(organizationId: string, input: CreateGrnInput, access?: AccessPolicy) {
    requirePermission(access, 'receiving:create');
    // Validate PO exists and is issued
    const po = await this.db.query.purchaseOrders.findFirst({
      where: (p, { eq }) =>
        and(
          eq(p.id, input.purchaseOrderId),
          eq(p.organizationId, organizationId),
          permissionScopePredicate(
            access,
            'receiving',
            ['receiving:create', 'receiving:manage'],
            purchaseOrderReceiptScopePredicates(organizationId),
          ),
        ),
      with: { lines: true },
    });
    if (!po) throw new NotFoundException(`PO ${input.purchaseOrderId} not found`);
    if (!['approved', 'issued', 'partially_received'].includes(po.status)) {
      throw new BadRequestException(
        `PO must be in approved/issued/partially_received status to receive against`,
      );
    }

    const grnId = await this.db.transaction(async (tx) => {
      const number = await this.sequenceService.next(organizationId, 'goods_receipt', tx);
      const [grn] = await tx
        .insert(goodsReceipts)
        .values({
          organizationId,
          purchaseOrderId: input.purchaseOrderId,
          number,
          receivedBy: input.receivedBy,
          receivedDate: new Date(input.receivedDate),
          status: 'confirmed',
          notes: input.notes ?? null,
        })
        .returning();

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

    const grn = await this.findOne(grnId, organizationId, access, ['receiving:create']);
    this.webhookEvents.emit(organizationId, 'grn.created', { goodsReceipt: grn });
    this.audit
      .log(organizationId, input.receivedBy, 'goods_receipt', grnId, 'created', {
        purchaseOrderId: input.purchaseOrderId,
      })
      .catch(() => {});

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

  async confirm(id: string, organizationId: string, access?: AccessPolicy) {
    requirePermission(access, 'receiving:manage');
    const grn = await this.findOne(id, organizationId, access, ['receiving:manage']);
    if (grn.status === 'confirmed') return grn;
    if (grn.status === 'cancelled') throw new BadRequestException('Cannot confirm a cancelled GRN');
    await this.db
      .update(goodsReceipts)
      .set({ status: 'confirmed', updatedAt: new Date() })
      .where(eq(goodsReceipts.id, id));
    return this.findOne(id, organizationId, access, ['receiving:manage']);
  }

  async cancelGrn(id: string, organizationId: string, access?: AccessPolicy) {
    requirePermission(access, 'receiving:manage');
    const grn = await this.findOne(id, organizationId, access, ['receiving:manage']);
    if (grn.status === 'cancelled') return grn;
    await this.db
      .update(goodsReceipts)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(goodsReceipts.id, id));
    if (grn.purchaseOrder?.id) {
      await this.updatePoReceiptStatus(grn.purchaseOrder.id, organizationId);
    }
    return this.findOne(id, organizationId, access, ['receiving:manage']);
  }

  private async updatePoReceiptStatus(poId: string, organizationId: string) {
    // Fetch all GRN lines for this PO to compute received totals
    const po = await this.db.query.purchaseOrders.findFirst({
      where: (p, { eq }) => eq(p.id, poId),
      with: { lines: true, goodsReceipts: { with: { lines: true } } },
    });
    if (!po) return;

    const allGrnLines = (po.goodsReceipts as any[])
      .filter((g: any) => g.status !== 'cancelled')
      .flatMap((g: any) => g.lines ?? []);

    const allFullyReceived = (po.lines as any[]).every((poLine: any) => {
      const received = allGrnLines
        .filter((gl: any) => gl.poLineId === poLine.id)
        .reduce((sum: number, gl: any) => sum + parseFloat(gl.quantityReceived), 0);
      return received >= parseFloat(poLine.quantity);
    });

    const anyReceived = allGrnLines.length > 0;
    const newStatus = allFullyReceived
      ? 'received'
      : anyReceived
        ? 'partially_received'
        : ['received', 'partially_received'].includes(po.status)
          ? po.issuedAt
            ? 'issued'
            : 'approved'
          : po.status;

    await this.db
      .update(purchaseOrders)
      .set({ status: newStatus, updatedAt: new Date() })
      .where(eq(purchaseOrders.id, poId));
  }
}
