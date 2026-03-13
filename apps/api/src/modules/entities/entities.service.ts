import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { Db } from '@betterspend/db';
import { legalEntities } from '@betterspend/db';
import { DB_TOKEN } from '../../database/database.module';

export interface CreateLegalEntityInput {
  name: string;
  code: string;
  currency?: string;
  glAccountPrefix?: string;
  address?: Record<string, unknown>;
  taxId?: string;
}

export interface UpdateLegalEntityInput {
  name?: string;
  code?: string;
  currency?: string;
  glAccountPrefix?: string;
  address?: Record<string, unknown>;
  taxId?: string;
  isActive?: boolean;
}

@Injectable()
export class EntitiesService {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  async findAll(organizationId: string, includeInactive = false) {
    return this.db.query.legalEntities.findMany({
      where: (entity, { and, eq }) =>
        includeInactive
          ? eq(entity.organizationId, organizationId)
          : and(eq(entity.organizationId, organizationId), eq(entity.isActive, true)),
      orderBy: (entity, { asc }) => [asc(entity.isActive), asc(entity.name)],
    });
  }

  async findOne(id: string, organizationId: string) {
    const entity = await this.db.query.legalEntities.findFirst({
      where: (record, { and, eq }) => and(eq(record.id, id), eq(record.organizationId, organizationId)),
    });

    if (!entity) throw new NotFoundException(`Legal entity ${id} not found`);
    return entity;
  }

  async assertBelongsToOrg(organizationId: string, entityId?: string | null) {
    if (!entityId) return null;
    const entity = await this.db.query.legalEntities.findFirst({
      where: (record, { and, eq }) =>
        and(eq(record.id, entityId), eq(record.organizationId, organizationId), eq(record.isActive, true)),
    });
    if (!entity) throw new BadRequestException(`Legal entity ${entityId} is not available in this organization`);
    return entity;
  }

  async create(organizationId: string, input: CreateLegalEntityInput) {
    const [entity] = await this.db.insert(legalEntities).values({
      organizationId,
      name: input.name,
      code: input.code,
      currency: input.currency ?? 'USD',
      glAccountPrefix: input.glAccountPrefix ?? null,
      address: input.address ?? {},
      taxId: input.taxId ?? null,
    }).returning();

    return entity;
  }

  async update(id: string, organizationId: string, input: UpdateLegalEntityInput) {
    await this.findOne(id, organizationId);
    const [entity] = await this.db.update(legalEntities)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.glAccountPrefix !== undefined ? { glAccountPrefix: input.glAccountPrefix } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.taxId !== undefined ? { taxId: input.taxId } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(legalEntities.id, id), eq(legalEntities.organizationId, organizationId)))
      .returning();

    return entity;
  }

  async remove(id: string, organizationId: string) {
    await this.findOne(id, organizationId);
    await this.db.update(legalEntities)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(legalEntities.id, id), eq(legalEntities.organizationId, organizationId)));
    return { success: true };
  }
}
