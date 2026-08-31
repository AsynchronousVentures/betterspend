import assert from 'node:assert/strict';
import test from 'node:test';
import { invoices, ocrJobs } from '@betterspend/db';
import type { Queue } from 'bullmq';
import type { InvoiceReviewsService } from '../invoice-reviews/invoice-reviews.service';
import type { InvoiceReviewProvenanceService } from '../invoice-reviews/invoice-review-provenance.service';
import type { AiRuntimeService } from '../ai-providers/ai-runtime.service';
import { OcrService } from './ocr.service';

const organizationId = '00000000-0000-4000-8000-000000000001';
const invoiceId = '00000000-0000-4000-8000-000000000002';
const jobId = '00000000-0000-4000-8000-000000000003';

function updateDb() {
  return {
    update: () => ({
      set: () => ({
        where: async () => undefined,
      }),
    }),
  };
}

test('OCR keeps the normalized review signal when provenance persistence fails', async () => {
  const observations: unknown[] = [];
  const jobs = [
    {
      id: jobId,
      organizationId,
      invoiceId,
      status: 'pending',
      extractedData: null,
      confidence: null,
    },
    {
      id: jobId,
      organizationId,
      invoiceId,
      status: 'processing',
      extractedData: null,
      confidence: null,
    },
  ];
  const db = {
    ...updateDb(),
    query: { ocrJobs: { findFirst: async () => jobs.shift() ?? null } },
  };
  const provenance = {
    recordOcrProvenance: async () => {
      throw new Error('provenance unavailable');
    },
  } as unknown as InvoiceReviewProvenanceService;
  const reviews = {
    recordOcrReviewSignal: async (input: unknown) => {
      observations.push(input);
    },
  } as unknown as InvoiceReviewsService;
  const service = new OcrService(
    db as never,
    {} as Queue,
    {} as AiRuntimeService,
    reviews,
    provenance,
  );

  await service.runExtractionById(jobId);

  assert.equal(observations.length, 1);
  assert.equal((observations[0] as { status: string }).status, 'done');
});

test('OCR publishes provenance at the completed extraction boundary', async () => {
  const provenanceInputs: unknown[] = [];
  const observations: unknown[] = [];
  const jobs = [
    {
      id: jobId,
      organizationId,
      invoiceId,
      status: 'pending',
      extractedData: null,
      confidence: null,
    },
    {
      id: jobId,
      organizationId,
      invoiceId,
      status: 'processing',
      extractedData: null,
      confidence: null,
    },
  ];
  const db = {
    ...updateDb(),
    query: { ocrJobs: { findFirst: async () => jobs.shift() ?? null } },
  };
  const provenance = {
    recordOcrProvenance: async (input: unknown) => {
      provenanceInputs.push(input);
    },
  } as unknown as InvoiceReviewProvenanceService;
  const reviews = {
    recordOcrReviewSignal: async (input: unknown) => {
      observations.push(input);
    },
  } as unknown as InvoiceReviewsService;
  const service = new OcrService(
    db as never,
    {} as Queue,
    {} as AiRuntimeService,
    reviews,
    provenance,
  );

  await service.runExtractionById(jobId);

  assert.equal(provenanceInputs.length, 1);
  assert.equal((provenanceInputs[0] as { sourceRecordId: string }).sourceRecordId, jobId);
  assert.equal((provenanceInputs[0] as { invoiceId: string }).invoiceId, invoiceId);
  assert.equal(observations.length, 1);
});

test('OCR stores extraction completion separately from mutable link timestamps', async () => {
  const updates: Record<string, unknown>[] = [];
  const jobs = [
    {
      id: jobId,
      organizationId,
      invoiceId: null,
      status: 'pending',
      extractedData: null,
      confidence: null,
    },
    {
      id: jobId,
      organizationId,
      invoiceId,
      status: 'processing',
      extractedData: null,
      confidence: null,
    },
  ];
  const db = {
    query: { ocrJobs: { findFirst: async () => jobs.shift() ?? null } },
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        return { where: async () => undefined };
      },
    }),
  };
  const provenance = {
    recordOcrProvenance: async () => undefined,
  } as unknown as InvoiceReviewProvenanceService;
  const reviews = {
    recordOcrReviewSignal: async () => undefined,
  } as unknown as InvoiceReviewsService;
  const service = new OcrService(
    db as never,
    {} as Queue,
    {} as AiRuntimeService,
    reviews,
    provenance,
  );

  await service.runExtractionById(jobId);

  const completionUpdate = updates.find((values) => values.status === 'done');
  assert.ok(completionUpdate);
  assert.ok(completionUpdate.extractionCompletedAt instanceof Date);
  assert.equal(completionUpdate.extractionCompletedAt, completionUpdate.updatedAt);
});

test('OCR links completed extraction observations when linking races completion', async () => {
  const observations: unknown[] = [];
  const jobs = [
    {
      id: jobId,
      organizationId,
      invoiceId: null,
      status: 'pending',
      extractedData: null,
      confidence: null,
    },
    {
      id: jobId,
      organizationId,
      invoiceId: null,
      status: 'processing',
      extractedData: null,
      confidence: null,
    },
    {
      id: jobId,
      organizationId,
      invoiceId,
      status: 'done',
      extractedData: null,
      confidence: null,
    },
  ];
  const db = {
    ...updateDb(),
    query: { ocrJobs: { findFirst: async () => jobs.shift() ?? null } },
  };
  const reviews = {
    recordOcrReviewSignal: async (input: unknown) => {
      observations.push(input);
    },
  } as unknown as InvoiceReviewsService;
  const provenance = {
    recordOcrProvenance: async () => undefined,
  } as unknown as InvoiceReviewProvenanceService;
  const service = new OcrService(
    db as never,
    {} as Queue,
    {} as AiRuntimeService,
    reviews,
    provenance,
  );

  await service.runExtractionById(jobId);

  assert.equal(observations.length, 1);
  assert.equal((observations[0] as { invoiceId: string }).invoiceId, invoiceId);
});

test('OCR keeps extraction completion time as provenance timestamp when linked later', async () => {
  const extractionCompletedAt = new Date('2026-08-30T10:00:00Z');
  const provenanceInputs: unknown[] = [];
  const currentJob = {
    id: jobId,
    organizationId,
    invoiceId: null,
    status: 'done',
    extractedData: { totalAmount: 100 },
    confidence: { overall: 0.9 },
    extractionCompletedAt,
    updatedAt: new Date('2026-08-31T10:00:00Z'),
  };
  const transaction = {
    select: () => {
      let table: unknown;
      const query = {
        from: (nextTable: unknown) => {
          table = nextTable;
          return query;
        },
        where: () => query,
        for: async () => (table === ocrJobs ? [currentJob] : []),
        limit: async () => (table === invoices ? [{ id: invoiceId }] : []),
      };
      return query;
    },
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => [
            {
              ...currentJob,
              invoiceId,
              updatedAt: new Date('2026-08-31T10:00:00Z'),
            },
          ],
        }),
      }),
    }),
  };
  const db = {
    transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
  };
  const provenance = {
    recordOcrProvenance: async (input: unknown) => {
      provenanceInputs.push(input);
    },
  } as unknown as InvoiceReviewProvenanceService;
  const reviews = {
    recordOcrReviewSignal: async () => undefined,
  } as unknown as InvoiceReviewsService;
  const service = new OcrService(
    db as never,
    {} as Queue,
    {} as AiRuntimeService,
    reviews,
    provenance,
  );

  await service.linkToInvoice(jobId, invoiceId, organizationId);

  assert.equal(provenanceInputs.length, 1);
  assert.deepEqual(
    (provenanceInputs[0] as { sourceTimestamp: Date }).sourceTimestamp,
    extractionCompletedAt,
  );
});

test('OCR refuses to relink a job to another invoice', async () => {
  const otherInvoiceId = '00000000-0000-4000-8000-000000000004';
  let updateCalled = false;
  const currentJob = {
    id: jobId,
    organizationId,
    invoiceId,
    status: 'done',
    extractedData: null,
    confidence: null,
    extractionCompletedAt: new Date('2026-08-30T10:00:00Z'),
    updatedAt: new Date('2026-08-30T10:00:00Z'),
  };
  const transaction = {
    select: () => {
      let table: unknown;
      const query = {
        from: (nextTable: unknown) => {
          table = nextTable;
          return query;
        },
        where: () => query,
        for: async () => (table === ocrJobs ? [currentJob] : []),
        limit: async () => (table === invoices ? [{ id: otherInvoiceId }] : []),
      };
      return query;
    },
    update: () => {
      updateCalled = true;
      return {
        set: () => ({
          where: () => ({ returning: async () => [] }),
        }),
      };
    },
  };
  const db = {
    transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
  };
  const provenance = {
    recordOcrProvenance: async () => undefined,
  } as unknown as InvoiceReviewProvenanceService;
  const reviews = {
    recordOcrReviewSignal: async () => undefined,
  } as unknown as InvoiceReviewsService;
  const service = new OcrService(
    db as never,
    {} as Queue,
    {} as AiRuntimeService,
    reviews,
    provenance,
  );

  await assert.rejects(
    service.linkToInvoice(jobId, otherInvoiceId, organizationId),
    /already linked to invoice/,
  );
  assert.equal(updateCalled, false);
});
