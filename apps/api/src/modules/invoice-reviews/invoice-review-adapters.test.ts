import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeMatchReviewSignal,
  normalizeOcrReviewSignal,
  normalizeSpendGuardReviewSignal,
} from './invoice-review-adapters';

const organizationId = '00000000-0000-4000-8000-000000000001';
const invoiceId = '00000000-0000-4000-8000-000000000002';

test('OCR adapter preserves producer status and keeps extracted values out of details', () => {
  const completed = normalizeOcrReviewSignal({
    organizationId,
    invoiceId,
    sourceRecordId: '00000000-0000-4000-8000-000000000003',
    status: 'done',
    confidence: { overall: 0.2, totalAmount: 0.3 },
    provider: 'vision-provider',
  });
  assert.equal(completed.signalType, 'low_extraction_confidence');
  assert.equal(completed.severity, 'informational');
  assert.equal(completed.status, 'resolved');
  assert.deepEqual(completed.details, {
    extractionStatus: 'done',
    overallConfidence: 0.2,
    confidence: { overall: 0.2, totalAmount: 0.3 },
    provider: 'vision-provider',
  });
  assert.equal('invoiceNumber' in completed.details, false);

  const failed = normalizeOcrReviewSignal({
    organizationId,
    invoiceId,
    sourceRecordId: '00000000-0000-4000-8000-000000000003',
    status: 'failed',
  });
  assert.equal(failed.severity, 'blocking');
  assert.equal(failed.status, 'open');

  const pending = normalizeOcrReviewSignal({
    organizationId,
    invoiceId,
    sourceRecordId: '00000000-0000-4000-8000-000000000003',
    status: 'pending',
  });
  assert.equal(pending.details?.['extractionStatus'], 'pending');
  assert.equal(pending.status, 'open');
});

test('OCR keeps a completed zero-confidence result actionable', () => {
  const signal = normalizeOcrReviewSignal({
    organizationId,
    invoiceId,
    sourceRecordId: '00000000-0000-4000-8000-000000000003',
    status: 'done',
    confidence: { overall: 0 },
  });

  assert.equal(signal.severity, 'review_required');
  assert.equal(signal.status, 'open');
});

test('spend guard adapter maps existing alert semantics without copying alert details', () => {
  const signal = normalizeSpendGuardReviewSignal({
    organizationId,
    invoiceId,
    sourceRecordId: '00000000-0000-4000-8000-000000000005',
    alertType: 'duplicate_invoice_amount',
    severity: 'high',
    status: 'open',
  });
  assert.deepEqual(signal, {
    organizationId,
    invoiceId,
    signalType: 'duplicate_risk',
    sourceModule: 'spend_guard',
    sourceRecordId: '00000000-0000-4000-8000-000000000005',
    severity: 'blocking',
    status: 'open',
    summary: 'Spend guard evaluated an invoice risk condition.',
    details: {
      alertType: 'duplicate_invoice_amount',
      alertSeverity: 'high',
      alertStatus: 'open',
    },
  });
});

test('matching adapter uses the invoice id as its stable signal identity', () => {
  const open = normalizeMatchReviewSignal({
    organizationId,
    invoiceId,
    matchStatus: 'exception',
    exceptionCount: 1,
  });
  const resolved = normalizeMatchReviewSignal({
    organizationId,
    invoiceId,
    matchStatus: 'full_match',
    exceptionCount: 0,
  });
  assert.equal(open.sourceModule, 'matching');
  assert.equal(open.sourceRecordId, invoiceId);
  assert.equal(open.status, 'open');
  assert.equal(resolved.sourceRecordId, invoiceId);
  assert.equal(resolved.status, 'resolved');
});
