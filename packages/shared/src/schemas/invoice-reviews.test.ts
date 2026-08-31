import assert from 'node:assert/strict';
import test from 'node:test';

import { invoiceReviewCommandSchema, recordInvoiceReviewProvenanceSchema } from './invoice-reviews';

const organizationId = '00000000-0000-4000-8000-000000000001';
const invoiceId = '00000000-0000-4000-8000-000000000002';
const invoiceLineId = '00000000-0000-4000-8000-000000000003';

function provenanceInput(fieldPath: string, lineId?: string | null) {
  return {
    organizationId,
    invoiceId,
    invoiceLineId: lineId,
    fieldPath,
    sourceType: 'manual' as const,
    sourceRecordId: 'manual-correction-1',
  };
}

test('invoice provenance field paths match their explicit line identity', () => {
  assert.equal(
    recordInvoiceReviewProvenanceSchema.safeParse(provenanceInput('totalAmount')).success,
    true,
  );
  assert.equal(
    recordInvoiceReviewProvenanceSchema.safeParse(
      provenanceInput(`lines.${invoiceLineId}.description`, invoiceLineId),
    ).success,
    true,
  );
  assert.equal(
    recordInvoiceReviewProvenanceSchema.safeParse(
      provenanceInput(`lines.${invoiceLineId}.description`),
    ).success,
    false,
  );
  assert.equal(
    recordInvoiceReviewProvenanceSchema.safeParse(
      provenanceInput('lines.not-a-uuid.description', invoiceLineId),
    ).success,
    false,
  );
  assert.equal(
    recordInvoiceReviewProvenanceSchema.safeParse(
      provenanceInput('lines.00000000-0000-4000-8000-000000000004.description', invoiceLineId),
    ).success,
    false,
  );
  assert.equal(
    recordInvoiceReviewProvenanceSchema.safeParse(provenanceInput('lines.', null)).success,
    false,
  );
});

test('invoice review commands require an aggregate version and action-specific reasons', () => {
  const expectedVersion = 4;
  assert.equal(
    invoiceReviewCommandSchema.safeParse({ action: 'claim', expectedVersion }).success,
    true,
  );
  assert.equal(
    invoiceReviewCommandSchema.safeParse({ action: 'reassign', expectedVersion }).success,
    false,
  );
  assert.equal(
    invoiceReviewCommandSchema.safeParse({
      action: 'waive_signal',
      expectedVersion,
      signalId: '00000000-0000-4000-8000-000000000001',
      reason: '   ',
    }).success,
    false,
  );
  assert.equal(
    invoiceReviewCommandSchema.safeParse({ action: 'claim', expectedVersion, ignored: true })
      .success,
    false,
  );
});
