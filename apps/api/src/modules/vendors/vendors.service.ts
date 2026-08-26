import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db } from '@betterspend/db';
import { onboardingQuestionnaires, vendorOnboardingSubmissions, vendors } from '@betterspend/db';
import { EntitiesService } from '../entities/entities.service';
import type { AccessPolicy } from '../auth/access-policy';
import type { PermissionKey } from '@betterspend/shared';

@Injectable()
export class VendorsService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly entitiesService: EntitiesService,
  ) {}

  async findAll(organizationId: string, entityId?: string, access?: AccessPolicy) {
    const scope = access?.scopeFor('vendor', 'vendors:view');
    return this.db.query.vendors.findMany({
      where: (v, { and, eq, isNull, or }) =>
        and(
          eq(v.organizationId, organizationId),
          entityId ? or(eq(v.entityId, entityId), isNull(v.entityId)) : undefined,
          scope && !scope.unrestricted
            ? scope.entityIds.length > 0
              ? inArray(v.entityId, scope.entityIds)
              : sql`false`
            : undefined,
        ),
      orderBy: (v, { asc }) => asc(v.name),
      with: { entity: true },
    });
  }

  async findOne(
    id: string,
    organizationId: string,
    access?: AccessPolicy,
    permission: PermissionKey = 'vendors:view',
  ) {
    const scope = access?.scopeFor('vendor', permission);
    const vendor = await this.db.query.vendors.findFirst({
      where: (v, { and, eq }) =>
        and(
          eq(v.id, id),
          eq(v.organizationId, organizationId),
          scope && !scope.unrestricted
            ? scope.entityIds.length > 0
              ? inArray(v.entityId, scope.entityIds)
              : sql`false`
            : undefined,
        ),
      with: { entity: true },
    });

    if (!vendor) throw new NotFoundException(`Vendor ${id} not found`);
    return vendor;
  }

  private defaultQuestionnaireDefinition() {
    return {
      name: 'Default Supplier Onboarding',
      isDefault: true,
      questions: [
        {
          id: 'tax_registered',
          label: 'Are you tax registered in your operating jurisdiction?',
          type: 'yes_no',
          required: true,
        },
        {
          id: 'sanctions_program',
          label: 'Do you maintain sanctions and denied-party screening controls?',
          type: 'yes_no',
          required: true,
        },
        {
          id: 'security_program',
          label: 'Describe your information security program or certifications.',
          type: 'long_text',
          required: true,
        },
        {
          id: 'insurance_expiry',
          label: 'When does your current certificate of insurance expire?',
          type: 'date',
          required: false,
        },
      ],
      scoringRules: [
        { questionId: 'tax_registered', equals: 'no', points: 30 },
        { questionId: 'sanctions_program', equals: 'no', points: 35 },
        { questionId: 'security_program', equals: '', points: 10 },
      ],
    };
  }

  private normalizeAnswer(value: unknown) {
    if (typeof value === 'boolean') return value ? 'yes' : 'no';
    return String(value ?? '')
      .trim()
      .toLowerCase();
  }

  private computeRisk(
    questionnaire: any,
    responses: Record<string, unknown>,
    documentLinks: Record<string, unknown>,
  ) {
    let score = 0;
    const scoringRules = Array.isArray(questionnaire?.scoringRules)
      ? questionnaire.scoringRules
      : [];
    for (const rule of scoringRules) {
      const actual = this.normalizeAnswer(responses?.[rule?.questionId]);
      const expected = this.normalizeAnswer(rule?.equals);
      if (expected && actual === expected) score += Number(rule?.points ?? 0);
    }

    for (const key of ['w9', 'coi', 'banking']) {
      const value = documentLinks?.[key];
      if (!value || !String(value).trim()) score += 10;
    }

    const riskLevel = score >= 60 ? 'high' : score >= 25 ? 'medium' : 'low';
    return { score, riskLevel };
  }

  async create(data: typeof vendors.$inferInsert, access?: AccessPolicy) {
    this.assertEntityScope(access, 'vendors:create', data.entityId);
    await this.entitiesService.assertBelongsToOrg(data.organizationId, data.entityId);
    const [vendor] = await this.db.insert(vendors).values(data).returning();
    return vendor;
  }

  async update(
    id: string,
    organizationId: string,
    data: Partial<typeof vendors.$inferInsert>,
    access?: AccessPolicy,
  ) {
    await this.findOne(id, organizationId, access, 'vendors:edit');
    if (data.entityId !== undefined) {
      this.assertEntityScope(access, 'vendors:edit', data.entityId);
    }
    await this.entitiesService.assertBelongsToOrg(organizationId, data.entityId);
    const [vendor] = await this.db
      .update(vendors)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(vendors.id, id), eq(vendors.organizationId, organizationId)))
      .returning();

    if (!vendor) throw new NotFoundException(`Vendor ${id} not found`);
    return vendor;
  }

  async listOnboardingQuestionnaires(organizationId: string, access?: AccessPolicy) {
    this.assertGlobalScope(access, 'vendors:view');
    const questionnaires = await this.db.query.onboardingQuestionnaires.findMany({
      where: (record, { eq }) => eq(record.organizationId, organizationId),
      orderBy: (record, { desc, asc }) => [desc(record.isDefault), asc(record.name)],
    });
    if (questionnaires.length > 0) return questionnaires;
    return [
      {
        id: 'default-template',
        organizationId,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...this.defaultQuestionnaireDefinition(),
      },
    ];
  }

  async createOnboardingQuestionnaire(
    organizationId: string,
    data: {
      name?: string;
      isDefault?: boolean;
      questions?: any[];
      scoringRules?: any[];
    },
    access?: AccessPolicy,
  ) {
    this.assertGlobalScope(access, 'vendors:edit');
    const fallback = this.defaultQuestionnaireDefinition();
    if (data.isDefault) {
      await this.db
        .update(onboardingQuestionnaires)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(onboardingQuestionnaires.organizationId, organizationId));
    }

    const [created] = await this.db
      .insert(onboardingQuestionnaires)
      .values({
        organizationId,
        name: data.name?.trim() || fallback.name,
        isDefault: !!data.isDefault,
        questions:
          Array.isArray(data.questions) && data.questions.length > 0
            ? data.questions
            : fallback.questions,
        scoringRules:
          Array.isArray(data.scoringRules) && data.scoringRules.length > 0
            ? data.scoringRules
            : fallback.scoringRules,
      })
      .returning();
    return created;
  }

  async listOnboardingQueue(organizationId: string, access?: AccessPolicy) {
    const scope = access?.scopeFor('vendor', 'vendors:view');
    let scopedVendorIds: string[] | undefined;
    if (scope && !scope.unrestricted) {
      const rows = await this.db
        .select({ id: vendors.id })
        .from(vendors)
        .where(
          and(
            eq(vendors.organizationId, organizationId),
            scope.entityIds.length > 0 ? inArray(vendors.entityId, scope.entityIds) : sql`false`,
          ),
        );
      scopedVendorIds = rows.map((row) => row.id);
    }
    const submissions = await this.db.query.vendorOnboardingSubmissions.findMany({
      where: (record, { and, eq, inArray }) =>
        and(
          eq(record.organizationId, organizationId),
          inArray(record.status, ['submitted', 'changes_requested']),
          scopedVendorIds ? inArray(record.vendorId, scopedVendorIds) : undefined,
        ),
      with: { vendor: true, questionnaire: true },
      orderBy: (record, { desc }) => desc(record.submittedAt),
    });

    const latestByVendor = new Map<string, any>();
    for (const submission of submissions) {
      if (!latestByVendor.has(submission.vendorId))
        latestByVendor.set(submission.vendorId, submission);
    }
    return Array.from(latestByVendor.values());
  }

  async getOnboardingDetail(vendorId: string, organizationId: string, access?: AccessPolicy) {
    const vendor = await this.findOne(vendorId, organizationId, access, 'vendors:view');
    const [submissions, questionnaires] = await Promise.all([
      this.db.query.vendorOnboardingSubmissions.findMany({
        where: (record, { and, eq }) =>
          and(eq(record.organizationId, organizationId), eq(record.vendorId, vendorId)),
        with: { questionnaire: true },
        orderBy: (record, { desc }) => desc(record.createdAt),
      }),
      this.listOnboardingQuestionnaires(organizationId, access),
    ]);
    return { vendor, submissions, questionnaires };
  }

  async getPortalOnboarding(vendorId: string, organizationId: string) {
    const vendor = await this.findOne(vendorId, organizationId);
    const questionnaires = await this.listOnboardingQuestionnaires(organizationId);
    const questionnaire =
      questionnaires.find((item: any) => item.isDefault) ?? questionnaires[0] ?? null;
    const latestSubmission = await this.db.query.vendorOnboardingSubmissions.findFirst({
      where: (record, { and, eq }) =>
        and(eq(record.organizationId, organizationId), eq(record.vendorId, vendorId)),
      orderBy: (record, { desc }) => desc(record.createdAt),
      with: { questionnaire: true },
    });
    return { vendor, questionnaire, latestSubmission };
  }

  async submitPortalOnboarding(
    vendorId: string,
    organizationId: string,
    data: {
      questionnaireId?: string;
      companyInfo?: Record<string, unknown>;
      responses?: Record<string, unknown>;
      documentLinks?: Record<string, unknown>;
      bankingDetails?: Record<string, unknown>;
      submit?: boolean;
    },
  ) {
    const vendor = await this.findOne(vendorId, organizationId);
    const questionnaires = await this.listOnboardingQuestionnaires(organizationId);
    const questionnaire =
      questionnaires.find((item: any) => item.id === data.questionnaireId) ??
      questionnaires.find((item: any) => item.isDefault) ??
      questionnaires[0];

    if (!questionnaire) throw new BadRequestException('No onboarding questionnaire is configured');

    const { score, riskLevel } = this.computeRisk(
      questionnaire,
      (data.responses ?? {}) as Record<string, unknown>,
      (data.documentLinks ?? {}) as Record<string, unknown>,
    );
    const status = data.submit ? 'submitted' : 'draft';

    const [submission] = await this.db
      .insert(vendorOnboardingSubmissions)
      .values({
        organizationId,
        vendorId,
        questionnaireId: questionnaire.id === 'default-template' ? null : questionnaire.id,
        status,
        companyInfo: data.companyInfo ?? {},
        responses: data.responses ?? {},
        documentLinks: data.documentLinks ?? {},
        bankingDetails: data.bankingDetails ?? {},
        riskScore: String(score),
        riskLevel,
        submittedAt: data.submit ? new Date() : null,
      })
      .returning();

    await this.db
      .update(vendors)
      .set({
        onboardingStatus: data.submit
          ? 'pending_review'
          : vendor.onboardingStatus === 'approved'
            ? 'approved'
            : 'not_started',
        onboardingRiskScore: score,
        onboardingRiskLevel: riskLevel,
        onboardingLastSubmittedAt: data.submit ? new Date() : vendor.onboardingLastSubmittedAt,
        updatedAt: new Date(),
      })
      .where(and(eq(vendors.id, vendorId), eq(vendors.organizationId, organizationId)));

    return submission;
  }

  async reviewOnboarding(
    vendorId: string,
    organizationId: string,
    data: { decision: 'approved' | 'changes_requested'; reviewNote?: string },
    access?: AccessPolicy,
  ) {
    await this.findOne(vendorId, organizationId, access, 'vendors:edit');
    const latest = await this.db.query.vendorOnboardingSubmissions.findFirst({
      where: (record, { and, eq }) =>
        and(eq(record.organizationId, organizationId), eq(record.vendorId, vendorId)),
      orderBy: (record, { desc }) => desc(record.createdAt),
    });
    if (!latest)
      throw new NotFoundException(`No onboarding submission found for vendor ${vendorId}`);

    const nextStatus = data.decision === 'approved' ? 'approved' : 'changes_requested';
    await this.db
      .update(vendorOnboardingSubmissions)
      .set({
        status: nextStatus,
        reviewNote: data.reviewNote?.trim() || null,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(vendorOnboardingSubmissions.id, latest.id));

    const [vendor] = await this.db
      .update(vendors)
      .set({
        onboardingStatus: data.decision === 'approved' ? 'approved' : 'changes_requested',
        onboardingApprovedAt: data.decision === 'approved' ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(and(eq(vendors.id, vendorId), eq(vendors.organizationId, organizationId)))
      .returning();
    return vendor;
  }

  async updateEsg(
    id: string,
    organizationId: string,
    data: {
      diversityCategories?: string[];
      esgRating?: string;
      carbonFootprintTons?: string;
      sustainabilityCertifications?: string[];
      esgNotes?: string;
      diversityVerifiedAt?: string;
    },
    access?: AccessPolicy,
  ) {
    await this.findOne(id, organizationId, access, 'vendors:edit');
    const [vendor] = await this.db
      .update(vendors)
      .set({
        ...(data.diversityCategories !== undefined && {
          diversityCategories: data.diversityCategories,
        }),
        ...(data.esgRating !== undefined && { esgRating: data.esgRating }),
        ...(data.carbonFootprintTons !== undefined && {
          carbonFootprintTons: data.carbonFootprintTons,
        }),
        ...(data.sustainabilityCertifications !== undefined && {
          sustainabilityCertifications: data.sustainabilityCertifications,
        }),
        ...(data.esgNotes !== undefined && { esgNotes: data.esgNotes }),
        ...(data.diversityVerifiedAt && {
          diversityVerifiedAt: new Date(data.diversityVerifiedAt),
        }),
        updatedAt: new Date(),
      })
      .where(and(eq(vendors.id, id), eq(vendors.organizationId, organizationId)))
      .returning();
    return vendor;
  }

  async getDiversitySummary(organizationId: string, access?: AccessPolicy) {
    const scope = access?.scopeFor('vendor', 'vendors:view');
    const allVendors = await this.db.query.vendors.findMany({
      where: (vendor, { and, eq }) =>
        and(
          eq(vendor.organizationId, organizationId),
          scope && !scope.unrestricted
            ? scope.entityIds.length > 0
              ? inArray(vendor.entityId, scope.entityIds)
              : sql`false`
            : undefined,
        ),
    });

    const diversityCategories: Record<string, number> = {};
    const esgRatings: Record<string, number> = {};
    let diverseCount = 0;
    let ratedCount = 0;

    for (const v of allVendors) {
      const cats = (v.diversityCategories as string[]) ?? [];
      if (cats.length > 0) diverseCount++;
      for (const c of cats) {
        diversityCategories[c] = (diversityCategories[c] ?? 0) + 1;
      }
      if (v.esgRating) {
        ratedCount++;
        esgRatings[v.esgRating] = (esgRatings[v.esgRating] ?? 0) + 1;
      }
    }

    return {
      totalVendors: allVendors.length,
      diverseVendors: diverseCount,
      diversityRate: allVendors.length ? Math.round((diverseCount / allVendors.length) * 100) : 0,
      esgRatedVendors: ratedCount,
      diversityBreakdown: diversityCategories,
      esgRatingBreakdown: esgRatings,
      topDiverseVendors: allVendors
        .filter((v) => ((v.diversityCategories as string[]) ?? []).length > 0)
        .slice(0, 10)
        .map((v) => ({
          id: v.id,
          name: v.name,
          categories: v.diversityCategories,
          esgRating: v.esgRating,
        })),
    };
  }

  async getTransactions(id: string, organizationId: string, access?: AccessPolicy) {
    await this.findOne(id, organizationId, access, 'vendors:view');

    const [invoiceRows, poRows] = await Promise.all([
      this.db.execute(sql`
        SELECT
          i.id, i.internal_number AS number, i.invoice_number AS "vendorInvoiceNumber",
          i.status, i.match_status AS "matchStatus", i.total_amount::numeric AS amount,
          i.invoice_date AS date, i.approved_at AS "approvedAt"
        FROM invoices i
        WHERE i.vendor_id = ${id} AND i.organization_id = ${organizationId}
        ORDER BY i.created_at DESC
        LIMIT 50
      `),
      this.db.execute(sql`
        SELECT
          po.id, po.internal_number AS number, po.status,
          po.total_amount::numeric AS amount, po.issued_at AS "issuedAt", po.created_at AS date
        FROM purchase_orders po
        WHERE po.vendor_id = ${id} AND po.organization_id = ${organizationId}
        ORDER BY po.created_at DESC
        LIMIT 50
      `),
    ]);

    return { invoices: invoiceRows, purchaseOrders: poRows };
  }

  private assertEntityScope(
    access: AccessPolicy | undefined,
    permission: PermissionKey,
    entityId: string | null | undefined,
  ) {
    if (!access) return;
    const scope = access.scopeFor('vendor', permission);
    if (scope.unrestricted) return;
    if (!entityId || !scope.entityIds.includes(entityId)) {
      throw new ForbiddenException('The vendor is outside your assigned scope');
    }
  }

  private assertGlobalScope(access: AccessPolicy | undefined, permission: PermissionKey) {
    if (!access) return;
    if (!access.scopeFor('vendor', permission).unrestricted) {
      throw new ForbiddenException('This supplier operation requires a global grant');
    }
  }
}
