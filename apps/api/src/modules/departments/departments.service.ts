import { Injectable, Inject, NotFoundException, ConflictException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db } from '@betterspend/db';
import { departments } from '@betterspend/db';
import type { ResourceScope } from '@betterspend/shared';
import { scopePredicate } from '../auth/scope-sql';

export interface CreateDepartmentInput {
  name: string;
  code: string;
  parentId?: string;
  budgetOwnerId?: string;
}

export interface UpdateDepartmentInput {
  name?: string;
  code?: string;
  parentId?: string;
  budgetOwnerId?: string;
}

@Injectable()
export class DepartmentsService {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  async findAll(organizationId: string, scope?: ResourceScope) {
    const scopeCondition = scopePredicate(scope, { department: departments.id });
    return this.db.query.departments.findMany({
      where: (d, { and, eq }) => and(eq(d.organizationId, organizationId), scopeCondition),
      orderBy: (d, { asc }) => asc(d.name),
    });
  }

  async findOne(id: string, organizationId: string, scope?: ResourceScope) {
    const scopeCondition = scopePredicate(scope, { department: departments.id });
    const dept = await this.db.query.departments.findFirst({
      where: (d, { and, eq }) =>
        and(eq(d.id, id), eq(d.organizationId, organizationId), scopeCondition),
    });
    if (!dept) throw new NotFoundException(`Department ${id} not found`);
    return dept;
  }

  async create(organizationId: string, input: CreateDepartmentInput) {
    const existing = await this.db.query.departments.findFirst({
      where: (d, { and, eq }) => and(eq(d.organizationId, organizationId), eq(d.code, input.code)),
    });
    if (existing) throw new ConflictException(`Department code "${input.code}" already exists`);

    const [dept] = await this.db
      .insert(departments)
      .values({
        organizationId,
        name: input.name,
        code: input.code,
        parentId: input.parentId ?? null,
        budgetOwnerId: input.budgetOwnerId ?? null,
      })
      .returning();
    return dept;
  }

  async update(id: string, organizationId: string, input: UpdateDepartmentInput) {
    await this.findOne(id, organizationId);
    const [updated] = await this.db
      .update(departments)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(departments.id, id), eq(departments.organizationId, organizationId)))
      .returning();
    return updated;
  }

  async remove(id: string, organizationId: string) {
    await this.findOne(id, organizationId);
    await this.db
      .delete(departments)
      .where(and(eq(departments.id, id), eq(departments.organizationId, organizationId)));
  }
}
