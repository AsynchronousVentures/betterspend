import type {
  InvoiceReviewSignalSeverity,
  InvoiceReviewSignalStatus,
  InvoiceReviewSignalType,
  RecordInvoiceReviewSignalInput,
} from '@betterspend/shared';

type PersistableSignalStatus = Exclude<InvoiceReviewSignalStatus, 'waived'>;

export interface InvoiceReviewContext {
  organizationId: string;
  invoiceId: string;
}

export interface InvoiceReviewSourceContext extends InvoiceReviewContext {
  sourceRecordId: string;
}

export interface OcrReviewSignalInput extends InvoiceReviewSourceContext {
  status: 'pending' | 'processing' | 'done' | 'failed';
  confidence?: Partial<{
    vendorName: number;
    invoiceNumber: number;
    invoiceDate: number;
    dueDate: number;
    totalAmount: number;
    lines: number;
    overall: number;
  }> | null;
  provider?: string | null;
  reviewRequired?: boolean;
  severity?: InvoiceReviewSignalSeverity;
  signalStatus?: PersistableSignalStatus;
  observedAt?: Date;
}

export interface SpendGuardReviewSignalInput extends InvoiceReviewSourceContext {
  alertType: string;
  severity: 'low' | 'medium' | 'high';
  status: 'open' | 'dismissed' | 'escalated';
  observedAt?: Date;
}

export interface MatchReviewSignalInput extends InvoiceReviewContext {
  matchStatus: string;
  exceptionCount?: number;
  observedAt?: Date;
}

const MAX_PROVIDER_LENGTH = 100;

function score(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : undefined;
}

export function normalizeOcrReviewSignal(
  input: OcrReviewSignalInput,
): RecordInvoiceReviewSignalInput {
  const confidence = input.confidence ?? {};
  const overall = score(confidence.overall);
  const lowConfidence = input.status !== 'done' || input.reviewRequired === true;
  const severity: InvoiceReviewSignalSeverity =
    input.severity ??
    (input.status === 'failed' ? 'blocking' : lowConfidence ? 'review_required' : 'informational');
  const details: Record<string, unknown> = {
    extractionStatus: input.status,
    ...(overall !== undefined ? { overallConfidence: overall } : {}),
    confidence: Object.fromEntries(
      Object.entries(confidence)
        .map(([field, value]) => [field, score(value)])
        .filter((entry): entry is [string, number] => entry[1] !== undefined),
    ),
    ...(input.provider
      ? { provider: input.provider.replaceAll('\0', '').trim().slice(0, MAX_PROVIDER_LENGTH) }
      : {}),
  };

  return {
    organizationId: input.organizationId,
    invoiceId: input.invoiceId,
    signalType: 'low_extraction_confidence',
    sourceModule: 'ocr',
    sourceRecordId: input.sourceRecordId,
    severity,
    status: input.signalStatus ?? (input.status === 'done' && !lowConfidence ? 'resolved' : 'open'),
    summary:
      input.status === 'failed'
        ? 'OCR extraction failed and needs review.'
        : lowConfidence
          ? 'OCR extraction confidence is below the review baseline.'
          : 'OCR extraction completed.',
    details,
    ...(input.observedAt ? { observedAt: input.observedAt } : {}),
  };
}

export function normalizeSpendGuardReviewSignal(
  input: SpendGuardReviewSignalInput,
): RecordInvoiceReviewSignalInput {
  const signalType: InvoiceReviewSignalType = input.alertType.includes('duplicate')
    ? 'duplicate_risk'
    : input.alertType.includes('sender')
      ? 'sender_risk'
      : input.alertType.includes('bank')
        ? 'bank_detail_change_risk'
        : 'manual_review';
  const severity: InvoiceReviewSignalSeverity =
    input.severity === 'high'
      ? 'blocking'
      : input.severity === 'medium'
        ? 'review_required'
        : 'informational';
  return {
    organizationId: input.organizationId,
    invoiceId: input.invoiceId,
    signalType,
    sourceModule: 'spend_guard',
    sourceRecordId: input.sourceRecordId,
    severity,
    status: input.status === 'dismissed' ? 'resolved' : 'open',
    summary: 'Spend guard evaluated an invoice risk condition.',
    details: {
      alertType: input.alertType.slice(0, 50),
      alertSeverity: input.severity,
      alertStatus: input.status,
    },
    ...(input.observedAt ? { observedAt: input.observedAt } : {}),
  };
}

export function normalizeMatchReviewSignal(
  input: MatchReviewSignalInput,
): RecordInvoiceReviewSignalInput {
  const exceptionCount =
    input.exceptionCount !== undefined && Number.isFinite(input.exceptionCount)
      ? Math.max(0, Math.round(input.exceptionCount))
      : undefined;
  const hasException = input.matchStatus === 'exception' || (exceptionCount ?? 0) > 0;
  return {
    organizationId: input.organizationId,
    invoiceId: input.invoiceId,
    signalType: 'match_exception',
    sourceModule: 'matching',
    sourceRecordId: input.invoiceId,
    severity: 'blocking',
    status: hasException ? 'open' : 'resolved',
    summary: hasException ? 'Invoice has an active match exception.' : 'Invoice match completed.',
    details: {
      matchStatus: input.matchStatus.slice(0, 30),
      ...(exceptionCount !== undefined ? { exceptionCount } : {}),
    },
    ...(input.observedAt ? { observedAt: input.observedAt } : {}),
  };
}
