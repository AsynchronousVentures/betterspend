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

function updateDb(claimedJob: Record<string, unknown>) {
  return {
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => (values.status === 'processing' ? [claimedJob] : []),
        }),
      }),
    }),
  };
}

function extractionStateDb(initialJob: Record<string, unknown>) {
  let currentJob = { ...initialJob };
  let claims = 0;
  let completions = 0;
  const db = {
    query: {
      ocrJobs: {
        findFirst: async () => ({ ...currentJob }),
      },
    },
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          if (values.status !== 'processing') {
            currentJob = { ...currentJob, ...values };
            if (values.status === 'done') completions += 1;
          }
          return {
            returning: async () => {
              if (
                values.status !== 'processing' ||
                (currentJob.status !== 'pending' && currentJob.status !== 'failed')
              ) {
                return [];
              }
              currentJob = { ...currentJob, ...values };
              claims += 1;
              return [{ ...currentJob }];
            },
          };
        },
      }),
    }),
  };
  return {
    db,
    job: () => ({ ...currentJob }),
    claimCount: () => claims,
    completionCount: () => completions,
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
    ...updateDb(jobs[1]!),
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
    ...updateDb(jobs[1]!),
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
  const claimedJob = jobs[1]!;
  const db = {
    query: { ocrJobs: { findFirst: async () => jobs.shift() ?? null } },
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        return {
          where: () => ({
            returning: async () => (values.status === 'processing' ? [claimedJob] : []),
          }),
        };
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

test('OCR keeps a completed job done when post-completion observation fails', async () => {
  const updates: Record<string, unknown>[] = [];
  let lookups = 0;
  const currentJob = {
    id: jobId,
    organizationId,
    invoiceId,
    status: 'processing',
    extractedData: null,
    confidence: null,
  };
  const db = {
    query: {
      ocrJobs: {
        findFirst: async () => {
          lookups += 1;
          if (lookups === 1) return { ...currentJob, status: 'pending' };
          if (lookups === 2) throw new Error('post-completion lookup unavailable');
          return currentJob;
        },
      },
    },
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        return {
          where: () => ({
            returning: async () =>
              values.status === 'processing' ? [{ ...currentJob }] : [],
          }),
        };
      },
    }),
  };
  const service = new OcrService(
    db as never,
    {} as Queue,
    {} as AiRuntimeService,
    { recordOcrReviewSignal: async () => undefined } as never,
    { recordOcrProvenance: async () => undefined } as never,
  );

  await service.runExtractionById(jobId);

  assert.ok(updates.some((values) => values.status === 'done'));
  assert.ok(!updates.some((values) => values.status === 'failed'));
});

test('OCR stale workers do not overwrite a completed extraction', async () => {
  const extractionCompletedAt = new Date('2026-08-30T10:00:00Z');
  const extractedData = {
    vendorName: 'Acme',
    invoiceNumber: 'INV-42',
    totalAmount: 125,
    lines: [],
  };
  const confidence = { overall: 0.97 };
  const state = extractionStateDb({
    id: jobId,
    organizationId,
    invoiceId,
    status: 'done',
    extractedData,
    confidence,
    extractionCompletedAt,
    updatedAt: extractionCompletedAt,
  });
  const provenanceInputs: unknown[] = [];
  const reviewInputs: unknown[] = [];
  const service = new OcrService(
    state.db as never,
    {} as Queue,
    {} as AiRuntimeService,
    {
      recordOcrReviewSignal: async (input: unknown) => {
        reviewInputs.push(input);
      },
    } as never,
    {
      recordOcrProvenance: async (input: unknown) => {
        provenanceInputs.push(input);
      },
    } as never,
  );

  await service.runExtractionById(jobId);

  assert.equal(state.job().status, 'done');
  assert.deepEqual(state.job().extractedData, extractedData);
  assert.deepEqual(state.job().confidence, confidence);
  assert.equal(state.job().extractionCompletedAt, extractionCompletedAt);
  assert.equal(state.job().updatedAt, extractionCompletedAt);
  assert.equal(provenanceInputs.length, 0);
  assert.equal(reviewInputs.length, 0);
});

test('OCR concurrent workers allow only one extraction claim', async () => {
  const state = extractionStateDb({
    id: jobId,
    organizationId,
    invoiceId: null,
    status: 'pending',
    extractedData: { _rawBase64: 'raw-invoice', _contentType: 'image/png' },
    confidence: null,
  });
  let aiCalls = 0;
  const aiRuntime = {
    generateVision: async () => {
      aiCalls += 1;
      return JSON.stringify({
        vendorName: 'Acme',
        invoiceNumber: 'INV-42',
        totalAmount: 125,
        lines: [],
        confidence: { overall: 0.97 },
      });
    },
  } as unknown as AiRuntimeService;
  const service = new OcrService(
    state.db as never,
    {} as Queue,
    aiRuntime,
    { recordOcrReviewSignal: async () => undefined } as never,
    { recordOcrProvenance: async () => undefined } as never,
  );

  await Promise.all([service.runExtractionById(jobId), service.runExtractionById(jobId)]);

  assert.equal(state.claimCount(), 1);
  assert.equal(aiCalls, 1);
  assert.equal(state.completionCount(), 1);
  assert.deepEqual(state.job().extractedData, {
    vendorName: 'Acme',
    invoiceNumber: 'INV-42',
    invoiceDate: null,
    dueDate: null,
    currency: 'USD',
    subtotal: null,
    taxAmount: null,
    totalAmount: 125,
    lines: [],
  });
});

test('OCR retries can claim a failed extraction', async () => {
  const state = extractionStateDb({
    id: jobId,
    organizationId,
    invoiceId: null,
    status: 'failed',
    extractedData: null,
    confidence: null,
    errorMessage: 'provider unavailable',
  });
  const service = new OcrService(
    state.db as never,
    {} as Queue,
    {} as AiRuntimeService,
    { recordOcrReviewSignal: async () => undefined } as never,
    { recordOcrProvenance: async () => undefined } as never,
  );

  await service.runExtractionById(jobId);

  assert.equal(state.claimCount(), 1);
  assert.equal(state.completionCount(), 1);
  assert.equal(state.job().status, 'done');
});

test('OCR links completed extraction observations when linking races completion', async () => {
  const observations: unknown[] = [];
  const claimedJob = {
    id: jobId,
    organizationId,
    invoiceId: null,
    status: 'processing',
    extractedData: null,
    confidence: null,
  };
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
      status: 'done',
      extractedData: null,
      confidence: null,
    },
  ];
  const db = {
    ...updateDb(claimedJob),
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
