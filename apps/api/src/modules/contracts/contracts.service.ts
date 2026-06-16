import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db } from '@betterspend/db';
import {
  contractAmendments,
  contractClauses,
  contractExtractions,
  contractLines,
  contractObligations,
  contracts,
} from '@betterspend/db';
import { AuditService } from '../audit/audit.service';
import { DocumentsService } from '../documents/documents.service';
import { NotificationsService } from '../notifications/notifications.service';

type RiskLevel = 'low' | 'medium' | 'high';

interface ExtractedClause {
  clauseType: string;
  title: string;
  extractedText: string;
  normalizedSummary: string;
  riskLevel: RiskLevel;
  riskReason?: string;
  confidence: number;
  sourceReference: string;
}

interface ExtractedObligation {
  obligationType: string;
  title: string;
  description: string;
  dueDate?: Date;
  recurrence?: string;
  notificationLeadDays: number;
  sourceReference: string;
  sourceClauseType?: string;
}

@Injectable()
export class ContractsService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
    private readonly documentsService: DocumentsService,
  ) {}

  async findAll(organizationId: string, filters?: { status?: string; vendorId?: string; type?: string }) {
    const rows = await this.db.query.contracts.findMany({
      where: (c, { and, eq }) => {
        const conditions = [eq(c.organizationId, organizationId)];
        if (filters?.status) conditions.push(eq(c.status, filters.status));
        if (filters?.vendorId) conditions.push(eq(c.vendorId, filters.vendorId));
        if (filters?.type) conditions.push(eq(c.type, filters.type));
        return and(...conditions);
      },
      with: {
        vendor: true,
        owner: true,
      },
      orderBy: (c, { desc }) => desc(c.createdAt),
    });
    return this.withIntelligenceSummaries(rows);
  }

  async findOne(id: string, organizationId: string) {
    const contract = await this.db.query.contracts.findFirst({
      where: (c, { and, eq }) => and(eq(c.id, id), eq(c.organizationId, organizationId)),
      with: {
        vendor: true,
        owner: true,
        createdByUser: true,
        lines: { orderBy: (l, { asc }) => asc(l.lineNumber) },
        amendments: { orderBy: (a, { desc }) => desc(a.amendmentNumber) },
        extractions: { orderBy: (extraction, { desc }) => desc(extraction.createdAt) },
        clauses: { orderBy: (clause, { desc }) => desc(clause.createdAt) },
        obligations: {
          with: { owner: true },
          orderBy: (obligation, { asc }) => asc(obligation.dueDate),
        },
      },
    });
    if (!contract) throw new NotFoundException(`Contract ${id} not found`);
    return {
      ...contract,
      intelligenceSummary: this.summarizeContractIntelligence(contract),
    };
  }

  async create(data: typeof contracts.$inferInsert) {
    // Auto-generate contract number
    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(contracts)
      .where(eq(contracts.organizationId, data.organizationId));

    const year = new Date().getFullYear();
    const num = (Number(count) + 1).toString().padStart(4, '0');
    const contractNumber = `CTR-${year}-${num}`;

    const [contract] = await this.db
      .insert(contracts)
      .values({ ...data, contractNumber })
      .returning();

    this.auditService.log(data.organizationId, data.createdBy, 'contract', contract.id, 'created').catch(() => {});

    return this.findOne(contract.id, data.organizationId);
  }

  async update(id: string, organizationId: string, userId: string, data: Partial<typeof contracts.$inferInsert>) {
    const existing = await this.findOne(id, organizationId);

    const [updated] = await this.db
      .update(contracts)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(contracts.id, id), eq(contracts.organizationId, organizationId)))
      .returning();

    if (!updated) throw new NotFoundException(`Contract ${id} not found`);

    this.auditService.log(organizationId, userId, 'contract', id, 'updated').catch(() => {});

    return this.findOne(id, organizationId);
  }

  async activate(id: string, organizationId: string, userId: string) {
    const contract = await this.findOne(id, organizationId);
    if (!['draft', 'pending_approval'].includes(contract.status)) {
      throw new BadRequestException(`Cannot activate a contract in status: ${contract.status}`);
    }
    return this.update(id, organizationId, userId, {
      status: 'active',
      approvedBy: userId,
      approvedAt: new Date(),
    });
  }

  async terminate(id: string, organizationId: string, userId: string, reason: string) {
    const contract = await this.findOne(id, organizationId);
    if (!['active', 'expiring_soon'].includes(contract.status)) {
      throw new BadRequestException(`Cannot terminate a contract in status: ${contract.status}`);
    }
    return this.update(id, organizationId, userId, {
      status: 'terminated',
      terminatedBy: userId,
      terminatedAt: new Date(),
      terminationReason: reason,
    });
  }

  async addLine(contractId: string, organizationId: string, data: typeof contractLines.$inferInsert) {
    await this.findOne(contractId, organizationId); // verify ownership
    const [line] = await this.db.insert(contractLines).values({ ...data, contractId }).returning();
    return line;
  }

  async addAmendment(contractId: string, organizationId: string, userId: string, data: { title: string; description?: string | null; effectiveDate?: Date | null; valueChange?: string | null; newEndDate?: Date | null }) {
    await this.findOne(contractId, organizationId);

    // get next amendment number
    const [{ maxNum }] = await this.db
      .select({ maxNum: sql<number>`coalesce(max(amendment_number), 0)` })
      .from(contractAmendments)
      .where(eq(contractAmendments.contractId, contractId));

    const [amendment] = await this.db
      .insert(contractAmendments)
      .values({ ...data, contractId, createdBy: userId, amendmentNumber: Number(maxNum) + 1 })
      .returning();

    // If there's a value change, update contract total
    if (data.valueChange) {
      const contract = await this.findOne(contractId, organizationId);
      const currentValue = parseFloat(contract.totalValue ?? '0');
      const delta = parseFloat(String(data.valueChange));
      await this.db
        .update(contracts)
        .set({ totalValue: (currentValue + delta).toFixed(2), updatedAt: new Date() })
        .where(eq(contracts.id, contractId));
    }

    // If new end date, update contract
    if (data.newEndDate) {
      await this.db
        .update(contracts)
        .set({ endDate: new Date(data.newEndDate as unknown as string), updatedAt: new Date() })
        .where(eq(contracts.id, contractId));
    }

    return amendment;
  }

  async getExpiringContracts(organizationId: string, daysAhead = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + daysAhead);
    const now = new Date();

    return this.db.query.contracts.findMany({
      where: (c, { and, eq, lte, gt }) =>
        and(
          eq(c.organizationId, organizationId),
          eq(c.status, 'active'),
          lte(c.endDate, cutoff),
          gt(c.endDate, now),
        ),
      with: { vendor: true },
      orderBy: (c, { asc }) => asc(c.endDate),
    });
  }

  async syncExpiringStatus(organizationId: string) {
    const now = new Date();
    const cutoff30 = new Date();
    cutoff30.setDate(cutoff30.getDate() + 30);

    // Mark expired
    await this.db
      .update(contracts)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(
        and(
          eq(contracts.organizationId, organizationId),
          eq(contracts.status, 'active'),
          sql`${contracts.endDate} < ${now}`,
        ),
      );

    // Mark expiring_soon (within 30 days)
    await this.db
      .update(contracts)
      .set({ status: 'expiring_soon', updatedAt: new Date() })
      .where(
        and(
          eq(contracts.organizationId, organizationId),
          eq(contracts.status, 'active'),
          sql`${contracts.endDate} >= ${now}`,
          sql`${contracts.endDate} <= ${cutoff30}`,
        ),
      );
  }

  async processIntelligence(
    contractId: string,
    organizationId: string,
    userId: string,
    input: { documentId?: string; documentText?: string; sourceName?: string },
  ) {
    const contract = await this.findOne(contractId, organizationId);
    let sourceName = input.sourceName?.trim() || 'Contract terms';
    let sourceType = 'terms';

    if (input.documentId) {
      const document = await this.db.query.documents.findFirst({
        where: (doc, { and, eq }) =>
          and(
            eq(doc.id, input.documentId!),
            eq(doc.organizationId, organizationId),
            eq(doc.entityType, 'contract'),
            eq(doc.entityId, contractId),
          ),
      });
      if (!document) throw new NotFoundException(`Document ${input.documentId} not found for this contract`);
      sourceName = document.filename;
      sourceType = 'document';
    }

    const uploadedText = input.documentId && !input.documentText
      ? await this.documentsService.getTextContent(organizationId, input.documentId)
      : null;
    const extractedText = (input.documentText?.trim() || uploadedText || contract.terms || contract.internalNotes || contract.description || '').trim();
    if (!extractedText) {
      throw new BadRequestException('Provide documentText or add contract terms before running extraction');
    }

    const extracted = this.extractContractIntelligence(extractedText, contract);
    const [extraction] = await this.db
      .insert(contractExtractions)
      .values({
        organizationId,
        contractId,
        documentId: input.documentId,
        sourceType,
        sourceName,
        extractedText,
        extractedFields: extracted.fields,
        confidence: extracted.confidence.toFixed(4),
        status: 'pending_review',
        createdBy: userId,
      })
      .returning();

    const clauses = extracted.clauses.length
      ? await this.db
          .insert(contractClauses)
          .values(
            extracted.clauses.map((clause) => ({
              organizationId,
              contractId,
              extractionId: extraction.id,
              clauseType: clause.clauseType,
              title: clause.title,
              extractedText: clause.extractedText,
              normalizedSummary: clause.normalizedSummary,
              riskLevel: clause.riskLevel,
              riskReason: clause.riskReason,
              confidence: clause.confidence.toFixed(4),
              sourceReference: clause.sourceReference,
              status: 'pending_review',
            })),
          )
          .returning()
      : [];

    const clauseByType = new Map(clauses.map((clause) => [clause.clauseType, clause.id]));
    const obligations = extracted.obligations.length
      ? await this.db
          .insert(contractObligations)
          .values(
            extracted.obligations.map((obligation) => ({
              organizationId,
              contractId,
              clauseId: obligation.sourceClauseType ? clauseByType.get(obligation.sourceClauseType) : undefined,
              ownerId: contract.ownerId ?? contract.createdBy,
              obligationType: obligation.obligationType,
              title: obligation.title,
              description: obligation.description,
              dueDate: obligation.dueDate,
              recurrence: obligation.recurrence,
              notificationLeadDays: obligation.notificationLeadDays,
              sourceReference: obligation.sourceReference,
              status: 'open',
            })),
          )
          .returning()
      : [];

    await this.createObligationNotifications(organizationId, contract, obligations);
    await this.auditService
      .log(organizationId, userId, 'contract', contractId, 'intelligence_extracted', {
        extractionId: extraction.id,
        clauseCount: clauses.length,
        obligationCount: obligations.length,
        riskScore: extracted.riskScore,
      })
      .catch(() => {});

    return this.findOne(contractId, organizationId);
  }

  async reviewExtraction(
    contractId: string,
    organizationId: string,
    userId: string,
    extractionId: string,
    input: { decision: 'approved' | 'rejected'; fields?: Record<string, unknown> },
  ) {
    await this.findOne(contractId, organizationId);
    const extraction = await this.db.query.contractExtractions.findFirst({
      where: (record, { and, eq }) =>
        and(eq(record.id, extractionId), eq(record.contractId, contractId), eq(record.organizationId, organizationId)),
    });
    if (!extraction) throw new NotFoundException(`Contract extraction ${extractionId} not found`);

    const reviewedAt = new Date();
    await this.db
      .update(contractExtractions)
      .set({
        status: input.decision,
        reviewedBy: userId,
        reviewedAt,
        updatedAt: reviewedAt,
        extractedFields: { ...(extraction.extractedFields ?? {}), ...(input.fields ?? {}) },
      })
      .where(eq(contractExtractions.id, extractionId));

    await this.db
      .update(contractClauses)
      .set({ status: input.decision, reviewedBy: userId, reviewedAt, updatedAt: reviewedAt })
      .where(and(eq(contractClauses.extractionId, extractionId), eq(contractClauses.organizationId, organizationId)));

    if (input.decision === 'approved') {
      const fields = { ...(extraction.extractedFields ?? {}), ...(input.fields ?? {}) };
      const authoritative = this.authoritativeContractUpdates(fields);
      if (Object.keys(authoritative).length > 0) {
        await this.db
          .update(contracts)
          .set({ ...authoritative, updatedAt: new Date() })
          .where(and(eq(contracts.id, contractId), eq(contracts.organizationId, organizationId)));
      }
    }

    await this.auditService
      .log(organizationId, userId, 'contract', contractId, 'intelligence_reviewed', {
        extractionId,
        decision: input.decision,
      })
      .catch(() => {});

    return this.findOne(contractId, organizationId);
  }

  async updateClause(
    contractId: string,
    organizationId: string,
    userId: string,
    clauseId: string,
    input: {
      status?: string;
      riskLevel?: RiskLevel;
      riskReason?: string;
      normalizedSummary?: string;
      extractedText?: string;
    },
  ) {
    await this.findOne(contractId, organizationId);
    const [updated] = await this.db
      .update(contractClauses)
      .set({
        status: input.status,
        riskLevel: input.riskLevel,
        riskReason: input.riskReason,
        normalizedSummary: input.normalizedSummary,
        extractedText: input.extractedText,
        reviewedBy: userId,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(contractClauses.id, clauseId), eq(contractClauses.contractId, contractId), eq(contractClauses.organizationId, organizationId)))
      .returning();

    if (!updated) throw new NotFoundException(`Contract clause ${clauseId} not found`);
    await this.auditService
      .log(organizationId, userId, 'contract_clause', clauseId, 'updated', {
        contractId,
        riskLevel: updated.riskLevel,
        status: updated.status,
      })
      .catch(() => {});
    return this.findOne(contractId, organizationId);
  }

  async updateObligation(
    contractId: string,
    organizationId: string,
    userId: string,
    obligationId: string,
    input: {
      status?: string;
      ownerId?: string | null;
      dueDate?: string | null;
      title?: string;
      description?: string;
      notificationLeadDays?: number;
    },
  ) {
    await this.findOne(contractId, organizationId);
    const [updated] = await this.db
      .update(contractObligations)
      .set({
        status: input.status,
        ownerId: input.ownerId === null ? null : input.ownerId,
        dueDate: input.dueDate ? new Date(input.dueDate) : input.dueDate === null ? null : undefined,
        title: input.title,
        description: input.description,
        notificationLeadDays: input.notificationLeadDays,
        updatedAt: new Date(),
      })
      .where(and(eq(contractObligations.id, obligationId), eq(contractObligations.contractId, contractId), eq(contractObligations.organizationId, organizationId)))
      .returning();

    if (!updated) throw new NotFoundException(`Contract obligation ${obligationId} not found`);
    await this.auditService
      .log(organizationId, userId, 'contract_obligation', obligationId, 'updated', {
        contractId,
        status: updated.status,
      })
      .catch(() => {});
    return this.findOne(contractId, organizationId);
  }

  private async withIntelligenceSummaries(rows: any[]) {
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return rows;

    const [clauses, obligations, extractions] = await Promise.all([
      this.db.query.contractClauses.findMany({
        where: (clause, { inArray }) => inArray(clause.contractId, ids),
      }),
      this.db.query.contractObligations.findMany({
        where: (obligation, { inArray }) => inArray(obligation.contractId, ids),
      }),
      this.db.query.contractExtractions.findMany({
        where: (extraction, { inArray }) => inArray(extraction.contractId, ids),
      }),
    ]);

    return rows.map((contract) => ({
      ...contract,
      intelligenceSummary: this.summarizeContractIntelligence({
        ...contract,
        clauses: clauses.filter((clause) => clause.contractId === contract.id),
        obligations: obligations.filter((obligation) => obligation.contractId === contract.id),
        extractions: extractions.filter((extraction) => extraction.contractId === contract.id),
      }),
    }));
  }

  private summarizeContractIntelligence(contract: any) {
    const clauses = contract.clauses ?? [];
    const obligations = contract.obligations ?? [];
    const extractions = contract.extractions ?? [];
    const openObligations = obligations.filter((obligation: any) => obligation.status === 'open');
    const highRisk = clauses.filter((clause: any) => clause.riskLevel === 'high' && clause.status !== 'rejected');
    const mediumRisk = clauses.filter((clause: any) => clause.riskLevel === 'medium' && clause.status !== 'rejected');

    return {
      extractionCount: extractions.length,
      pendingReviewCount: extractions.filter((extraction: any) => extraction.status === 'pending_review').length,
      clauseCount: clauses.length,
      highRiskCount: highRisk.length,
      mediumRiskCount: mediumRisk.length,
      openObligationCount: openObligations.length,
      nextObligationDueAt: openObligations
        .filter((obligation: any) => obligation.dueDate)
        .sort((a: any, b: any) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0]?.dueDate ?? null,
      riskLevel: highRisk.length > 0 ? 'high' : mediumRisk.length > 0 ? 'medium' : clauses.length > 0 ? 'low' : 'none',
    };
  }

  private extractContractIntelligence(text: string, contract: any) {
    const fields = this.extractFields(text);
    const clauses = this.extractClauses(text, contract, fields);
    const obligations = this.extractObligations(text, contract, fields, clauses);
    const riskScore = clauses.reduce((score, clause) => score + (clause.riskLevel === 'high' ? 3 : clause.riskLevel === 'medium' ? 1 : 0), 0);
    const confidence = clauses.length > 0 ? Math.min(0.95, 0.55 + clauses.length * 0.05) : 0.4;
    return { fields, clauses, obligations, riskScore, confidence };
  }

  private extractFields(text: string) {
    const paymentTermsMatch = text.match(/\b(?:payment terms?|invoice terms?)[:\s-]*(net\s*\d+|\d+\s*days?)/i) ?? text.match(/\bnet\s*(\d{1,3})\b/i);
    const noticeMatch = text.match(/\b(\d{1,3})\s+days?\s+(?:prior\s+)?(?:written\s+)?notice\b/i);
    const governingLawMatch = text.match(/\bgoverned by (?:the )?laws? of ([A-Za-z ,]+?)(?:\.|,|;|\n|$)/i);
    const liabilityCapMatch = text.match(/\bliability[^.]{0,120}?(?:cap|limited to|shall not exceed)\s+([^.;\n]+)/i);
    const priceEscalationMatch = text.match(/\b(?:price|fee)[^.]{0,80}?(?:increase|escalation|uplift)[^.]{0,80}?(\d{1,2}(?:\.\d+)?)\s*%/i);

    return {
      paymentTerms: paymentTermsMatch
        ? paymentTermsMatch[1]?.toLowerCase().startsWith('net')
          ? paymentTermsMatch[1].replace(/\s+/g, ' ').toUpperCase()
          : `Net ${paymentTermsMatch[1]}`
        : undefined,
      renewalNoticeDays: noticeMatch ? Number(noticeMatch[1]) : undefined,
      autoRenew: /\bauto(?:matically)?[-\s]?renew|\brenew(?:s|al)\s+automatically\b/i.test(text),
      governingLaw: governingLawMatch?.[1]?.trim(),
      liabilityCap: liabilityCapMatch?.[1]?.trim(),
      priceEscalationPercent: priceEscalationMatch ? Number(priceEscalationMatch[1]) : undefined,
    };
  }

  private extractClauses(text: string, contract: any, fields: Record<string, any>): ExtractedClause[] {
    const clauses: ExtractedClause[] = [];
    const autoRenewal = this.findSection(text, /auto(?:matically)?[-\s]?renew|renew(?:s|al)\s+automatically|renewal/i);
    if (autoRenewal) {
      const noticeDays = Number(fields.renewalNoticeDays ?? contract.renewalNoticeDays ?? 0);
      clauses.push({
        clauseType: 'auto_renewal',
        title: 'Auto-renewal',
        extractedText: autoRenewal,
        normalizedSummary: noticeDays ? `Auto-renewal detected with ${noticeDays} days notice.` : 'Auto-renewal detected; notice period needs review.',
        riskLevel: noticeDays > 0 && noticeDays < 60 ? 'high' : 'medium',
        riskReason: noticeDays > 0 && noticeDays < 60 ? 'Notice window is shorter than 60 days.' : 'Auto-renewal should be reviewed for notice obligations.',
        confidence: 0.82,
        sourceReference: 'terms:auto_renewal',
      });
    }

    const liability = this.findSection(text, /liabilit|indemnif|damages/i);
    if (liability) {
      const uncapped = /\buncapped|unlimited|without limitation\b/i.test(liability);
      clauses.push({
        clauseType: 'liability',
        title: 'Liability and indemnity',
        extractedText: liability,
        normalizedSummary: fields.liabilityCap ? `Liability cap appears to be ${fields.liabilityCap}.` : 'Liability clause found without a clear cap.',
        riskLevel: uncapped || !fields.liabilityCap ? 'high' : 'medium',
        riskReason: uncapped ? 'Clause appears to allow uncapped or unlimited liability.' : !fields.liabilityCap ? 'No clear liability cap was extracted.' : 'Liability cap should be confirmed.',
        confidence: 0.78,
        sourceReference: 'terms:liability',
      });
    }

    const priceEscalation = this.findSection(text, /price|fee|escalat|uplift|increase/i);
    if (priceEscalation && /\b(escalat|uplift|increase)\b/i.test(priceEscalation)) {
      clauses.push({
        clauseType: 'price_escalation',
        title: 'Price escalation',
        extractedText: priceEscalation,
        normalizedSummary: fields.priceEscalationPercent ? `Price escalation up to ${fields.priceEscalationPercent}% detected.` : 'Price increase rights detected.',
        riskLevel: Number(fields.priceEscalationPercent ?? 0) > 5 ? 'high' : 'medium',
        riskReason: Number(fields.priceEscalationPercent ?? 0) > 5 ? 'Escalation exceeds 5%.' : 'Price increase rights should be reviewed before renewal or PO issuance.',
        confidence: 0.73,
        sourceReference: 'terms:price_escalation',
      });
    }

    const termination = this.findSection(text, /termination|terminate|convenience/i);
    if (termination) {
      const hasConvenience = /\bfor convenience\b/i.test(termination);
      clauses.push({
        clauseType: 'termination',
        title: 'Termination rights',
        extractedText: termination,
        normalizedSummary: hasConvenience ? 'Termination for convenience language detected.' : 'Termination language found without clear convenience rights.',
        riskLevel: hasConvenience ? 'low' : 'medium',
        riskReason: hasConvenience ? undefined : 'Missing or unclear termination-for-convenience language.',
        confidence: 0.76,
        sourceReference: 'terms:termination',
      });
    }

    const security = this.findSection(text, /data security|privacy|gdpr|soc\s*2|security|confidential/i);
    if (security) {
      clauses.push({
        clauseType: 'data_security',
        title: 'Data security and privacy',
        extractedText: security,
        normalizedSummary: 'Data security, privacy, or confidentiality terms detected.',
        riskLevel: 'low',
        confidence: 0.7,
        sourceReference: 'terms:data_security',
      });
    } else if (contract.type === 'software' || /software|saas|subscription/i.test(`${contract.title} ${contract.description ?? ''}`)) {
      clauses.push({
        clauseType: 'data_security',
        title: 'Data security and privacy',
        extractedText: 'No data security or privacy language was detected in the provided text.',
        normalizedSummary: 'Software contract may be missing data/security terms.',
        riskLevel: 'high',
        riskReason: 'Software and SaaS contracts should include data/security terms.',
        confidence: 0.62,
        sourceReference: 'terms:data_security_missing',
      });
    }

    const payment = this.findSection(text, /payment terms?|invoice|net\s*\d+/i);
    if (payment) {
      const netDays = this.netDays(fields.paymentTerms);
      clauses.push({
        clauseType: 'payment_terms',
        title: 'Payment terms',
        extractedText: payment,
        normalizedSummary: fields.paymentTerms ? `Payment terms extracted as ${fields.paymentTerms}.` : 'Payment terms detected.',
        riskLevel: netDays && netDays > 60 ? 'medium' : 'low',
        riskReason: netDays && netDays > 60 ? 'Payment term is longer than Net 60.' : undefined,
        confidence: 0.74,
        sourceReference: 'terms:payment_terms',
      });
    }

    const auditRights = this.findSection(text, /audit rights?|inspect records|records inspection/i);
    if (auditRights) {
      clauses.push({
        clauseType: 'audit_rights',
        title: 'Audit rights',
        extractedText: auditRights,
        normalizedSummary: 'Audit or records-inspection rights detected.',
        riskLevel: 'low',
        confidence: 0.69,
        sourceReference: 'terms:audit_rights',
      });
    }

    return clauses;
  }

  private extractObligations(
    text: string,
    contract: any,
    fields: Record<string, any>,
    clauses: ExtractedClause[],
  ): ExtractedObligation[] {
    const obligations: ExtractedObligation[] = [];
    const noticeDays = Number(fields.renewalNoticeDays ?? contract.renewalNoticeDays ?? 0);
    const endDate = contract.endDate ? new Date(contract.endDate) : null;

    if ((fields.autoRenew || contract.autoRenew) && endDate && noticeDays > 0) {
      const dueDate = new Date(endDate);
      dueDate.setDate(dueDate.getDate() - noticeDays);
      obligations.push({
        obligationType: 'renewal_notice',
        title: 'Renewal notice deadline',
        description: `Review renewal decision before the ${noticeDays}-day notice deadline.`,
        dueDate,
        recurrence: contract.autoRenew ? 'annual' : undefined,
        notificationLeadDays: Math.min(60, Math.max(14, noticeDays)),
        sourceReference: 'terms:auto_renewal',
        sourceClauseType: 'auto_renewal',
      });
    }

    if (/\binsurance certificate|certificate of insurance|coi\b/i.test(text)) {
      obligations.push({
        obligationType: 'insurance_certificate',
        title: 'Insurance certificate review',
        description: 'Confirm current certificate of insurance is on file.',
        dueDate: endDate ?? undefined,
        recurrence: 'annual',
        notificationLeadDays: 30,
        sourceReference: 'terms:insurance',
      });
    }

    if (clauses.some((clause) => clause.clauseType === 'data_security')) {
      obligations.push({
        obligationType: 'security_review',
        title: 'Security terms review',
        description: 'Review data security/privacy terms before renewal or material expansion.',
        dueDate: endDate ?? undefined,
        recurrence: 'annual',
        notificationLeadDays: 45,
        sourceReference: 'terms:data_security',
        sourceClauseType: 'data_security',
      });
    }

    return obligations;
  }

  private findSection(text: string, pattern: RegExp) {
    const parts = text
      .replace(/\r/g, '\n')
      .split(/\n{2,}|(?<=\.)\s+(?=[A-Z])/)
      .map((part) => part.trim())
      .filter(Boolean);
    const section = parts.find((part) => pattern.test(part));
    return section?.slice(0, 2000);
  }

  private netDays(paymentTerms?: string) {
    const match = paymentTerms?.match(/(\d{1,3})/);
    return match ? Number(match[1]) : null;
  }

  private authoritativeContractUpdates(fields: Record<string, unknown>) {
    const updates: Partial<typeof contracts.$inferInsert> = {};
    if (typeof fields.paymentTerms === 'string' && fields.paymentTerms.trim()) {
      updates.paymentTerms = fields.paymentTerms.trim();
    }
    if (typeof fields.autoRenew === 'boolean') {
      updates.autoRenew = fields.autoRenew;
    }
    if (Number.isFinite(Number(fields.renewalNoticeDays))) {
      updates.renewalNoticeDays = Number(fields.renewalNoticeDays);
    }
    return updates;
  }

  private async createObligationNotifications(organizationId: string, contract: any, obligations: Array<typeof contractObligations.$inferSelect>) {
    for (const obligation of obligations) {
      const ownerId = obligation.ownerId ?? contract.ownerId ?? contract.createdBy;
      if (!ownerId || !obligation.dueDate) continue;
      const leadDate = new Date(obligation.dueDate);
      leadDate.setDate(leadDate.getDate() - obligation.notificationLeadDays);
      if (leadDate > new Date()) continue;
      await this.notificationsService
        .create(
          organizationId,
          ownerId,
          'contract_obligation',
          `Contract obligation due: ${obligation.title}`,
          `${contract.title}: ${obligation.description ?? obligation.title}`,
          'contract',
          contract.id,
        )
        .catch(() => {});
    }
  }
}
