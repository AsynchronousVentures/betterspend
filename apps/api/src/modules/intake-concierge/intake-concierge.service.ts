import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { createRequisitionSchema, type CreateRequisitionInput } from '@betterspend/shared';
import {
  intakeConciergeSessions,
  procurementPolicies,
  requisitions,
  type ConciergeTranscriptEntry,
  type Db,
} from '@betterspend/db';
import { DB_TOKEN } from '../../database/database.module';
import { AuditService } from '../audit/audit.service';
import { AiParsedRequisition, AiRequisitionService } from '../requisitions/ai-requisition.service';
import { RequisitionsService } from '../requisitions/requisitions.service';
import { RfqService } from '../rfq/rfq.service';

type WorkflowRoute = 'requisition' | 'rfq' | 'vendor_onboarding' | 'software_license';

interface PolicyLike {
  id: string;
  title: string;
  policyType: string;
  body: string;
  rules: Record<string, unknown>;
  source: 'default' | 'admin';
}

interface Citation {
  sourceType: 'policy' | 'approval_rule' | 'budget' | 'catalog' | 'contract' | 'software_license' | 'vendor';
  sourceId: string;
  title: string;
  excerpt: string;
}

interface PolicyAnswer {
  question: string;
  answer: string;
  citations: Citation[];
}

interface ConciergePlan {
  summary: string;
  route: {
    workflow: WorkflowRoute;
    label: string;
    url: string;
    reason: string;
  };
  estimatedAmount: number;
  currency: string;
  confidence: number;
  missingFields: string[];
  questions: Array<{ field: string; prompt: string; reason: string }>;
  policyCitations: Citation[];
  preferredVendors: Array<Record<string, unknown>>;
  recommendedCatalogItems: Array<Record<string, unknown>>;
  activeContracts: Array<Record<string, unknown>>;
  softwareMatches: Array<Record<string, unknown>>;
  approvalEstimate: {
    activeRuleCount: number;
    estimatedSteps: number;
    summary: string;
    deterministic: true;
  };
  budgetImpact: {
    budgetsInScope: number;
    estimatedAmount: number;
    currency: string;
    summary: string;
    deterministic: true;
  };
  guardrails: string[];
  warnings: string[];
  policyAnswer?: PolicyAnswer;
}

const DEFAULT_POLICIES: PolicyLike[] = [
  {
    id: 'default-rfq-threshold',
    title: 'Competitive sourcing threshold',
    policyType: 'sourcing',
    body: 'Purchases at or above 10000 USD should be reviewed for RFQ or competitive sourcing before a purchase order is issued.',
    rules: { rfqThreshold: 10000 },
    source: 'default',
  },
  {
    id: 'default-preferred-suppliers',
    title: 'Preferred supplier guidance',
    policyType: 'supplier',
    body: 'Requesters should use active catalog items, approved vendors, and active contracts before requesting a new supplier.',
    rules: {},
    source: 'default',
  },
  {
    id: 'default-software-license',
    title: 'Software and SaaS routing',
    policyType: 'software',
    body: 'Software, SaaS subscriptions, and license changes should be checked against existing software license records before purchase.',
    rules: {},
    source: 'default',
  },
  {
    id: 'default-deterministic-controls',
    title: 'Controls remain deterministic',
    policyType: 'controls',
    body: 'AI guidance may prepare drafts, but approval, budget, and spend-guard checks are enforced by the existing deterministic workflows.',
    rules: {},
    source: 'default',
  },
];

@Injectable()
export class IntakeConciergeService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly aiRequisitionService: AiRequisitionService,
    private readonly requisitionsService: RequisitionsService,
    private readonly rfqService: RfqService,
    private readonly audit: AuditService,
  ) {}

  async listPolicies(organizationId: string) {
    return this.db.query.procurementPolicies.findMany({
      where: (policy, { eq }) => eq(policy.organizationId, organizationId),
      orderBy: (policy, { desc }) => desc(policy.updatedAt),
      limit: 100,
    });
  }

  async createPolicy(
    organizationId: string,
    userId: string,
    input: { title?: string; policyType?: string; body?: string; rules?: Record<string, unknown>; status?: string },
  ) {
    const title = input.title?.trim();
    const body = input.body?.trim();
    if (!title || !body) throw new BadRequestException('title and body are required');

    const [created] = await this.db
      .insert(procurementPolicies)
      .values({
        organizationId,
        title,
        policyType: input.policyType?.trim() || 'general',
        body,
        rules: input.rules ?? {},
        status: input.status ?? 'active',
        createdBy: userId,
      })
      .returning();

    await this.audit
      .log(organizationId, userId, 'procurement_policy', created.id, 'created', {
        title: created.title,
        policyType: created.policyType,
      })
      .catch(() => {});

    return created;
  }

  async updatePolicy(
    id: string,
    organizationId: string,
    userId: string,
    input: { title?: string; policyType?: string; body?: string; rules?: Record<string, unknown>; status?: string },
  ) {
    await this.findPolicy(id, organizationId);

    const [updated] = await this.db
      .update(procurementPolicies)
      .set({
        title: input.title?.trim(),
        policyType: input.policyType?.trim(),
        body: input.body?.trim(),
        rules: input.rules,
        status: input.status,
        updatedAt: new Date(),
      })
      .where(and(eq(procurementPolicies.id, id), eq(procurementPolicies.organizationId, organizationId)))
      .returning();

    await this.audit
      .log(organizationId, userId, 'procurement_policy', id, 'updated', {
        title: updated.title,
        policyType: updated.policyType,
        status: updated.status,
      })
      .catch(() => {});

    return updated;
  }

  async createSession(organizationId: string, requesterId: string, input: { text?: string }) {
    const sourceText = input.text?.trim();
    if (!sourceText) throw new BadRequestException('text is required');

    const draft = await this.aiRequisitionService.parseFromText(sourceText);
    const plan = await this.buildPlan(organizationId, sourceText, draft);
    const transcript = this.newTranscript(sourceText, plan);

    const [created] = await this.db
      .insert(intakeConciergeSessions)
      .values({
        organizationId,
        requesterId,
        sourceText,
        transcript,
        draft: draft as unknown as Record<string, unknown>,
        plan: plan as unknown as Record<string, unknown>,
      })
      .returning();

    await this.audit
      .log(organizationId, requesterId, 'intake_concierge_session', created.id, 'created', {
        workflow: plan.route.workflow,
        estimatedAmount: plan.estimatedAmount,
      })
      .catch(() => {});

    return created;
  }

  async findSession(id: string, organizationId: string) {
    const session = await this.db.query.intakeConciergeSessions.findFirst({
      where: (record, { and, eq }) => and(eq(record.id, id), eq(record.organizationId, organizationId)),
    });
    if (!session) throw new NotFoundException(`Concierge session ${id} not found`);
    return session;
  }

  async addMessage(id: string, organizationId: string, requesterId: string, input: { message?: string }) {
    const message = input.message?.trim();
    if (!message) throw new BadRequestException('message is required');

    const session = await this.findSession(id, organizationId);
    if (session.status !== 'draft') {
      throw new BadRequestException('Only draft concierge sessions can be updated');
    }

    if (this.looksLikePolicyQuestion(message)) {
      const plan = session.plan as unknown as ConciergePlan;
      const policyAnswer = await this.answerPolicyQuestion(organizationId, message);
      const transcript = [
        ...(session.transcript ?? []),
        { role: 'user' as const, content: message, createdAt: new Date().toISOString() },
        { role: 'assistant' as const, content: policyAnswer.answer, createdAt: new Date().toISOString() },
      ];
      const nextPlan = {
        ...plan,
        policyAnswer,
        policyCitations: this.mergeCitations(plan.policyCitations ?? [], policyAnswer.citations),
      };

      const [updated] = await this.db
        .update(intakeConciergeSessions)
        .set({
          transcript,
          plan: nextPlan as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .where(and(eq(intakeConciergeSessions.id, id), eq(intakeConciergeSessions.organizationId, organizationId)))
        .returning();

      await this.audit
        .log(organizationId, requesterId, 'intake_concierge_session', id, 'policy_question_answered', {
          citationCount: policyAnswer.citations.length,
        })
        .catch(() => {});

      return updated;
    }

    const sourceText = `${session.sourceText}\n${message}`;
    const draft = await this.aiRequisitionService.parseFromText(sourceText);
    const plan = await this.buildPlan(organizationId, sourceText, draft);
    const transcript = [
      ...(session.transcript ?? []),
      { role: 'user' as const, content: message, createdAt: new Date().toISOString() },
      this.assistantTranscriptEntry(plan),
    ];

    const [updated] = await this.db
      .update(intakeConciergeSessions)
      .set({
        sourceText,
        transcript,
        draft: draft as unknown as Record<string, unknown>,
        plan: plan as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(and(eq(intakeConciergeSessions.id, id), eq(intakeConciergeSessions.organizationId, organizationId)))
      .returning();

    await this.audit
      .log(organizationId, requesterId, 'intake_concierge_session', id, 'message_added', {
        workflow: plan.route.workflow,
        estimatedAmount: plan.estimatedAmount,
      })
      .catch(() => {});

    return updated;
  }

  async convertSession(
    id: string,
    organizationId: string,
    requesterId: string,
    input: { workflow?: WorkflowRoute; acceptedValues?: Record<string, unknown> },
  ) {
    const session = await this.findSession(id, organizationId);
    if (session.status !== 'draft') {
      throw new BadRequestException('This concierge session has already been converted or routed');
    }

    const acceptedValues = input.acceptedValues ?? {};
    const plan = session.plan as unknown as ConciergePlan;
    const workflow = input.workflow ?? plan.route.workflow;

    if (workflow === 'requisition') {
      const requisitionInput = this.toRequisitionInput(
        session.draft as unknown as AiParsedRequisition,
        acceptedValues,
      );
      const created = await this.requisitionsService.create(organizationId, requesterId, requisitionInput);
      await this.db
        .update(requisitions)
        .set({ sourceType: 'concierge', updatedAt: new Date() })
        .where(and(eq(requisitions.id, created.id), eq(requisitions.organizationId, organizationId)));

      await this.markConverted(session.id, organizationId, requesterId, {
        workflow,
        draftType: 'requisition',
        draftId: created.id,
        acceptedValues,
      });

      return {
        workflow,
        url: `/requisitions/${created.id}`,
        draftType: 'requisition',
        draftId: created.id,
        requisition: { ...created, sourceType: 'concierge' },
      };
    }

    if (workflow === 'rfq') {
      const rfqInput = this.toRfqInput(session.draft as unknown as AiParsedRequisition, acceptedValues, plan);
      const created = await this.rfqService.create(organizationId, requesterId, rfqInput);
      await this.markConverted(session.id, organizationId, requesterId, {
        workflow,
        draftType: 'rfq',
        draftId: created.id,
        acceptedValues,
      });

      return {
        workflow,
        url: '/rfq',
        draftType: 'rfq',
        draftId: created.id,
        rfq: created,
      };
    }

    const route = this.routeForWorkflow(workflow);
    await this.markConverted(session.id, organizationId, requesterId, {
      workflow,
      draftType: workflow,
      draftId: null,
      acceptedValues,
      status: 'routed',
    });

    return {
      workflow,
      url: route.url,
      draftType: workflow,
      draftId: null,
      message: route.reason,
    };
  }

  private async findPolicy(id: string, organizationId: string) {
    const policy = await this.db.query.procurementPolicies.findFirst({
      where: (record, { and, eq }) => and(eq(record.id, id), eq(record.organizationId, organizationId)),
    });
    if (!policy) throw new NotFoundException(`Procurement policy ${id} not found`);
    return policy;
  }

  private async buildPlan(
    organizationId: string,
    sourceText: string,
    draft: AiParsedRequisition,
  ): Promise<ConciergePlan> {
    const terms = this.extractTerms(sourceText, draft);
    const estimatedAmount = this.estimateAmount(draft);
    const currency = 'USD';

    const [policies, catalog, vendorRows, contractRows, budgetRows, ruleRows, licenseRows] =
      await Promise.all([
        this.loadPolicies(organizationId),
        this.db.query.catalogItems.findMany({
          where: (item, { and, eq }) => and(eq(item.organizationId, organizationId), eq(item.isActive, true)),
          with: { vendor: true },
          limit: 100,
        }),
        this.db.query.vendors.findMany({
          where: (vendor, { eq }) => eq(vendor.organizationId, organizationId),
          orderBy: (vendor, { asc }) => asc(vendor.name),
          limit: 100,
        }),
        this.db.query.contracts.findMany({
          where: (contract, { and, eq }) => and(eq(contract.organizationId, organizationId), eq(contract.status, 'active')),
          with: { vendor: true, lines: true },
          limit: 75,
        }),
        this.db.query.budgets.findMany({
          where: (budget, { and, eq }) =>
            and(eq(budget.organizationId, organizationId), eq(budget.fiscalYear, new Date().getFullYear())),
          limit: 50,
        }),
        this.db.query.approvalRules.findMany({
          where: (rule, { and, eq }) => and(eq(rule.organizationId, organizationId), eq(rule.isActive, true)),
          with: { steps: true },
          orderBy: (rule, { asc }) => asc(rule.priority),
          limit: 50,
        }),
        this.db.query.softwareLicenses.findMany({
          where: (license, { and, eq }) => and(eq(license.organizationId, organizationId), eq(license.status, 'active')),
          with: { vendor: true, contract: true },
          limit: 75,
        }),
      ]);

    const vendorCandidates = vendorRows
      .map((vendor) => ({
        id: vendor.id,
        name: vendor.name,
        status: vendor.status,
        onboardingStatus: vendor.onboardingStatus,
        riskLevel: vendor.onboardingRiskLevel,
        score:
          this.scoreText(vendor.name, terms) +
          (this.sameText(vendor.name, draft.suggestedVendor) ? 6 : 0),
      }))
      .sort((a, b) => {
        const activeDelta = Number(b.status === 'active') - Number(a.status === 'active');
        const approvedDelta = Number(b.onboardingStatus === 'approved') - Number(a.onboardingStatus === 'approved');
        return b.score - a.score || activeDelta || approvedDelta || a.name.localeCompare(b.name);
      });

    const matchedVendorIds = new Set(vendorCandidates.filter((vendor) => vendor.score > 0).map((vendor) => vendor.id));
    const preferredVendors = vendorCandidates.filter((vendor) => vendor.score > 0).slice(0, 5);

    const vendorMatch = draft.suggestedVendor
      ? vendorRows.find((vendor) => this.sameText(vendor.name, draft.suggestedVendor))
      : undefined;

    const recommendedCatalogItems = catalog
      .map((item) => ({
        id: item.id,
        name: item.name,
        sku: item.sku,
        description: item.description,
        category: item.category,
        unitOfMeasure: item.unitOfMeasure,
        unitPrice: Number(item.unitPrice || 0),
        currency: item.currency,
        vendorId: item.vendorId,
        vendorName: item.vendor?.name ?? null,
        score:
          this.scoreText(`${item.name} ${item.description ?? ''} ${item.category ?? ''} ${item.sku ?? ''}`, terms) +
          (item.vendor && this.sameText(item.vendor.name, draft.suggestedVendor) ? 3 : 0),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, 5);

    const activeContracts = contractRows
      .map((contract) => ({
        id: contract.id,
        title: contract.title,
        contractNumber: contract.contractNumber,
        status: contract.status,
        vendorId: contract.vendorId,
        vendorName: contract.vendor?.name ?? null,
        endDate: contract.endDate,
        totalValue: contract.totalValue,
        currency: contract.currency,
        score:
          this.scoreText(
            `${contract.title} ${contract.description ?? ''} ${contract.vendor?.name ?? ''} ${
              contract.lines?.map((line) => line.description).join(' ') ?? ''
            }`,
            terms,
          ) + (contract.vendorId && matchedVendorIds.has(contract.vendorId) ? 2 : 0),
      }))
      .filter((contract) => contract.score > 0)
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
      .slice(0, 5);

    const softwareMatches = licenseRows
      .map((license) => ({
        id: license.id,
        productName: license.productName,
        status: license.status,
        vendorId: license.vendorId,
        vendorName: license.vendor?.name ?? null,
        seatCount: license.seatCount,
        seatsUsed: license.seatsUsed,
        renewalDate: license.renewalDate,
        score: this.scoreText(`${license.productName} ${license.vendor?.name ?? ''}`, terms),
      }))
      .filter((license) => license.score > 0)
      .sort((a, b) => b.score - a.score || a.productName.localeCompare(b.productName))
      .slice(0, 5);

    const rfqThreshold = this.rfqThreshold(policies);
    const isSoftware = this.looksLikeSoftware(sourceText, draft) || softwareMatches.length > 0;
    const route = this.chooseRoute({
      estimatedAmount,
      rfqThreshold,
      isSoftware,
      hasUnknownVendor: Boolean(draft.suggestedVendor && !vendorMatch),
      hasCatalogMatch: recommendedCatalogItems.length > 0,
    });

    const missingFields = this.missingFields(draft, route.workflow, estimatedAmount);
    const policyCitations = this.citationsForRoute(route.workflow, policies, {
      budgetRows,
      ruleRows,
      catalogItems: recommendedCatalogItems,
      contracts: activeContracts,
      softwareMatches,
      preferredVendors,
    });
    const estimatedSteps = Math.max(0, ...ruleRows.map((rule) => rule.steps?.length ?? 0));
    const warnings = this.warnings(route.workflow, {
      suggestedVendor: draft.suggestedVendor,
      vendorMatch,
      estimatedAmount,
      rfqThreshold,
      isSoftware,
      catalogCount: recommendedCatalogItems.length,
      contractCount: activeContracts.length,
    });

    return {
      summary: `Prepared ${draft.title || 'purchase request'} with an estimated ${currency} ${estimatedAmount.toFixed(2)} total.`,
      route,
      estimatedAmount,
      currency,
      confidence: this.confidence(recommendedCatalogItems.length, preferredVendors.length, missingFields.length),
      missingFields,
      questions: missingFields.map((field) => ({
        field,
        prompt: this.promptForField(field),
        reason: 'Required to finalize routing or create a clean draft.',
      })),
      policyCitations,
      preferredVendors,
      recommendedCatalogItems,
      activeContracts,
      softwareMatches,
      approvalEstimate: {
        activeRuleCount: ruleRows.length,
        estimatedSteps,
        summary: ruleRows.length
          ? `${ruleRows.length} active approval rule${ruleRows.length === 1 ? '' : 's'} may evaluate this request after draft creation.`
          : 'No active approval rules are configured yet; submission will still run the approval engine.',
        deterministic: true,
      },
      budgetImpact: {
        budgetsInScope: budgetRows.length,
        estimatedAmount,
        currency,
        summary: budgetRows.length
          ? `${budgetRows.length} current-year budget${budgetRows.length === 1 ? '' : 's'} can be checked once department or project is selected.`
          : 'No current-year budgets were found; requisition submission will still run the budget gate when applicable.',
        deterministic: true,
      },
      guardrails: [
        'AI recommendations create drafts only.',
        'Budget checks run when requisitions are submitted.',
        'Approval routing is recalculated by the approval engine.',
        'Spend Guard analysis runs after draft requisition creation.',
      ],
      warnings,
    };
  }

  private async loadPolicies(organizationId: string): Promise<PolicyLike[]> {
    const rows = await this.db.query.procurementPolicies.findMany({
      where: (policy, { and, eq }) => and(eq(policy.organizationId, organizationId), eq(policy.status, 'active')),
      orderBy: (policy, { desc }) => desc(policy.updatedAt),
      limit: 50,
    });

    const adminPolicies = rows.map((policy) => ({
      id: policy.id,
      title: policy.title,
      policyType: policy.policyType,
      body: policy.body,
      rules: policy.rules ?? {},
      source: 'admin' as const,
    }));

    return [...adminPolicies, ...DEFAULT_POLICIES];
  }

  private chooseRoute(input: {
    estimatedAmount: number;
    rfqThreshold: number;
    isSoftware: boolean;
    hasUnknownVendor: boolean;
    hasCatalogMatch: boolean;
  }): ConciergePlan['route'] {
    if (input.hasUnknownVendor) {
      return {
        workflow: 'vendor_onboarding',
        label: 'Vendor onboarding',
        url: '/vendors/onboarding',
        reason: 'The request names a supplier that is not an approved vendor record yet.',
      };
    }

    if (input.isSoftware) {
      return {
        workflow: 'software_license',
        label: 'Software license review',
        url: '/software-licenses',
        reason: 'The request appears to involve software, SaaS, seats, or subscription licensing.',
      };
    }

    if (input.estimatedAmount >= input.rfqThreshold) {
      return {
        workflow: 'rfq',
        label: 'RFQ / sourcing',
        url: '/rfq',
        reason: `The estimated amount meets the ${input.rfqThreshold.toFixed(0)} competitive sourcing threshold.`,
      };
    }

    return {
      workflow: 'requisition',
      label: 'Requisition draft',
      url: '/requisitions/new',
      reason: input.hasCatalogMatch
        ? 'The request can start as a requisition with matched catalog guidance.'
        : 'The request can start as a requisition draft and be reviewed before submission.',
    };
  }

  private citationsForRoute(
    workflow: WorkflowRoute,
    policies: PolicyLike[],
    matches: {
      budgetRows: Array<{ id: string; name: string; budgetType: string }>;
      ruleRows: Array<{ id: string; name: string; description: string | null }>;
      catalogItems: Array<Record<string, unknown>>;
      contracts: Array<Record<string, unknown>>;
      softwareMatches: Array<Record<string, unknown>>;
      preferredVendors: Array<Record<string, unknown>>;
    },
  ): Citation[] {
    const relevantPolicyTypes = new Set(['controls', 'general']);
    if (workflow === 'rfq') relevantPolicyTypes.add('sourcing');
    if (workflow === 'software_license') relevantPolicyTypes.add('software');
    if (workflow === 'vendor_onboarding') relevantPolicyTypes.add('supplier');
    if (workflow === 'requisition') relevantPolicyTypes.add('supplier');

    const policyCitations = policies
      .filter((policy) => relevantPolicyTypes.has(policy.policyType))
      .slice(0, 4)
      .map((policy) => ({
        sourceType: 'policy' as const,
        sourceId: policy.id,
        title: policy.title,
        excerpt: policy.body.slice(0, 220),
      }));

    const sourceCitations: Citation[] = [];
    for (const item of matches.catalogItems.slice(0, 2)) {
      sourceCitations.push({
        sourceType: 'catalog',
        sourceId: String(item.id),
        title: String(item.name),
        excerpt: `Catalog match from ${item.vendorName ?? 'vendor not set'} at ${item.currency ?? 'USD'} ${item.unitPrice ?? 0}.`,
      });
    }
    for (const contract of matches.contracts.slice(0, 2)) {
      sourceCitations.push({
        sourceType: 'contract',
        sourceId: String(contract.id),
        title: String(contract.title),
        excerpt: `Active contract ${contract.contractNumber ?? ''} with ${contract.vendorName ?? 'vendor not set'}.`,
      });
    }
    for (const license of matches.softwareMatches.slice(0, 2)) {
      sourceCitations.push({
        sourceType: 'software_license',
        sourceId: String(license.id),
        title: String(license.productName),
        excerpt: `${license.seatsUsed ?? 0}/${license.seatCount ?? 0} seats used with ${license.vendorName ?? 'vendor not set'}.`,
      });
    }
    for (const vendor of matches.preferredVendors.slice(0, 1)) {
      sourceCitations.push({
        sourceType: 'vendor',
        sourceId: String(vendor.id),
        title: String(vendor.name),
        excerpt: `Supplier status ${vendor.status}; onboarding ${vendor.onboardingStatus}.`,
      });
    }
    for (const rule of matches.ruleRows.slice(0, 1)) {
      sourceCitations.push({
        sourceType: 'approval_rule',
        sourceId: rule.id,
        title: rule.name,
        excerpt: rule.description ?? 'Active approval rule will be evaluated on submission.',
      });
    }
    for (const budget of matches.budgetRows.slice(0, 1)) {
      sourceCitations.push({
        sourceType: 'budget',
        sourceId: budget.id,
        title: budget.name,
        excerpt: `${budget.budgetType} budget is available for deterministic budget checks.`,
      });
    }

    return [...policyCitations, ...sourceCitations].slice(0, 8);
  }

  private async answerPolicyQuestion(organizationId: string, question: string): Promise<PolicyAnswer> {
    const terms = this.extractTermsFromText(question);
    const policies = await this.loadPolicies(organizationId);
    const matches = policies
      .map((policy) => ({
        policy,
        score: this.scoreText(`${policy.title} ${policy.policyType} ${policy.body}`, terms),
      }))
      .filter((match) => match.score > 0)
      .sort((a, b) => b.score - a.score || a.policy.title.localeCompare(b.policy.title))
      .slice(0, 3);

    const selected = matches.length > 0
      ? matches.map((match) => match.policy)
      : policies.filter((policy) => ['controls', 'general'].includes(policy.policyType)).slice(0, 2);

    const citations = selected.map((policy) => ({
      sourceType: 'policy' as const,
      sourceId: policy.id,
      title: policy.title,
      excerpt: policy.body.slice(0, 220),
    }));

    const answer = selected.length > 0
      ? `I found ${selected.length} matching policy source${selected.length === 1 ? '' : 's'}: ${selected
          .map((policy) => policy.title)
          .join(', ')}. ${selected[0].body}`
      : 'I did not find a matching procurement policy source. Ask an admin to add a procurement policy for this scenario.';

    return { question, answer, citations };
  }

  private mergeCitations(existing: Citation[], next: Citation[]) {
    const seen = new Set<string>();
    return [...next, ...existing].filter((citation) => {
      const key = `${citation.sourceType}:${citation.sourceId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 8);
  }

  private warnings(workflow: WorkflowRoute, input: {
    suggestedVendor?: string;
    vendorMatch?: { id: string };
    estimatedAmount: number;
    rfqThreshold: number;
    isSoftware: boolean;
    catalogCount: number;
    contractCount: number;
  }) {
    const warnings: string[] = [];
    if (input.suggestedVendor && !input.vendorMatch) {
      warnings.push(`Supplier "${input.suggestedVendor}" is not an active vendor record in this workspace.`);
    }
    if (workflow === 'rfq') {
      warnings.push(`Estimated amount is at or above the competitive sourcing threshold of ${input.rfqThreshold.toFixed(0)}.`);
    }
    if (input.isSoftware && workflow !== 'software_license') {
      warnings.push('Software keywords were detected; review licensing impact before purchase.');
    }
    if (input.catalogCount === 0) {
      warnings.push('No catalog item matched strongly; request details may need a manual line-item review.');
    }
    if (input.contractCount === 0) {
      warnings.push('No active contract matched strongly for this request.');
    }
    return warnings;
  }

  private missingFields(draft: AiParsedRequisition, workflow: WorkflowRoute, estimatedAmount: number) {
    const fields: string[] = [];
    if (!draft.neededBy) fields.push('neededBy');
    if (!draft.suggestedVendor) fields.push('supplier');
    if (!draft.lines?.length || draft.lines.some((line) => !line.unitPrice && estimatedAmount === 0)) {
      fields.push('estimatedPrice');
    }
    fields.push('departmentOrProject');
    if (workflow === 'rfq') fields.push('supplierShortlist');
    if (workflow === 'software_license') fields.push('licenseOwner');
    if (workflow === 'vendor_onboarding') fields.push('supplierContact');
    return Array.from(new Set(fields));
  }

  private promptForField(field: string) {
    const prompts: Record<string, string> = {
      neededBy: 'When do you need this by?',
      supplier: 'Do you have a preferred supplier, or should procurement recommend one?',
      estimatedPrice: 'What is the expected unit price or overall budget?',
      departmentOrProject: 'Which department or project should own the spend?',
      supplierShortlist: 'Which suppliers should be invited to quote?',
      licenseOwner: 'Who should own the software license or subscription?',
      supplierContact: 'What contact details do you have for the new supplier?',
    };
    return prompts[field] ?? `Please provide ${field}.`;
  }

  private routeForWorkflow(workflow: WorkflowRoute) {
    if (workflow === 'vendor_onboarding') {
      return {
        url: '/vendors/onboarding',
        reason: 'Routed to supplier onboarding for vendor setup before purchase.',
      };
    }
    if (workflow === 'software_license') {
      return {
        url: '/software-licenses',
        reason: 'Routed to software license review for subscription, seat, and renewal checks.',
      };
    }
    if (workflow === 'rfq') {
      return { url: '/rfq', reason: 'Routed to RFQ / sourcing.' };
    }
    return { url: '/requisitions/new', reason: 'Routed to requisitions.' };
  }

  private toRequisitionInput(
    draft: AiParsedRequisition,
    acceptedValues: Record<string, unknown>,
  ): CreateRequisitionInput {
    const merged = { ...draft, ...acceptedValues } as AiParsedRequisition & Record<string, unknown>;
    const lines = this.normalizedLines(merged);
    const neededBy = this.isoDate(merged.neededBy as string | undefined);

    return createRequisitionSchema.parse({
      title: String(merged.title || 'New Requisition').slice(0, 255),
      description: typeof merged.description === 'string' ? merged.description : undefined,
      departmentId: typeof merged.departmentId === 'string' ? merged.departmentId : undefined,
      projectId: typeof merged.projectId === 'string' ? merged.projectId : undefined,
      priority: ['low', 'normal', 'high', 'urgent'].includes(String(merged.priority))
        ? merged.priority
        : 'normal',
      neededBy,
      currency: typeof merged.currency === 'string' && merged.currency.length === 3 ? merged.currency : 'USD',
      lines,
    });
  }

  private toRfqInput(
    draft: AiParsedRequisition,
    acceptedValues: Record<string, unknown>,
    plan: ConciergePlan,
  ) {
    const merged = { ...draft, ...acceptedValues } as AiParsedRequisition & Record<string, unknown>;
    return {
      title: String(merged.title || 'New sourcing event').slice(0, 255),
      description: typeof merged.description === 'string' ? merged.description : undefined,
      currency: typeof merged.currency === 'string' && merged.currency.length === 3 ? merged.currency : 'USD',
      notes: `Created from AI concierge. ${plan.route.reason}`,
      lines: this.normalizedLines(merged).map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unitOfMeasure: line.unitOfMeasure,
        targetPrice: line.unitPrice || undefined,
      })),
      vendorIds: plan.preferredVendors
        .filter((vendor) => Number(vendor.score ?? 0) > 0)
        .map((vendor) => String(vendor.id))
        .filter((id) => id.length > 0),
    };
  }

  private normalizedLines(draft: AiParsedRequisition & Record<string, unknown>) {
    const sourceLines = Array.isArray(draft.lines) && draft.lines.length
      ? draft.lines
      : [{ description: String(draft.title || 'Requested item'), quantity: 1, unitOfMeasure: 'each', unitPrice: 0 }];

    return sourceLines.map((line) => ({
      description: String(line.description || draft.title || 'Requested item').slice(0, 500),
      quantity: Math.max(0.01, Number(line.quantity) || 1),
      unitOfMeasure: String(line.unitOfMeasure || 'each').slice(0, 50),
      unitPrice: Math.max(0, Number(line.unitPrice) || 0),
      vendorId: typeof (line as any).vendorId === 'string' ? (line as any).vendorId : undefined,
      catalogItemId: typeof (line as any).catalogItemId === 'string' ? (line as any).catalogItemId : undefined,
      glAccount: typeof line.glAccount === 'string' ? line.glAccount.slice(0, 50) : undefined,
    }));
  }

  private async markConverted(
    id: string,
    organizationId: string,
    requesterId: string,
    input: {
      workflow: WorkflowRoute;
      draftType: string;
      draftId: string | null;
      acceptedValues: Record<string, unknown>;
      status?: 'converted' | 'routed';
    },
  ) {
    await this.db
      .update(intakeConciergeSessions)
      .set({
        status: input.status ?? 'converted',
        acceptedValues: input.acceptedValues,
        convertedDraftType: input.draftType,
        convertedDraftId: input.draftId,
        updatedAt: new Date(),
      })
      .where(and(eq(intakeConciergeSessions.id, id), eq(intakeConciergeSessions.organizationId, organizationId)));

    await this.audit
      .log(organizationId, requesterId, 'intake_concierge_session', id, input.status ?? 'converted', {
        workflow: input.workflow,
        draftType: input.draftType,
        draftId: input.draftId,
      })
      .catch(() => {});
  }

  private newTranscript(sourceText: string, plan: ConciergePlan): ConciergeTranscriptEntry[] {
    return [
      { role: 'user', content: sourceText, createdAt: new Date().toISOString() },
      this.assistantTranscriptEntry(plan),
    ];
  }

  private assistantTranscriptEntry(plan: ConciergePlan): ConciergeTranscriptEntry {
    return {
      role: 'assistant',
      content: `${plan.route.label}: ${plan.route.reason}`,
      createdAt: new Date().toISOString(),
    };
  }

  private extractTerms(sourceText: string, draft: AiParsedRequisition) {
    const text = [
      sourceText,
      draft.title,
      draft.description,
      draft.suggestedVendor,
      ...(draft.lines ?? []).map((line) => `${line.description} ${line.glAccount ?? ''}`),
    ].join(' ');

    return this.extractTermsFromText(text);
  }

  private extractTermsFromText(text: string) {
    return Array.from(
      new Set(
        text
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, ' ')
          .split(/\s+/)
          .map((term) => term.trim())
          .filter((term) => term.length > 2),
      ),
    ).slice(0, 40);
  }

  private scoreText(value: string, terms: string[]) {
    const normalized = value.toLowerCase();
    return terms.reduce((score, term) => score + (normalized.includes(term) ? 1 : 0), 0);
  }

  private sameText(left?: string | null, right?: string | null) {
    if (!left || !right) return false;
    return left.trim().toLowerCase() === right.trim().toLowerCase();
  }

  private estimateAmount(draft: AiParsedRequisition) {
    return (draft.lines ?? []).reduce((sum, line) => {
      return sum + (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0);
    }, 0);
  }

  private rfqThreshold(policies: PolicyLike[]) {
    for (const policy of policies) {
      const threshold = Number(policy.rules?.rfqThreshold);
      if (Number.isFinite(threshold) && threshold > 0) return threshold;
    }
    return 10000;
  }

  private looksLikeSoftware(sourceText: string, draft: AiParsedRequisition) {
    const text = `${sourceText} ${draft.title} ${draft.description ?? ''}`.toLowerCase();
    return /\b(software|saas|subscription|license|licenses|seat|seats|renewal|cloud|app|platform)\b/.test(text);
  }

  private looksLikePolicyQuestion(message: string) {
    return /\b(policy|allowed|allow|require|required|threshold|approval|rfq|budget|preferred supplier|contract)\b/i.test(message) &&
      /\?|\b(why|what|which|do we|should|can i|can we|need to)\b/i.test(message);
  }

  private confidence(catalogCount: number, vendorCount: number, missingCount: number) {
    const matchScore = Math.min(0.35, catalogCount * 0.07 + vendorCount * 0.03);
    const missingPenalty = Math.min(0.35, missingCount * 0.06);
    return Number(Math.max(0.35, Math.min(0.95, 0.62 + matchScore - missingPenalty)).toFixed(2));
  }

  private isoDate(value?: string) {
    if (!value) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return undefined;
    return date.toISOString();
  }
}
