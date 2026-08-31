import assert from 'node:assert/strict';
import test from 'node:test';
import { InvoiceReviewProvenanceService } from './invoice-review-provenance.service';
import type { InvoiceFieldProvenanceRow } from './invoice-review-provenance.service';
import { invoiceFieldProvenance, invoiceLines, invoices, users, type Db } from '@betterspend/db';

const organizationOne = '00000000-0000-4000-8000-000000000001';
const organizationTwo = '00000000-0000-4000-8000-000000000002';
const invoiceId = '00000000-0000-4000-8000-000000000010';
const lineId = '00000000-0000-4000-8000-000000000011';
const actorId = '00000000-0000-4000-8000-000000000012';

function queryParameters(condition: unknown): unknown[] {
  if (!condition || typeof condition !== 'object') return [];
  const object = condition as { queryChunks?: unknown[]; value?: unknown };
  if (object.queryChunks && Array.isArray(object.queryChunks)) {
    return object.queryChunks.flatMap((chunk) => queryParameters(chunk));
  }
  if (object.constructor?.name === 'Param') return [object.value];
  return [];
}

function createDb() {
  const rows: InvoiceFieldProvenanceRow[] = [];
  let nextId = 20;
  const invoiceRows = [
    { id: invoiceId, organizationId: organizationOne },
    { id: invoiceId, organizationId: organizationTwo },
  ];
  const lineRows = [{ id: lineId, invoiceId }];
  const actorRows = [{ id: actorId, organizationId: organizationOne }];

  const updateRows = (table: unknown, values: Record<string, unknown>, condition: unknown) => {
    if (table !== invoiceFieldProvenance) return [];
    const parameters = queryParameters(condition).filter(
      (parameter): parameter is string => typeof parameter === 'string',
    );
    const fieldPath = parameters.find(
      (parameter) =>
        parameter.startsWith('lines.') ||
        [
          'vendor',
          'invoiceNumber',
          'invoiceDate',
          'dueDate',
          'currency',
          'exchangeRate',
          'subtotal',
          'taxAmount',
          'totalAmount',
        ].includes(parameter),
    );
    const identityKey = parameters.find((parameter) => parameter.length === 64);
    const rowId = parameters.find((parameter) => rows.some((row) => row.id === parameter));
    if (values.isCurrent === false) {
      for (const row of rows.filter(
        (candidate) =>
          (!fieldPath || candidate.fieldPath === fieldPath) &&
          (!identityKey || candidate.identityKey !== identityKey) &&
          candidate.isCurrent,
      )) {
        row.isCurrent = false;
        row.supersededAt = values.supersededAt as Date;
        row.updatedAt = values.updatedAt as Date;
      }
      return [];
    }
    const matchingRows = rows.filter(
      (row) =>
        (!rowId || row.id === rowId) &&
        (!fieldPath || row.fieldPath === fieldPath) &&
        (!identityKey || row.identityKey === identityKey),
    );
    const row = matchingRows[0];
    if (!row) return [];
    Object.assign(row, values);
    return [row];
  };

  const selectRows = (table: unknown, condition: unknown) => {
    const parameters = queryParameters(condition);
    if (table === invoices) {
      return invoiceRows.filter(
        (row) => parameters.includes(row.id) && parameters.includes(row.organizationId),
      );
    }
    if (table === invoiceLines) {
      return lineRows.filter(
        (row) => parameters.includes(row.id) && parameters.includes(row.invoiceId),
      );
    }
    if (table === users) {
      return actorRows.filter(
        (row) => parameters.includes(row.id) && parameters.includes(row.organizationId),
      );
    }
    if (table === invoiceFieldProvenance) {
      const stringParameters = parameters.filter(
        (parameter): parameter is string => typeof parameter === 'string',
      );
      const identityKey = stringParameters.find((parameter) => parameter.length === 64);
      if (identityKey) {
        return rows.filter(
          (row) => row.organizationId === stringParameters[0] && row.identityKey === identityKey,
        );
      }
      const organizationId = stringParameters[0];
      const invoiceIdParameter = stringParameters[1];
      const fieldPath = stringParameters.find(
        (parameter) =>
          parameter.startsWith('lines.') ||
          [
            'vendor',
            'invoiceNumber',
            'invoiceDate',
            'dueDate',
            'currency',
            'exchangeRate',
            'subtotal',
            'taxAmount',
            'totalAmount',
          ].includes(parameter),
      );
      const lineIdParameter = stringParameters.find((parameter) => parameter === lineId);
      return rows.filter(
        (row) =>
          row.organizationId === organizationId &&
          row.invoiceId === invoiceIdParameter &&
          row.fieldPath === fieldPath &&
          (lineIdParameter ? row.invoiceLineId === lineIdParameter : row.invoiceLineId === null) &&
          row.isCurrent === true,
      );
    }
    return [];
  };

  const transaction = {
    execute: async () => [],
    select: () => {
      let table: unknown;
      let condition: unknown;
      const query = {
        from: (nextTable: unknown) => {
          table = nextTable;
          return query;
        },
        where: (nextCondition: unknown) => {
          condition = nextCondition;
          return query;
        },
        limit: async () => selectRows(table, condition),
        for: async () => selectRows(table, condition),
      };
      return query;
    },
    update: (table: unknown) => {
      let values: Record<string, unknown> = {};
      let condition: unknown;
      const query = {
        set: (nextValues: Record<string, unknown>) => {
          values = nextValues;
          return query;
        },
        where: (nextCondition: unknown) => {
          condition = nextCondition;
          const result = {
            returning: async () => updateRows(table, values, condition),
            then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
              Promise.resolve(updateRows(table, values, condition)).then(resolve, reject),
          };
          return result;
        },
      };
      return query;
    },
    insert: (table: unknown) => {
      let values: Record<string, unknown> = {};
      const query = {
        values: (nextValues: Record<string, unknown>) => {
          values = nextValues;
          return query;
        },
        returning: async () => {
          const row = {
            id: `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`,
            ...values,
          } as InvoiceFieldProvenanceRow;
          if (table === invoiceFieldProvenance) rows.push(row);
          return [row];
        },
      };
      return query;
    },
  };
  const db = {
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(transaction),
  };
  return { db: db as unknown as Db, rows };
}

test('provenance applies source precedence and keeps retries idempotent', async () => {
  const { db, rows } = createDb();
  const service = new InvoiceReviewProvenanceService(db);
  const ocrObservedAt = new Date('2026-08-01T00:00:00Z');
  const manualObservedAt = new Date('2026-08-02T00:00:00Z');

  const ocr = await service.recordProvenance({
    organizationId: organizationOne,
    invoiceId,
    fieldPath: 'totalAmount',
    sourceType: 'OCR',
    sourceRecordId: 'ocr-job-1',
    sourceTimestamp: new Date('2026-08-01T00:00:00Z'),
    observedAt: ocrObservedAt,
  });
  const manual = await service.recordProvenance({
    organizationId: organizationOne,
    invoiceId,
    fieldPath: 'totalAmount',
    sourceType: 'manual',
    sourceRecordId: 'manual-correction-1',
    sourceTimestamp: new Date('2025-01-01T00:00:00Z'),
    observedAt: manualObservedAt,
  });
  const retry = await service.recordProvenance({
    organizationId: organizationOne,
    invoiceId,
    fieldPath: 'totalAmount',
    sourceType: 'manual',
    sourceRecordId: 'manual-correction-1',
    sourceTimestamp: new Date('2025-01-01T00:00:00Z'),
    observedAt: new Date('2026-08-03T00:00:00Z'),
  });

  assert.equal(ocr.isCurrent, false);
  assert.deepEqual(ocr.supersededAt, manualObservedAt);
  assert.equal(manual.isCurrent, true);
  assert.equal(retry.id, manual.id);
  assert.equal(rows.length, 2);
});

test('provenance appends distinct manual corrections and isolates organizations', async () => {
  const { db, rows } = createDb();
  const service = new InvoiceReviewProvenanceService(db);
  const first = await service.recordManualCorrectionProvenance({
    organizationId: organizationOne,
    invoiceId,
    actorId,
    fieldPaths: [`lines.${lineId}.description`],
    observedAt: new Date('2026-08-01T00:00:00Z'),
  });
  const second = await service.recordManualCorrectionProvenance({
    organizationId: organizationOne,
    invoiceId,
    actorId,
    fieldPaths: [`lines.${lineId}.description`],
    observedAt: new Date('2026-08-02T00:00:00Z'),
  });
  const otherOrganization = await service.recordProvenance({
    organizationId: organizationTwo,
    invoiceId,
    fieldPath: 'totalAmount',
    sourceType: 'manual',
    sourceRecordId: 'manual-correction-1',
    observedAt: new Date('2026-08-02T00:00:00Z'),
  });

  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.notEqual(first[0]?.id, second[0]?.id);
  assert.equal(first[0]?.isCurrent, false);
  assert.equal(second[0]?.isCurrent, true);
  assert.equal(otherOrganization.organizationId, organizationTwo);
  assert.equal(rows.length, 3);
});

test('provenance view rejects an unsupported persisted source type', () => {
  const { db } = createDb();
  const service = new InvoiceReviewProvenanceService(db);

  assert.throws(
    () =>
      service.toView(
        {
          id: '00000000-0000-0000-0000-000000000020',
          organizationId: organizationOne,
          invoiceId,
          invoiceLineId: null,
          fieldPath: 'totalAmount',
          sourceType: 'unsupported_source',
          sourceRecordId: 'source-1',
          sourceTimestamp: null,
          confidence: null,
          actorId: null,
          isCurrent: true,
          supersededAt: null,
          identityKey: 'identity-1',
          createdAt: new Date('2026-08-01T00:00:00Z'),
          updatedAt: new Date('2026-08-01T00:00:00Z'),
        },
        'missing',
      ),
    /Unsupported invoice provenance source type/,
  );
});
