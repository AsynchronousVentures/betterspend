import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import { SequenceService } from '../../common/services/sequence.service';
import { ApprovalEngineService } from '../approvals/approval-engine.service';
import { WebhookEventService } from '../webhooks/webhook-event.service';
import { AuditService } from '../audit/audit.service';
import { BudgetsService } from '../budgets/budgets.service';
import { SpendGuardService } from '../spend-guard/spend-guard.service';
import type { Db } from '@betterspend/db';
import { requisitions, requisitionLines } from '@betterspend/db';
import type { CreateRequisitionInput } from '@betterspend/shared';

@Injectable()
export class RequisitionsService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly sequenceService: SequenceService,
    private readonly approvalEngine: ApprovalEngineService,
    private readonly webhookEvents: WebhookEventService,
    private readonly audit: AuditService,
    private readonly budgets: BudgetsService,
    private readonly spendGuard: SpendGuardService,
  ) {}

  async findAll(organizationId: string, filters?: { status?: string; departmentId?: string }) {
    return this.db.query.requisitions.findMany({
      where: (r, { and, eq }) => {
        const conditions = [eq(r.organizationId, organizationId)];
        if (filters?.status) conditions.push(eq(r.status, filters.status));
        if (filters?.departmentId) conditions.push(eq(r.departmentId, filters.departmentId));
        return and(...conditions);
      },
      with: { lines: true },
      orderBy: (r, { desc }) => desc(r.createdAt),
    });
  }

  async findOne(id: string, organizationId: string) {
    const req = await this.db.query.requisitions.findFirst({
      where: (r, { and, eq }) => and(eq(r.id, id), eq(r.organizationId, organizationId)),
      with: { lines: true },
    });
    if (!req) throw new NotFoundException(`Requisition ${id} not found`);
    return req;
  }

  async create(organizationId: string, requesterId: string, input: CreateRequisitionInput) {
    const number = await this.sequenceService.next(organizationId, 'requisition');

    const createdId = await this.db.transaction(async (tx) => {
      const totalAmount = input.lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);

      const [req] = await tx
        .insert(requisitions)
        .values({
          organizationId,
          requesterId,
          number,
          title: input.title,
          description: input.description,
          departmentId: input.departmentId,
          projectId: input.projectId,
          priority: input.priority ?? 'normal',
          neededBy: input.neededBy ? new Date(input.neededBy) : null,
          currency: input.currency ?? 'USD',
          totalAmount: String(totalAmount),
          status: 'draft',
          sourceType: 'manual',
        })
        .returning();

      await tx.insert(requisitionLines).values(
        input.lines.map((l, i) => ({
          requisitionId: req.id,
          lineNumber: i + 1,
          description: l.description,
          quantity: String(l.quantity),
          unitOfMeasure: l.unitOfMeasure,
          unitPrice: String(l.unitPrice),
          totalPrice: String(l.quantity * l.unitPrice),
          vendorId: l.vendorId,
          catalogItemId: l.catalogItemId,
          glAccount: l.glAccount,
        })),
      );

      return req.id;
    });

    const created = await this.findOne(createdId, organizationId);
    this.audit
      .log(organizationId, requesterId, 'requisition', createdId, 'created', {
        number: (created as any).number,
        title: input.title,
      })
      .catch(() => {});
    await this.spendGuard.analyzeRequisition(organizationId, createdId).catch(() => {});
    return created;
  }

  async update(id: string, organizationId: string, input: Partial<CreateRequisitionInput>) {
    const req = await this.findOne(id, organizationId);
    if (req.status !== 'draft') {
      throw new BadRequestException('Only draft requisitions can be edited');
    }

    return this.db.transaction(async (tx) => {
      let totalAmount = parseFloat(String(req.totalAmount));

      if (input.lines) {
        await tx.delete(requisitionLines).where(eq(requisitionLines.requisitionId, id));
        totalAmount = input.lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
        await tx.insert(requisitionLines).values(
          input.lines.map((l, i) => ({
            requisitionId: id,
            lineNumber: i + 1,
            description: l.description,
            quantity: String(l.quantity),
            unitOfMeasure: l.unitOfMeasure,
            unitPrice: String(l.unitPrice),
            totalPrice: String(l.quantity * l.unitPrice),
            vendorId: l.vendorId,
            catalogItemId: l.catalogItemId,
            glAccount: l.glAccount,
          })),
        );
      }

      await tx
        .update(requisitions)
        .set({
          title: input.title ?? req.title,
          description: input.description ?? req.description,
          departmentId: input.departmentId ?? req.departmentId,
          projectId: input.projectId ?? req.projectId,
          priority: input.priority ?? req.priority,
          currency: input.currency ?? req.currency,
          totalAmount: String(totalAmount),
          updatedAt: new Date(),
        })
        .where(eq(requisitions.id, id));

      return this.findOne(id, organizationId);
    });
  }

  async submit(id: string, organizationId: string, requesterId?: string) {
    const req = await this.findOne(id, organizationId);
    if (req.status !== 'draft') {
      throw new BadRequestException('Only draft requisitions can be submitted');
    }
    if (!req.lines || req.lines.length === 0) {
      throw new BadRequestException('Requisition must have at least one line item');
    }

    // Budget gate: check if departmentId + totalAmount exceeds remaining budget
    if (req.departmentId && req.totalAmount) {
      const fiscalYear = new Date().getFullYear();
      const amount = parseFloat(String(req.totalAmount));
      const budgetCheck = await this.budgets.checkBudget(
        organizationId,
        req.departmentId,
        amount,
        fiscalYear,
      );
      if (!budgetCheck.withinBudget) {
        throw new BadRequestException(
          `Budget exceeded for department. Remaining: $${budgetCheck.remaining?.toFixed(2) ?? '0'}, ` +
            `Requested: $${amount.toFixed(2)}. ` +
            `Budget: ${budgetCheck.budgetName} (Allocated: $${budgetCheck.allocated?.toFixed(2) ?? '0'}, Spent: $${budgetCheck.spent?.toFixed(2) ?? '0'})`,
        );
      }
    }

    await this.db
      .update(requisitions)
      .set({ status: 'pending_approval', submittedAt: new Date(), updatedAt: new Date() })
      .where(eq(requisitions.id, id));

    const actorId = requesterId ?? req.requesterId;

    // Initiate approval — may auto-approve (status → 'approved') or create a pending request
    await this.approvalEngine.initiateApproval(organizationId, 'requisition', id, actorId);

    const submitted = await this.findOne(id, organizationId);
    this.webhookEvents.emit(organizationId, 'requisition.submitted', { requisition: submitted });
    this.audit
      .log(organizationId, actorId, 'requisition', id, 'submitted', { status: submitted.status })
      .catch(() => {});
    return submitted;
  }

  async cancel(id: string, organizationId: string) {
    const req = await this.findOne(id, organizationId);
    if (['cancelled', 'converted'].includes(req.status)) {
      throw new BadRequestException(`Cannot cancel a ${req.status} requisition`);
    }

    const [updated] = await this.db
      .update(requisitions)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(requisitions.id, id))
      .returning();
    this.audit.log(organizationId, null, 'requisition', id, 'cancelled').catch(() => {});
    return updated;
  }
}
