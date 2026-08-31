import assert from 'node:assert/strict';
import test from 'node:test';

import { recordInvoiceReviewProvenanceSchema } from './invoice-reviews';

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
