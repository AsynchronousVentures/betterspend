import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
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
    const createdId = await this.db.transaction(async (tx) => {
      const number = await this.sequenceService.next(organizationId, 'requisition', tx);
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

    const actorId = requesterId ?? req.requesterId;
    const { budgetEnforcement, approvalResult, requiredApproval } =
      await this.budgets.withEnforcementLock(
        {
          organizationId,
          departmentId: req.departmentId,
          requestedAmount: req.totalAmount,
          currency: req.currency,
          fiscalYear: req.createdAt.getUTCFullYear(),
          excludeRequisitionId: req.id,
        },
        async (tx, decision) => {
          if (decision.action === 'block') {
            throw new BadRequestException(decision.message);
          }
          let requiredApproval: { approverId: string; reason: string; key: string } | undefined;
          if (decision.action === 'require_approval') {
            const ownerUserId = decision.ownerUserId;
            if (!ownerUserId) {
              throw new BadRequestException('An active budget owner is required for approval');
            }
            requiredApproval = {
              approverId: ownerUserId,
              reason: decision.message,
              key: `budget:${decision.budgetId}:requisition:${id}:owner:${ownerUserId}`,
            };
          }
          const approvalResult = await this.approvalEngine.initiateApproval(
            organizationId,
            'requisition',
            id,
            actorId,
            requiredApproval,
            async (approvalTx) => {
              const [transitioned] = await approvalTx
                .update(requisitions)
                .set({ status: 'pending_approval', submittedAt: new Date(), updatedAt: new Date() })
                .where(
                  and(
                    eq(requisitions.id, id),
                    eq(requisitions.organizationId, organizationId),
                    eq(requisitions.status, 'draft'),
                  ),
                )
                .returning({ id: requisitions.id });
              if (!transitioned) {
                throw new BadRequestException('Only draft requisitions can be submitted');
              }
            },
            tx,
          );
          return { budgetEnforcement: decision, approvalResult, requiredApproval };
        },
      );
    this.approvalEngine.publishInitiation(
      organizationId,
      'requisition',
      id,
      approvalResult,
      requiredApproval,
    );

    const submitted = await this.findOne(id, organizationId);
    this.webhookEvents.emit(organizationId, 'requisition.submitted', { requisition: submitted });
    this.audit
      .log(organizationId, actorId, 'requisition', id, 'submitted', {
        status: submitted.status,
        budgetEnforcement,
      })
      .catch(() => {});
    return { ...submitted, budgetEnforcement };
  }

  async cancel(id: string, organizationId: string) {
    const req = await this.findOne(id, organizationId);
    if (['cancelled', 'converted'].includes(req.status)) {
      throw new BadRequestException(`Cannot cancel a ${req.status} requisition`);
    }

    const updated = await this.db.transaction(async (tx) => {
      const [transitioned] = await tx
        .update(requisitions)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(and(eq(requisitions.id, id), eq(requisitions.organizationId, organizationId)))
        .returning();
      await this.budgets.releaseRequisition(tx, organizationId, id, 'cancelled');
      return transitioned;
    });
    this.audit.log(organizationId, null, 'requisition', id, 'cancelled').catch(() => {});
    return updated;
  }
}
