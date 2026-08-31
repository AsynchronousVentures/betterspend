import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  invoiceFieldProvenance,
  invoiceLines,
  invoices,
  type Db,
  type DbTransaction,
  users,
} from '@betterspend/db';
import {
  INVOICE_REVIEW_PROVENANCE_HEADER_FIELDS,
  INVOICE_REVIEW_PROVENANCE_LINE_FIELDS,
  recordInvoiceReviewProvenanceSchema,
  invoiceReviewProvenanceSourceTypeSchema,
  type InvoiceReviewProvenanceSourceType,
  type RecordInvoiceReviewProvenanceInput,
} from '@betterspend/shared';
import { DB_TOKEN } from '../../database/database.module';

export type ProvenanceSourceAvailability = 'present' | 'missing' | 'unknown';

export interface InvoiceReviewProvenanceView {
  id: string;
  invoiceLineId: string | null;
  fieldPath: string;
  sourceType: InvoiceReviewProvenanceSourceType;
  sourceRecordId: string;
  source: {
    type: InvoiceReviewProvenanceSourceType;
    recordId: string;
    availability: ProvenanceSourceAvailability;
  };
  sourceTimestamp: Date | null;
  confidence: number | null;
  actorId: string | null;
  isCurrent: boolean;
  supersededAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type InvoiceFieldProvenanceRow = typeof invoiceFieldProvenance.$inferSelect;

const PROVENANCE_SOURCE_PRECEDENCE: Record<InvoiceReviewProvenanceSourceType, number> = {
  manual: 100,
  supplier: 80,
  import: 70,
  OCR: 60,
  email_intake: 50,
  PO: 40,
  catalog: 40,
};

function parseProvenanceSourceType(value: string): InvoiceReviewProvenanceSourceType {
  const parsed = invoiceReviewProvenanceSourceTypeSchema.safeParse(value);
  if (!parsed.success) throw new Error(`Unsupported invoice provenance source type ${value}`);
  return parsed.data;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function lineFieldPath(lineId: string, field: string): string {
  return `lines.${lineId}.${field}`;
}

function isHeaderField(
  field: string,
): field is (typeof INVOICE_REVIEW_PROVENANCE_HEADER_FIELDS)[number] {
  return (INVOICE_REVIEW_PROVENANCE_HEADER_FIELDS as readonly string[]).includes(field);
}

function isLineField(
  field: string,
): field is (typeof INVOICE_REVIEW_PROVENANCE_LINE_FIELDS)[number] {
  return (INVOICE_REVIEW_PROVENANCE_LINE_FIELDS as readonly string[]).includes(field);
}

function provenanceIdentityKey(
  input: Pick<
    RecordInvoiceReviewProvenanceInput,
    'organizationId' | 'invoiceId' | 'invoiceLineId' | 'fieldPath' | 'sourceType' | 'sourceRecordId'
  >,
): string {
  return createHash('sha256')
    .update(
      [
        input.organizationId,
        input.invoiceId,
        input.invoiceLineId ?? '',
        input.fieldPath,
        input.sourceType,
        input.sourceRecordId,
      ].join('\u0000'),
    )
    .digest('hex');
}

function observationTimestamp(sourceTimestamp: Date | null, observedAt: Date): Date {
  return sourceTimestamp ?? observedAt;
}

function shouldBeCurrent(
  incoming: Pick<
    z.output<typeof recordInvoiceReviewProvenanceSchema>,
    'sourceType' | 'sourceTimestamp' | 'observedAt'
  >,
  current: InvoiceFieldProvenanceRow | undefined,
): boolean {
  if (!current) return true;
  const incomingRank = PROVENANCE_SOURCE_PRECEDENCE[incoming.sourceType];
  const currentRank = PROVENANCE_SOURCE_PRECEDENCE[parseProvenanceSourceType(current.sourceType)];
  if (incomingRank !== currentRank) return incomingRank > currentRank;
  return (
    observationTimestamp(incoming.sourceTimestamp, incoming.observedAt ?? new Date()).getTime() >=
    observationTimestamp(current.sourceTimestamp, current.updatedAt).getTime()
  );
}

@Injectable()
export class InvoiceReviewProvenanceService {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  /**
   * Append or refresh a field observation. The unique source identity makes
   * producer retries idempotent, while each distinct manual correction keeps
   * its own history row.
   */
  async recordProvenance(rawInput: RecordInvoiceReviewProvenanceInput, executor?: DbTransaction) {
    const [row] = await this.recordProvenanceBatch([rawInput], executor);
    return row;
  }

  async recordProvenanceBatch(
    rawInputs: readonly RecordInvoiceReviewProvenanceInput[],
    executor?: DbTransaction,
  ) {
    const inputs = rawInputs.map((rawInput) => recordInvoiceReviewProvenanceSchema.parse(rawInput));
    if (inputs.length === 0) return [];

    const organizationId = inputs[0]?.organizationId;
    const invoiceId = inputs[0]?.invoiceId;
    if (
      inputs.some(
        (input) => input.organizationId !== organizationId || input.invoiceId !== invoiceId,
      )
    ) {
      throw new BadRequestException('A provenance batch must belong to one invoice');
    }

    const persist = async (tx: DbTransaction) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${organizationId}:${invoiceId}`}, 0))`,
      );
      const rows: InvoiceFieldProvenanceRow[] = [];
      for (const input of inputs) {
        rows.push(await this.recordProvenanceInTransaction(tx, input));
      }
      return rows;
    };
    return executor ? persist(executor) : this.db.transaction(persist);
  }

  async recordManualCorrectionProvenance(input: {
    organizationId: string;
    invoiceId: string;
    actorId: string;
    fieldPaths: readonly string[];
    correctionId?: string;
    observedAt?: Date;
    executor?: DbTransaction;
  }) {
    const observedAt = input.observedAt ?? new Date();
    const correctionId = input.correctionId ?? randomUUID();
    return this.recordProvenanceBatch(
      input.fieldPaths.map((fieldPath) => ({
        organizationId: input.organizationId,
        invoiceId: input.invoiceId,
        invoiceLineId: this.invoiceLineIdFromPath(fieldPath),
        fieldPath,
        sourceType: 'manual' as const,
        sourceRecordId: `manual:${correctionId}:${fieldPath}`,
        sourceTimestamp: observedAt,
        actorId: input.actorId,
        observedAt,
      })),
      input.executor,
    );
  }

  async recordOcrProvenance(input: {
    organizationId: string;
    invoiceId: string;
    sourceRecordId: string;
    extractedData?: unknown;
    confidence?: unknown;
    sourceTimestamp?: Date | null;
    observedAt?: Date;
    invoiceLineIds?: readonly string[];
    executor?: DbTransaction;
  }) {
    const extracted = asRecord(input.extractedData);
    const confidence = asRecord(input.confidence);
    const fieldMappings = [
      ['vendorName', 'vendor'],
      ['invoiceNumber', 'invoiceNumber'],
      ['invoiceDate', 'invoiceDate'],
      ['dueDate', 'dueDate'],
      ['currency', 'currency'],
      ['subtotal', 'subtotal'],
      ['taxAmount', 'taxAmount'],
      ['totalAmount', 'totalAmount'],
    ] as const;
    const headerInputs = fieldMappings.flatMap(([sourceField, fieldPath]) =>
      extracted[sourceField] === null ||
      extracted[sourceField] === undefined ||
      extracted[sourceField] === ''
        ? []
        : [
            {
              organizationId: input.organizationId,
              invoiceId: input.invoiceId,
              fieldPath,
              sourceType: 'OCR' as const,
              sourceRecordId: input.sourceRecordId,
              sourceTimestamp: input.sourceTimestamp ?? null,
              confidence:
                typeof confidence[sourceField] === 'number' &&
                Number.isFinite(confidence[sourceField])
                  ? confidence[sourceField]
                  : null,
              observedAt: input.observedAt,
            },
          ],
    );

    const extractedLines = Array.isArray(extracted.lines) ? extracted.lines : [];
    const lineInputs = extractedLines.flatMap((rawLine, index) => {
      const line = asRecord(rawLine);
      const lineId = input.invoiceLineIds?.[index];
      if (!lineId) return [];
      return (['description', 'quantity', 'unitPrice', 'glAccount'] as const).flatMap(
        (fieldPath) =>
          line[fieldPath] === null || line[fieldPath] === undefined || line[fieldPath] === ''
            ? []
            : [
                {
                  organizationId: input.organizationId,
                  invoiceId: input.invoiceId,
                  invoiceLineId: lineId,
                  fieldPath: lineFieldPath(lineId, fieldPath),
                  sourceType: 'OCR' as const,
                  sourceRecordId: input.sourceRecordId,
                  sourceTimestamp: input.sourceTimestamp ?? null,
                  confidence:
                    typeof confidence.lines === 'number' && Number.isFinite(confidence.lines)
                      ? confidence.lines
                      : null,
                  observedAt: input.observedAt,
                },
              ],
      );
    });

    return this.recordProvenanceBatch([...headerInputs, ...lineInputs], input.executor);
  }

  toView(
    provenance: InvoiceFieldProvenanceRow,
    availability: ProvenanceSourceAvailability,
  ): InvoiceReviewProvenanceView {
    const sourceType = parseProvenanceSourceType(provenance.sourceType);
    return {
      id: provenance.id,
      invoiceLineId: provenance.invoiceLineId,
      fieldPath: provenance.fieldPath,
      sourceType,
      sourceRecordId: provenance.sourceRecordId,
      source: { type: sourceType, recordId: provenance.sourceRecordId, availability },
      sourceTimestamp: provenance.sourceTimestamp,
      confidence: provenance.confidence === null ? null : Number(provenance.confidence),
      actorId: provenance.actorId,
      isCurrent: provenance.isCurrent,
      supersededAt: provenance.supersededAt,
      createdAt: provenance.createdAt,
      updatedAt: provenance.updatedAt,
    };
  }

  private invoiceLineIdFromPath(fieldPath: string): string | null {
    const match = /^lines\.([^.]+)\.([^.]+)$/.exec(fieldPath);
    if (!match) {
      if (fieldPath.startsWith('lines.')) {
        throw new BadRequestException(`Unsupported invoice provenance field path ${fieldPath}`);
      }
      return null;
    }
    if (!match[1] || !z.string().uuid().safeParse(match[1]).success || !isLineField(match[2])) {
      throw new BadRequestException(`Unsupported invoice provenance field path ${fieldPath}`);
    }
    return match[1].toLowerCase();
  }

  private async recordProvenanceInTransaction(
    tx: DbTransaction,
    parsedInput: z.output<typeof recordInvoiceReviewProvenanceSchema>,
  ): Promise<InvoiceFieldProvenanceRow> {
    const observedAt = parsedInput.observedAt ?? new Date();
    if (!isHeaderField(parsedInput.fieldPath) && !parsedInput.fieldPath.startsWith('lines.')) {
      throw new BadRequestException(`Unsupported invoice provenance field path ${parsedInput.fieldPath}`);
    }
    const pathLineId = this.invoiceLineIdFromPath(parsedInput.fieldPath);
    if (pathLineId !== null && parsedInput.invoiceLineId?.toLowerCase() !== pathLineId) {
      throw new BadRequestException('Invoice provenance line path does not match invoiceLineId');
    }
    if (pathLineId === null && parsedInput.invoiceLineId !== null) {
      throw new BadRequestException('Header provenance cannot include invoiceLineId');
    }
    const input =
      pathLineId === null
        ? parsedInput
        : {
            ...parsedInput,
            invoiceLineId: pathLineId,
            fieldPath: lineFieldPath(
              pathLineId,
              parsedInput.fieldPath.slice(parsedInput.fieldPath.lastIndexOf('.') + 1),
            ),
          };

    const [invoice] = await tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(
        and(eq(invoices.id, input.invoiceId), eq(invoices.organizationId, input.organizationId)),
      )
      .limit(1);
    if (!invoice) throw new NotFoundException(`Invoice ${input.invoiceId} not found`);

    if (input.invoiceLineId !== null) {
      const [line] = await tx
        .select({ id: invoiceLines.id })
        .from(invoiceLines)
        .where(
          and(
            eq(invoiceLines.id, input.invoiceLineId),
            eq(invoiceLines.invoiceId, input.invoiceId),
          ),
        )
        .limit(1);
      if (!line) throw new NotFoundException(`Invoice line ${input.invoiceLineId} not found`);
    }
    if (input.actorId !== null) {
      const [actor] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, input.actorId), eq(users.organizationId, input.organizationId)))
        .limit(1);
      if (!actor) throw new NotFoundException(`Actor ${input.actorId} not found`);
    }

    const identityKey = provenanceIdentityKey(input);
    const [existing] = await tx
      .select()
      .from(invoiceFieldProvenance)
      .where(
        and(
          eq(invoiceFieldProvenance.organizationId, input.organizationId),
          eq(invoiceFieldProvenance.identityKey, identityKey),
        ),
      )
      .for('update');
    const linePredicate =
      input.invoiceLineId === null
        ? isNull(invoiceFieldProvenance.invoiceLineId)
        : eq(invoiceFieldProvenance.invoiceLineId, input.invoiceLineId);
    const currentRows = await tx
      .select()
      .from(invoiceFieldProvenance)
      .where(
        and(
          eq(invoiceFieldProvenance.organizationId, input.organizationId),
          eq(invoiceFieldProvenance.invoiceId, input.invoiceId),
          linePredicate,
          eq(invoiceFieldProvenance.fieldPath, input.fieldPath),
          eq(invoiceFieldProvenance.isCurrent, true),
        ),
      )
      .for('update');
    const current = currentRows.find((row) => row.identityKey !== identityKey);
    const incomingTimestamp = observationTimestamp(input.sourceTimestamp, observedAt);
    if (
      existing &&
      incomingTimestamp.getTime() <
        observationTimestamp(existing.sourceTimestamp, existing.updatedAt).getTime()
    ) {
      return existing;
    }
    const isCurrent = existing?.isCurrent === true || shouldBeCurrent(input, current);

    if (isCurrent) {
      await tx
        .update(invoiceFieldProvenance)
        .set({ isCurrent: false, supersededAt: observedAt, updatedAt: observedAt })
        .where(
          and(
            eq(invoiceFieldProvenance.organizationId, input.organizationId),
            eq(invoiceFieldProvenance.invoiceId, input.invoiceId),
            linePredicate,
            eq(invoiceFieldProvenance.fieldPath, input.fieldPath),
            eq(invoiceFieldProvenance.isCurrent, true),
            ne(invoiceFieldProvenance.identityKey, identityKey),
          ),
        );
    }

    const values = {
      organizationId: input.organizationId,
      invoiceId: input.invoiceId,
      invoiceLineId: input.invoiceLineId,
      fieldPath: input.fieldPath,
      sourceType: input.sourceType,
      sourceRecordId: input.sourceRecordId,
      sourceTimestamp: input.sourceTimestamp,
      confidence: input.confidence === null ? null : String(input.confidence),
      actorId: input.actorId,
      isCurrent,
      supersededAt: isCurrent ? null : (existing?.supersededAt ?? observedAt),
      identityKey,
      updatedAt: observedAt,
    };
    if (existing) {
      const [updated] = await tx
        .update(invoiceFieldProvenance)
        .set(values)
        .where(
          and(
            eq(invoiceFieldProvenance.id, existing.id),
            eq(invoiceFieldProvenance.organizationId, input.organizationId),
          ),
        )
        .returning();
      return updated ?? { ...existing, ...values };
    }

    const [created] = await tx
      .insert(invoiceFieldProvenance)
      .values({ ...values, createdAt: observedAt })
      .returning();
    if (!created) throw new Error('Invoice provenance could not be written');
    return created;
  }
}
