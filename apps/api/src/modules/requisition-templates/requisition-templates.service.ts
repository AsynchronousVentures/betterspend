import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, and, or } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import { AuditService } from '../audit/audit.service';
import type { Db } from '@betterspend/db';
import { requisitionTemplates, requisitions, requisitionLines } from '@betterspend/db';
import type { CreateRequisitionTemplateInput, CreateTemplateFromRequisitionInput } from '@betterspend/shared';

@Injectable()
export class RequisitionTemplatesService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async findAll(organizationId: string, userId: string) {
    return this.db.query.requisitionTemplates.findMany({
      where: (t, { and, eq, or }) =>
        and(
          eq(t.organizationId, organizationId),
          or(eq(t.isOrgWide, true), eq(t.createdById, userId)),
        ),
      with: { createdBy: { columns: { id: true, name: true, email: true } } },
      orderBy: (t, { desc }) => desc(t.createdAt),
    });
  }

  async findOne(id: string, organizationId: string, userId: string) {
    const template = await this.db.query.requisitionTemplates.findFirst({
      where: (t, { and, eq, or }) =>
        and(
          eq(t.id, id),
          eq(t.organizationId, organizationId),
          or(eq(t.isOrgWide, true), eq(t.createdById, userId)),
        ),
      with: { createdBy: { columns: { id: true, name: true, email: true } } },
    });
    if (!template) throw new NotFoundException(`Template ${id} not found`);
    return template;
  }

  async create(organizationId: string, userId: string, input: CreateRequisitionTemplateInput) {
    const [template] = await this.db.insert(requisitionTemplates).values({
      organizationId,
      createdById: userId,
      name: input.name,
      description: input.description,
      isOrgWide: input.isOrgWide ?? false,
      templateData: input.templateData,
    }).returning();

    this.audit.log(organizationId, userId, 'requisition_template', template.id, 'created', { name: input.name }).catch(() => {});
    return this.findOne(template.id, organizationId, userId);
  }

  async createFromRequisition(
    requisitionId: string,
    organizationId: string,
    userId: string,
    input: CreateTemplateFromRequisitionInput,
  ) {
    const req = await this.db.query.requisitions.findFirst({
      where: (r, { and, eq }) => and(eq(r.id, requisitionId), eq(r.organizationId, organizationId)),
      with: { lines: true },
    });
    if (!req) throw new NotFoundException(`Requisition ${requisitionId} not found`);

    const templateData = {
      title: req.title,
      description: req.description ?? undefined,
      departmentId: req.departmentId ?? undefined,
      projectId: req.projectId ?? undefined,
      priority: (req.priority as 'low' | 'normal' | 'high' | 'urgent') ?? 'normal',
      currency: req.currency,
      lines: req.lines.map((l) => ({
        description: l.description,
        quantity: parseFloat(String(l.quantity)),
        unitOfMeasure: l.unitOfMeasure,
        unitPrice: parseFloat(String(l.unitPrice)),
        vendorId: l.vendorId ?? undefined,
        catalogItemId: l.catalogItemId ?? undefined,
        glAccount: l.glAccount ?? undefined,
      })),
    };

    const [template] = await this.db.insert(requisitionTemplates).values({
      organizationId,
      createdById: userId,
      name: input.name,
      description: input.description,
      isOrgWide: input.isOrgWide ?? false,
      templateData,
    }).returning();

    this.audit.log(organizationId, userId, 'requisition_template', template.id, 'created', { name: input.name, sourceRequisitionId: requisitionId }).catch(() => {});
    return this.findOne(template.id, organizationId, userId);
  }

  async update(id: string, organizationId: string, userId: string, input: Partial<CreateRequisitionTemplateInput>) {
    const existing = await this.db.query.requisitionTemplates.findFirst({
      where: (t, { and, eq }) => and(eq(t.id, id), eq(t.organizationId, organizationId), eq(t.createdById, userId)),
    });
    if (!existing) throw new NotFoundException(`Template ${id} not found or you do not have permission to edit it`);

    await this.db.update(requisitionTemplates)
      .set({
        name: input.name ?? existing.name,
        description: input.description !== undefined ? input.description : existing.description,
        isOrgWide: input.isOrgWide !== undefined ? input.isOrgWide : existing.isOrgWide,
        templateData: input.templateData ?? existing.templateData,
        updatedAt: new Date(),
      })
      .where(eq(requisitionTemplates.id, id));

    return this.findOne(id, organizationId, userId);
  }

  async remove(id: string, organizationId: string, userId: string) {
    const existing = await this.db.query.requisitionTemplates.findFirst({
      where: (t, { and, eq }) => and(eq(t.id, id), eq(t.organizationId, organizationId), eq(t.createdById, userId)),
    });
    if (!existing) throw new NotFoundException(`Template ${id} not found or you do not have permission to delete it`);

    await this.db.delete(requisitionTemplates).where(eq(requisitionTemplates.id, id));
    this.audit.log(organizationId, userId, 'requisition_template', id, 'deleted', { name: existing.name }).catch(() => {});
  }

  async applyTemplate(id: string, organizationId: string, userId: string) {
    const template = await this.findOne(id, organizationId, userId);
    return template.templateData;
  }
}
