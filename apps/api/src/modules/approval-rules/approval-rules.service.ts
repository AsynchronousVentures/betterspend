import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { eq, and, asc, inArray } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db } from '@betterspend/db';
import { approvalRules, approvalRuleSteps, users } from '@betterspend/db';
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
  steps?: Array<{
    stepOrder: number;
    approverType: string;
    approverId?: string;
    approverRole?: string;
    requiredCount?: number;
  }>;
}

export interface ApprovalRuleSimulationInput {
  entityId?: string;
  requesterId?: string;
  departmentId?: string;
  projectId?: string;
  totalAmount?: number;
  currency?: string;
  fields?: Record<string, unknown>;
}

@Injectable()
export class ApprovalRulesService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly entitiesService: EntitiesService,
  ) {}

  async findAll(organizationId: string, entityId?: string) {
    return this.db.query.approvalRules.findMany({
      where: (r, { and, eq }) =>
        and(eq(r.organizationId, organizationId), entityId ? eq(r.entityId, entityId) : undefined),
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
      const [rule] = await tx
        .insert(approvalRules)
        .values({
          organizationId,
          entityId: input.entityId ?? null,
          name: input.name,
          description: input.description,
          priority: input.priority ?? 100,
          conditions: JSON.stringify(input.conditions),
          isActive: true,
        })
        .returning();

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

    await this.db.transaction(async (tx) => {
      await tx
        .update(approvalRules)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.conditions !== undefined
            ? { conditions: JSON.stringify(input.conditions) }
            : {}),
          ...(input.entityId !== undefined ? { entityId: input.entityId } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(approvalRules.id, id), eq(approvalRules.organizationId, organizationId)));

      if (input.steps !== undefined) {
        await tx.delete(approvalRuleSteps).where(eq(approvalRuleSteps.approvalRuleId, id));

        if (input.steps.length > 0) {
          await tx.insert(approvalRuleSteps).values(
            input.steps.map((s) => ({
              approvalRuleId: id,
              stepOrder: s.stepOrder,
              approverType: s.approverType,
              approverId: s.approverId ?? null,
              approverRole: s.approverRole ?? null,
              requiredCount: s.requiredCount ?? 1,
            })),
          );
        }
      }
    });

    return this.findOne(id, organizationId);
  }

  async remove(id: string, organizationId: string) {
    await this.findOne(id, organizationId);

    await this.db
      .update(approvalRules)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(approvalRules.id, id), eq(approvalRules.organizationId, organizationId)));

    return { success: true };
  }

  private evaluateCondition(condition: any, entity: Record<string, any>): boolean {
    if (!condition || Object.keys(condition).length === 0) return true;

    if (condition.operator === 'AND') {
      return Array.isArray(condition.conditions)
        ? condition.conditions.every((child: any) => this.evaluateCondition(child, entity))
        : true;
    }
    if (condition.operator === 'OR') {
      return Array.isArray(condition.conditions)
        ? condition.conditions.some((child: any) => this.evaluateCondition(child, entity))
        : true;
    }

    const rawFieldValue = entity[condition.field];
    const fieldValue =
      rawFieldValue !== undefined && rawFieldValue !== null && rawFieldValue !== ''
        ? (Number.isNaN(Number(rawFieldValue)) ? rawFieldValue : Number(rawFieldValue))
        : rawFieldValue;
    const condValue = condition.value;

    switch (condition.operator) {
      case '>=':
        return Number(fieldValue) >= Number(condValue);
      case '>':
        return Number(fieldValue) > Number(condValue);
      case '<=':
        return Number(fieldValue) <= Number(condValue);
      case '<':
        return Number(fieldValue) < Number(condValue);
      case '==':
      case 'eq':
        return String(fieldValue) === String(condValue);
      case '!=':
      case 'neq':
        return String(fieldValue) !== String(condValue);
      default:
        return false;
    }
  }

  private describeCondition(condition: any): string {
    if (!condition || Object.keys(condition).length === 0) return 'Always matches';
    if (condition.operator === 'AND' || condition.operator === 'OR') {
      const count = Array.isArray(condition.conditions) ? condition.conditions.length : 0;
      return `${condition.operator} ${count} condition${count === 1 ? '' : 's'}`;
    }
    if (typeof condition.field === 'string' && typeof condition.operator === 'string') {
      return `${condition.field} ${condition.operator} ${String(condition.value ?? '')}`;
    }
    return 'Always matches';
  }

  private formatApprover(
    step: { approverType: string; approverId?: string | null; approverRole?: string | null },
    userMap: Map<string, { id: string; name: string; email: string }>,
  ) {
    if (step.approverType === 'user') {
      const matchedUser = step.approverId ? userMap.get(step.approverId) : null;
      return {
        id: step.approverId ?? null,
        label: matchedUser
          ? `${matchedUser.name} (${matchedUser.email})`
          : step.approverId
            ? `User ${step.approverId}`
            : 'Unassigned user',
      };
    }
    if (step.approverType === 'role') {
      return { id: null, label: `Role: ${step.approverRole ?? 'approver'}` };
    }
    return { id: null, label: step.approverType.replace(/_/g, ' ') };
  }

  async simulate(organizationId: string, input: ApprovalRuleSimulationInput) {
    const simulationEntity = {
      requesterId: input.requesterId ?? null,
      departmentId: input.departmentId ?? null,
      projectId: input.projectId ?? null,
      totalAmount: input.totalAmount ?? 0,
      total_amount: input.totalAmount ?? 0,
      currency: input.currency ?? 'USD',
      ...(input.fields ?? {}),
    };

    const rules = await this.db.query.approvalRules.findMany({
      where: (rule, { and, eq }) =>
        and(
          eq(rule.organizationId, organizationId),
          eq(rule.isActive, true),
          input.entityId ? eq(rule.entityId, input.entityId) : undefined,
        ),
      with: { steps: true, entity: true },
      orderBy: (rule, { asc }) => asc(rule.priority),
    });

    const matchedRules = rules
      .map((rule) => {
        let conditions: any = {};
        try {
          conditions = typeof rule.conditions === 'string' ? JSON.parse(rule.conditions) : rule.conditions;
        } catch {
          conditions = {};
        }
        return { rule, conditions, matched: this.evaluateCondition(conditions, simulationEntity) };
      })
      .filter((result) => result.matched);

    const userIds = [...new Set(
      matchedRules.flatMap(({ rule }) =>
        rule.steps
          .map((step) => step.approverId)
          .filter((value): value is string => Boolean(value)),
      ),
    )];

    const approverUsers = userIds.length
      ? await this.db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(and(
            eq(users.organizationId, organizationId),
            inArray(users.id, userIds),
          ))
      : [];
    const approverUserMap = new Map(approverUsers.map((user) => [user.id, user]));

    const steps = matchedRules.flatMap(({ rule, conditions }) =>
      [...rule.steps]
        .sort((a, b) => a.stepOrder - b.stepOrder)
        .map((step) => ({
          ruleId: rule.id,
          ruleName: rule.name,
          rulePriority: rule.priority,
          entity: rule.entity ? { id: rule.entity.id, name: rule.entity.name } : null,
          stepOrder: step.stepOrder,
          approverType: step.approverType,
          requiredCount: step.requiredCount,
          approvers: [this.formatApprover(step, approverUserMap)],
          conditionExplanation: this.describeCondition(conditions),
        })),
    );

    return {
      entity: simulationEntity,
      matchedRuleCount: matchedRules.length,
      steps,
      unmatchedWarning:
        matchedRules.length === 0
          ? 'No active approval rules matched this scenario. The request would auto-approve under the current engine.'
          : null,
    };
  }
}
