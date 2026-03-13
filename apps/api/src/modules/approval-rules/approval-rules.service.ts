import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { eq, and, asc } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db } from '@betterspend/db';
import { approvalRules, approvalRuleSteps } from '@betterspend/db';
import { EntitiesService } from '../entities/entities.service';

export interface CreateApprovalRuleInput {
  name: string;
  description?: string;
  entityId?: string;
  entityType?: string;
  priority?: number;
  conditions: object;
  steps: Array<{
    stepOrder: number;
    approverType: string;
    approverId?: string;
    approverRole?: string;
    requiredCount?: number;
  }>;
}

export interface UpdateApprovalRuleInput {
  name?: string;
  description?: string;
  priority?: number;
  conditions?: object;
  entityId?: string | null;
}

@Injectable()
export class ApprovalRulesService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly entitiesService: EntitiesService,
  ) {}

  async findAll(organizationId: string, entityId?: string) {
    return this.db.query.approvalRules.findMany({
      where: (r, { and, eq }) => and(
        eq(r.organizationId, organizationId),
        entityId ? eq(r.entityId, entityId) : undefined,
      ),
      with: { steps: true, entity: true },
      orderBy: (r, { asc }) => asc(r.priority),
    });
  }

  async findOne(id: string, organizationId: string) {
    const rule = await this.db.query.approvalRules.findFirst({
      where: (r, { and, eq }) => and(eq(r.id, id), eq(r.organizationId, organizationId)),
      with: { steps: true, entity: true },
    });
    if (!rule) throw new NotFoundException(`Approval rule ${id} not found`);
    return rule;
  }

  async create(organizationId: string, input: CreateApprovalRuleInput) {
    await this.entitiesService.assertBelongsToOrg(organizationId, input.entityId);
    const ruleId = await this.db.transaction(async (tx) => {
      const [rule] = await tx.insert(approvalRules).values({
        organizationId,
        entityId: input.entityId ?? null,
        name: input.name,
        description: input.description,
        priority: input.priority ?? 100,
        conditions: JSON.stringify(input.conditions),
        isActive: true,
      }).returning();

      if (input.steps && input.steps.length > 0) {
        await tx.insert(approvalRuleSteps).values(
          input.steps.map((s) => ({
            approvalRuleId: rule.id,
            stepOrder: s.stepOrder,
            approverType: s.approverType,
            approverId: s.approverId ?? null,
            approverRole: s.approverRole ?? null,
            requiredCount: s.requiredCount ?? 1,
          })),
        );
      }

      return rule.id;
    });

    return this.findOne(ruleId, organizationId);
  }

  async update(id: string, organizationId: string, input: UpdateApprovalRuleInput) {
    await this.findOne(id, organizationId);
    await this.entitiesService.assertBelongsToOrg(organizationId, input.entityId);

    await this.db.update(approvalRules)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.conditions !== undefined ? { conditions: JSON.stringify(input.conditions) } : {}),
        ...(input.entityId !== undefined ? { entityId: input.entityId } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(approvalRules.id, id), eq(approvalRules.organizationId, organizationId)));

    return this.findOne(id, organizationId);
  }

  async remove(id: string, organizationId: string) {
    await this.findOne(id, organizationId);

    await this.db.update(approvalRules)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(approvalRules.id, id), eq(approvalRules.organizationId, organizationId)));

    return { success: true };
  }
}
