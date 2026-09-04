import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import {
  auditIdempotencyKeys,
  auditLog,
  invoiceReviewCases,
  invoiceReviewSignals,
  invoices,
  type Db,
} from '@betterspend/db';
import * as schema from '@betterspend/db';
import type { AccessPolicy } from '../auth/access-policy';
import type { PermissionKey } from '@betterspend/shared';
import { InvoiceReviewProvenanceService } from './invoice-review-provenance.service';
import { INVOICE_REVIEW_HISTORY_LIMIT, InvoiceReviewsService } from './invoice-reviews.service';

const organizationId = '00000000-0000-4000-8000-000000000001';
const invoiceId = '00000000-0000-4000-8000-000000000002';
const entityId = '00000000-0000-4000-8000-000000000004';
const vendorId = '00000000-0000-4000-8000-000000000005';
const purchaseOrderId = '00000000-0000-4000-8000-000000000017';
const requisitionId = '00000000-0000-4000-8000-000000000018';
const requesterId = '00000000-0000-4000-8000-000000000019';

function accessFor(granted: readonly PermissionKey[]): AccessPolicy {
  const permissions = new Set(granted);
  return {
    can: (permission) => permissions.has(permission),
    scopeFor: (_resource, permission) => ({
      organizationId,
      userId: requesterId,
      unrestricted: permissions.has(permission),
      ownOnly: false,
      departmentIds: [],
      projectIds: [],
      entityIds: [],
    }),
    isGlobalBuiltInAdmin: () => false,
    toDocument: () => ({ permissions: [...permissions], scopes: {} }),
  };
}

function createReviewService(db: Db) {
  return new InvoiceReviewsService(db, new InvoiceReviewProvenanceService(db));
}

/**
 * The history query selects `created_at` twice: as a `Date` for the response and as
 * full-precision UTC text for ordering. Fixtures only declare the `Date`, so derive
 * the text the way Postgres would unless a test sets it explicitly.
 */
function withCreatedAtText(row: unknown): unknown {
  const audit = (row as { audit?: Record<string, unknown> }).audit;
  if (!audit || 'createdAtText' in audit) return row;
  const createdAt = audit.createdAt;
  if (!(createdAt instanceof Date)) return row;
  return {
    ...(row as object),
    audit: { ...audit, createdAtText: createdAt.toISOString().replace('Z', '000Z') },
  };
}

function createService(
  omitProvenanceRelation = false,
  historyRows: readonly unknown[] = [],
  emptySignals = false,
  realSelect?: (selection?: unknown) => unknown,
) {
  let historyQueryCount = 0;
  const db = {
    query: {
      invoiceReviewCases: {
        findFirst: async () => ({
          id: '00000000-0000-4000-8000-000000000003',
          organizationId,
          invoiceId,
          state: 'open',
          ownerId: null,
          version: 1,
          openedAt: new Date('2026-08-01T00:00:00Z'),
          resolvedAt: null,
          createdAt: new Date('2026-08-01T00:00:00Z'),
          updatedAt: new Date('2026-08-02T00:00:00Z'),
          owner: null,
          invoice: {
            id: invoiceId,
            internalNumber: 'INV-2026-0001',
            invoiceNumber: 'SUP-42',
            status: 'approved',
            invoiceDate: new Date('2026-07-31T00:00:00Z'),
            dueDate: new Date('2026-08-30T00:00:00Z'),
            subtotal: '100.00',
            taxAmount: '8.00',
            totalAmount: '108.00',
            currency: 'USD',
            baseCurrency: 'USD',
            baseTotalAmount: '108.00',
            entityId: '00000000-0000-4000-8000-000000000004',
            purchaseOrderId: null,
            vendorId: '00000000-0000-4000-8000-000000000005',
            matchStatus: 'exception',
            matchDetails: { reason: 'quantity variance' },
            documentId: '00000000-0000-4000-8000-000000000006',
            createdBy: requesterId,
            createdAt: new Date('2026-07-31T00:00:00Z'),
            updatedAt: new Date('2026-08-02T00:00:00Z'),
            vendor: {
              id: '00000000-0000-4000-8000-000000000005',
              organizationId,
              entityId,
              name: 'Acme Supplies',
              code: 'ACME',
              status: 'active',
            },
            entity: {
              id: '00000000-0000-4000-8000-000000000004',
              organizationId,
              name: 'Acme Holdings',
              code: 'ACME-HQ',
              currency: 'USD',
            },
            purchaseOrder: {
              id: purchaseOrderId,
              organizationId,
              issuedBy: requesterId,
              number: 'PO-2026-0001',
              status: 'issued',
              entityId,
              vendorId,
              requisition: {
                id: requisitionId,
                organizationId,
                number: 'REQ-2026-0001',
                status: 'approved',
                requesterId,
                departmentId: '00000000-0000-4000-8000-000000000020',
                projectId: null,
              },
            },
            lines: [
              {
                id: '00000000-0000-4000-8000-000000000007',
                lineNumber: '1',
                description: 'Widgets',
                quantity: '2.00',
                unitPrice: '50.00',
                taxAmount: '8.00',
                totalPrice: '108.00',
                matchResults: [
                  {
                    id: '00000000-0000-4000-8000-000000000008',
                    status: 'exception',
                    priceMatch: true,
                    quantityMatch: false,
                    priceVariance: '0',
                    quantityVariance: '1',
                    variancePct: '50',
                  },
                ],
              },
            ],
            ...(omitProvenanceRelation ? {} : { fieldProvenance: [] }),
            paymentRunInvoices: [
              {
                id: '00000000-0000-4000-8000-000000000009',
                paymentRunId: '00000000-0000-4000-8000-000000000010',
                amount: '108.00',
                currency: 'USD',
                status: 'scheduled',
                paymentReference: null,
                paymentRun: {
                  id: '00000000-0000-4000-8000-000000000010',
                  orgId: organizationId,
                  status: 'draft',
                  entityId: '00000000-0000-4000-8000-000000000004',
                  runDate: '2026-08-30',
                },
              },
            ],
          },
          signals: emptySignals
            ? []
            : [
                {
                  id: '00000000-0000-4000-8000-000000000011',
                  signalType: 'match_exception',
                  sourceModule: 'matching',
                  sourceRecordId: invoiceId,
                  severity: 'blocking',
                  status: 'open',
                  summary: 'Invoice has an active match exception.',
                  details: { reason: 'quantity variance' },
                  firstSeenAt: new Date('2026-08-01T00:00:00Z'),
                  lastSeenAt: new Date('2026-08-02T00:00:00Z'),
                  resolutionActorId: null,
                  resolutionCommand: null,
                  resolutionReason: null,
                  resolvedAt: null,
                },
                {
                  id: '00000000-0000-4000-8000-000000000012',
                  signalType: 'duplicate_risk',
                  sourceModule: 'spend_guard',
                  sourceRecordId: '00000000-0000-4000-8000-000000000013',
                  severity: 'review_required',
                  status: 'open',
                  summary: 'Invoice has an active spend-risk alert.',
                  details: {},
                  firstSeenAt: new Date('2026-08-01T00:00:00Z'),
                  lastSeenAt: new Date('2026-08-01T00:00:00Z'),
                  resolutionActorId: null,
                  resolutionCommand: null,
                  resolutionReason: null,
                  resolvedAt: null,
                },
              ],
        }),
      },
      spendGuardAlerts: { findMany: async () => [] },
      ocrJobs: { findMany: async () => [] },
      emailIntakeMessages: { findMany: async () => [] },
      emailIntakeItems: { findMany: async () => [] },
      documents: {
        findMany: async () => [
          {
            id: '00000000-0000-4000-8000-000000000006',
            filename: 'invoice.pdf',
            contentType: 'application/pdf',
            sizeBytes: 1024,
            entityType: 'invoice',
            entityId: invoiceId,
            createdAt: new Date('2026-07-31T00:00:00Z'),
          },
        ],
      },
      messages: { findMany: async () => [] },
      approvalRequests: {
        findMany: async () => [
          {
            id: '00000000-0000-4000-8000-000000000021',
            status: 'pending',
            currentStep: 1,
            currentNodeId: null,
            createdAt: new Date('2026-08-01T00:00:00Z'),
            updatedAt: new Date('2026-08-02T00:00:00Z'),
          },
        ],
      },
    },
    select:
      realSelect ??
      (() => {
        let table: unknown;
        const builder = {
          from: (selectedTable: unknown) => {
            table = selectedTable;
            return builder;
          },
          leftJoin: () => builder,
          where: () => builder,
          orderBy: () => builder,
          limit: async () => {
            if (table !== auditLog) return [];
            const rows = historyQueryCount === 0 ? historyRows : [];
            historyQueryCount += 1;
            return rows.map(withCreatedAtText);
          },
        };
        return builder;
      }),
  } as unknown as Db;

  return createReviewService(db);
}

test('projection exposes a safe, typed history for review decisions', async () => {
  const caseId = '00000000-0000-4000-8000-000000000003';
  const signalId = '00000000-0000-4000-8000-000000000011';
  const projection = await createService(false, [
    {
      audit: {
        id: '00000000-0000-4000-8000-000000000030',
        organizationId,
        userId: requesterId,
        entityType: 'invoice_review_case',
        entityId: caseId,
        action: 'invoice_review.claim',
        changes: { secretReason: 'bank account 1234' },
        metadata: { secretReason: 'bank account 1234' },
        createdAt: new Date('2026-08-03T00:00:00Z'),
      },
      actor: { id: requesterId, organizationId, name: 'AP reviewer' },
    },
    {
      audit: {
        id: '00000000-0000-4000-8000-000000000031',
        organizationId,
        userId: null,
        entityType: 'invoice_review_signal',
        entityId: signalId,
        action: 'invoice_review_signal.resolve_signal',
        changes: { reason: 'private decision reason' },
        metadata: { reason: 'private decision reason' },
        createdAt: new Date('2026-08-04T00:00:00Z'),
      },
      actor: null,
    },
    {
      audit: {
        id: '00000000-0000-4000-8000-000000000033',
        organizationId,
        userId: null,
        entityType: 'invoice_review_case',
        entityId: caseId,
        action: 'review_signal_recorded',
        signalId,
        changes: { signalId, reason: 'not returned' },
        metadata: { secret: 'not returned' },
        createdAt: new Date('2026-08-02T00:00:00Z'),
      },
      actor: null,
    },
  ]).getProjection(invoiceId, organizationId);

  assert.equal(projection.history.available, true);
  assert.deepEqual(projection.history.entries, [
    {
      id: '00000000-0000-4000-8000-000000000031',
      action: 'invoice_review_signal.resolve_signal',
      target: { type: 'signal', id: signalId },
      actor: { id: null, name: 'System' },
      timestamp: new Date('2026-08-04T00:00:00Z'),
    },
    {
      id: '00000000-0000-4000-8000-000000000030',
      action: 'invoice_review.claim',
      target: { type: 'case', id: caseId },
      actor: { id: requesterId, name: 'AP reviewer' },
      timestamp: new Date('2026-08-03T00:00:00Z'),
    },
    {
      id: '00000000-0000-4000-8000-000000000033',
      action: 'review_signal_recorded',
      target: { type: 'signal', id: signalId },
      actor: { id: null, name: 'System' },
      timestamp: new Date('2026-08-02T00:00:00Z'),
    },
  ]);
  assert.equal('changes' in (projection.history.entries[0] ?? {}), false);
  assert.equal('metadata' in (projection.history.entries[0] ?? {}), false);
});

test('history orders same-millisecond events by microsecond, not by id', async () => {
  const caseId = '00000000-0000-4000-8000-000000000003';
  // Both events land in the same millisecond, so a JS Date cannot separate them.
  // The id tie-breaker would order them the other way round, which is the bug.
  const projection = await createService(false, [
    {
      audit: {
        id: '00000000-0000-4000-8000-0000000000ff',
        organizationId,
        userId: null,
        entityType: 'invoice_review_case',
        entityId: caseId,
        action: 'invoice_review.claim',
        createdAt: new Date('2026-08-03T00:00:00.500Z'),
        createdAtText: '2026-08-03T00:00:00.500100Z',
      },
      actor: null,
    },
    {
      audit: {
        id: '00000000-0000-4000-8000-000000000001',
        organizationId,
        userId: null,
        entityType: 'invoice_review_case',
        entityId: caseId,
        action: 'invoice_review.release',
        createdAt: new Date('2026-08-03T00:00:00.500Z'),
        createdAtText: '2026-08-03T00:00:00.500900Z',
      },
      actor: null,
    },
  ]).getProjection(invoiceId, organizationId);

  assert.equal(projection.history.available, true);
  assert.deepEqual(
    projection.history.entries.map((entry) => entry.action),
    ['invoice_review.release', 'invoice_review.claim'],
  );
});

test('projection keeps case history when a case has no current signals', async () => {
  const caseId = '00000000-0000-4000-8000-000000000003';
  const projection = await createService(
    false,
    [
      {
        audit: {
          id: '00000000-0000-4000-8000-000000000032',
          organizationId,
          userId: requesterId,
          entityType: 'invoice_review_case',
          entityId: caseId,
          action: 'invoice_review.claim',
          changes: {},
          createdAt: new Date('2026-08-03T00:00:00Z'),
        },
        actor: { id: requesterId, organizationId, name: 'AP reviewer' },
      },
    ],
    true,
  ).getProjection(invoiceId, organizationId);

  assert.deepEqual(
    projection.history.entries.map((entry) => entry.id),
    ['00000000-0000-4000-8000-000000000032'],
  );
});

test('projection returns available empty history', async () => {
  const projection = await createService().getProjection(invoiceId, organizationId);

  assert.deepEqual(projection.history, { available: true, entries: [] });
});

test('projection excludes other organizations and cases and keeps a missing actor stable', async () => {
  const caseId = '00000000-0000-4000-8000-000000000003';
  const signalId = '00000000-0000-4000-8000-000000000011';
  const missingActorId = '00000000-0000-4000-8000-000000000040';
  const otherOrganizationId = '00000000-0000-4000-8000-000000000041';
  const projection = await createService(false, [
    {
      audit: {
        id: '00000000-0000-4000-8000-000000000042',
        organizationId,
        userId: missingActorId,
        entityType: 'invoice_review_signal',
        entityId: signalId,
        action: 'invoice_review_signal.waive_signal',
        changes: { reason: 'sensitive reason' },
        createdAt: new Date('2026-08-05T00:00:00Z'),
      },
      actor: { id: missingActorId, organizationId: otherOrganizationId, name: 'Other tenant' },
    },
    {
      audit: {
        id: '00000000-0000-4000-8000-000000000043',
        organizationId: otherOrganizationId,
        userId: missingActorId,
        entityType: 'invoice_review_signal',
        entityId: signalId,
        action: 'invoice_review_signal.resolve_signal',
        changes: {},
        createdAt: new Date('2026-08-06T00:00:00Z'),
      },
      actor: { id: missingActorId, organizationId: otherOrganizationId, name: 'Other tenant' },
    },
    {
      audit: {
        id: '00000000-0000-4000-8000-000000000044',
        organizationId,
        userId: requesterId,
        entityType: 'invoice_review_case',
        entityId: '00000000-0000-4000-8000-000000000045',
        action: 'invoice_review.claim',
        changes: {},
        createdAt: new Date('2026-08-07T00:00:00Z'),
      },
      actor: { id: requesterId, organizationId, name: 'Wrong case actor' },
    },
  ]).getProjection(invoiceId, organizationId);

  assert.deepEqual(projection.history.entries, [
    {
      id: '00000000-0000-4000-8000-000000000042',
      action: 'invoice_review_signal.waive_signal',
      target: { type: 'signal', id: signalId },
      actor: { id: missingActorId, name: 'Unknown user' },
      timestamp: new Date('2026-08-05T00:00:00Z'),
    },
  ]);
});

test('projection orders history by timestamp and id and applies the hard bound', async () => {
  const caseId = '00000000-0000-4000-8000-000000000003';
  const rows = Array.from({ length: INVOICE_REVIEW_HISTORY_LIMIT + 5 }, (_, index) => ({
    audit: {
      id: `00000000-0000-4000-8000-${String(1000 + index).padStart(12, '0')}`,
      organizationId,
      userId: null,
      entityType: 'invoice_review_case',
      entityId: caseId,
      action: 'invoice_review.claim',
      changes: {},
      createdAt: new Date('2026-08-08T00:00:00Z'),
    },
    actor: null,
  }));
  const projection = await createService(false, rows).getProjection(invoiceId, organizationId);

  assert.equal(projection.history.entries.length, INVOICE_REVIEW_HISTORY_LIMIT);
  assert.deepEqual(
    projection.history.entries.slice(0, 2).map((entry) => entry.id),
    ['00000000-0000-4000-8000-000000001104', '00000000-0000-4000-8000-000000001103'],
  );
  assert.equal(projection.history.entries.at(-1)?.id, '00000000-0000-4000-8000-000000001005');
});

test('projection uses the database history seam for scoped ordering, limits, and actor fallback', async () => {
  const caseId = '00000000-0000-4000-8000-000000000003';
  const signalId = '00000000-0000-4000-8000-000000000011';
  const otherOrganizationId = '00000000-0000-4000-8000-000000000041';
  const missingActorId = '00000000-0000-4000-8000-000000000040';
  const signalDecisionId = '00000000-0000-4000-8000-000000000047';
  const missingActorEventId = '00000000-0000-4000-8000-000000000046';
  const signalRecordedId = '00000000-0000-4000-8000-000000000045';
  const wrongCaseEventId = '00000000-0000-4000-8000-000000000044';
  const otherOrganizationEventId = '00000000-0000-4000-8000-000000000043';
  const unsupportedActionId = '00000000-0000-4000-8000-000000000042';
  const matchingCaseRows = Array.from({ length: INVOICE_REVIEW_HISTORY_LIMIT + 5 }, (_, index) => {
    const id = `00000000-0000-4000-8000-${String(1000 + index).padStart(12, '0')}`;
    const userId = index === INVOICE_REVIEW_HISTORY_LIMIT + 4 ? requesterId : null;
    return `('${id}', '${organizationId}', ${userId ? `'${userId}'` : 'NULL'}, 'invoice_review_case', '${caseId}', 'invoice_review.claim', '{"privateReason":"do not return"}', '{}', '2026-08-08T00:00:00Z')`;
  }).join(',\n');

  const database = new PGlite();
  try {
    await database.exec(`
      CREATE TABLE users (
        id uuid PRIMARY KEY,
        organization_id uuid NOT NULL,
        name varchar(255) NOT NULL
      );
      CREATE TABLE audit_log (
        id uuid PRIMARY KEY,
        organization_id uuid NOT NULL,
        user_id uuid,
        entity_type varchar(50) NOT NULL,
        entity_id uuid NOT NULL,
        action varchar(50) NOT NULL,
        changes jsonb,
        metadata jsonb,
        created_at timestamptz NOT NULL
      );
      INSERT INTO users (id, organization_id, name) VALUES
        ('${requesterId}', '${organizationId}', 'AP reviewer'),
        ('${missingActorId}', '${otherOrganizationId}', 'Other tenant');
      INSERT INTO audit_log (
        id, organization_id, user_id, entity_type, entity_id, action, changes, metadata, created_at
      ) VALUES
        ('${signalDecisionId}', '${organizationId}', NULL, 'invoice_review_signal', '${signalId}', 'invoice_review_signal.resolve_signal', '{"reason":"private"}', '{"secret":"private"}', '2026-08-09T00:00:00Z'),
        ('${missingActorEventId}', '${organizationId}', '${missingActorId}', 'invoice_review_signal', '${signalId}', 'invoice_review_signal.waive_signal', '{"reason":"private"}', '{}', '2026-08-09T00:00:00Z'),
        ('${signalRecordedId}', '${organizationId}', NULL, 'invoice_review_case', '${caseId}', 'review_signal_recorded', '{"signalId":"${signalId}","reason":"private"}', '{"secret":"private"}', '2026-08-09T00:00:00Z'),
        ('${unsupportedActionId}', '${organizationId}', NULL, 'invoice_review_case', '${caseId}', 'audit.private', '{}', '{}', '2026-08-09T00:00:00Z'),
        ('${otherOrganizationEventId}', '${otherOrganizationId}', NULL, 'invoice_review_signal', '${signalId}', 'invoice_review_signal.resolve_signal', '{}', '{}', '2026-08-09T00:00:00Z'),
        ('${wrongCaseEventId}', '${organizationId}', NULL, 'invoice_review_case', '00000000-0000-4000-8000-000000000099', 'invoice_review.claim', '{}', '{}', '2026-08-09T00:00:00Z'),
        ${matchingCaseRows};
    `);

    const historyQueries: string[] = [];
    const realDb = drizzle(database, {
      schema,
      logger: {
        logQuery: (query) => {
          if (query.includes('"audit_log"')) historyQueries.push(query);
        },
      },
    });
    let selectedFullChanges = false;
    const realSelect = (selection?: unknown) => {
      if (typeof selection === 'object' && selection !== null && 'audit' in selection) {
        const auditSelection = (selection as { audit?: unknown }).audit;
        if (typeof auditSelection === 'object' && auditSelection !== null) {
          selectedFullChanges = 'changes' in auditSelection;
        }
      }
      return realDb.select(selection as never);
    };
    const projection = await createService(false, [], false, realSelect).getProjection(
      invoiceId,
      organizationId,
    );

    assert.equal(selectedFullChanges, false);
    assert.equal(historyQueries.length, 2);
    assert.equal(
      historyQueries.every((query) => /\bLIMIT\b/i.test(query)),
      true,
    );
    assert.equal(
      historyQueries.some((query) => /\bOR\b/i.test(query)),
      false,
    );
    assert.equal(
      historyQueries.every(
        (query) =>
          /"audit_log"\."organization_id"/.test(query) &&
          /"audit_log"\."entity_type"/.test(query) &&
          /"audit_log"\."entity_id"/.test(query) &&
          /"audit_log"\."action"/.test(query) &&
          /\bORDER BY\b/i.test(query) &&
          /"audit_log"\."created_at"/.test(query) &&
          /"audit_log"\."id"/.test(query),
      ),
      true,
    );
    assert.equal(projection.history.entries.length, INVOICE_REVIEW_HISTORY_LIMIT);
    assert.deepEqual(
      projection.history.entries.slice(0, 5).map((entry) => entry.id),
      [
        signalDecisionId,
        missingActorEventId,
        signalRecordedId,
        '00000000-0000-4000-8000-000000001104',
        '00000000-0000-4000-8000-000000001103',
      ],
    );
    assert.equal(projection.history.entries.at(-1)?.id, '00000000-0000-4000-8000-000000001008');
    assert.deepEqual(
      projection.history.entries.find((entry) => entry.id === missingActorEventId)?.actor,
      { id: missingActorId, name: 'Unknown user' },
    );
    assert.deepEqual(
      projection.history.entries.find((entry) => entry.id === signalRecordedId)?.target,
      { type: 'signal', id: signalId },
    );
    assert.equal(
      projection.history.entries.some(
        (entry) =>
          entry.id === otherOrganizationEventId ||
          entry.id === wrongCaseEventId ||
          entry.id === unsupportedActionId,
      ),
      false,
    );
    assert.equal('changes' in (projection.history.entries[0] ?? {}), false);
    assert.equal('metadata' in (projection.history.entries[0] ?? {}), false);
  } finally {
    await database.close();
  }
});

test('projection returns stable invoice summaries and explicit missing source markers', async () => {
  const projection = await createService().getProjection(invoiceId, organizationId);

  assert.equal(projection.case.state, 'open');
  assert.deepEqual(projection.invoice.vendor, {
    id: '00000000-0000-4000-8000-000000000005',
    name: 'Acme Supplies',
    code: 'ACME',
    status: 'active',
  });
  assert.deepEqual(projection.match, {
    status: 'exception',
    details: { reason: 'quantity variance' },
    exceptions: [
      {
        id: '00000000-0000-4000-8000-000000000008',
        status: 'exception',
        priceMatch: true,
        quantityMatch: false,
        priceVariance: '0',
        quantityVariance: '1',
        variancePct: '50',
      },
    ],
  });
  assert.equal(projection.signals[0]?.source.availability, 'present');
  assert.equal(projection.signals[1]?.source.availability, 'missing');
  assert.equal(projection.documents[0]?.filename, 'invoice.pdf');
  assert.equal('storageKey' in (projection.documents[0] ?? {}), false);
  assert.equal(projection.provenance.available, true);
  assert.deepEqual(projection.provenance.fields, []);
});

test('projection fails explicitly when the provenance relation is unavailable', async () => {
  await assert.rejects(
    createService(true).getProjection(invoiceId, organizationId),
    /Invoice provenance relation is unavailable/,
  );
});

test('projection redacts related records without their own permissions', async () => {
  const projection = await createService().getProjection(
    invoiceId,
    organizationId,
    accessFor(['invoices:view_all']),
  );

  assert.equal(projection.invoice.vendor, null);
  assert.equal(projection.invoice.purchaseOrder, null);
  assert.deepEqual(projection.approvals, []);
  assert.deepEqual(projection.payments, []);
});

test('projection keeps the purchase order while independently redacting its requisition', async () => {
  const projection = await createService().getProjection(
    invoiceId,
    organizationId,
    accessFor(['invoices:view_all', 'purchase_orders:view_all']),
  );

  assert.equal(projection.invoice.purchaseOrder?.id, purchaseOrderId);
  assert.equal(projection.invoice.purchaseOrder?.requisition, null);
});

test('queue returns bounded invoice summaries and a stable cursor', async () => {
  const openedAt = new Date('2026-08-01T00:00:00Z');
  const oldestSignalSortKey = '2026-08-01T00:00:00.123456Z';
  const rows = [
    {
      reviewCase: {
        id: '00000000-0000-4000-8000-000000000003',
        organizationId,
        invoiceId,
        state: 'open',
        ownerId: null,
        version: 1,
        openedAt,
        resolvedAt: null,
        createdAt: openedAt,
        updatedAt: openedAt,
      },
      invoice: {
        id: invoiceId,
        organizationId,
        vendorId: '00000000-0000-4000-8000-000000000005',
        entityId: null,
        internalNumber: 'INV-2026-0001',
        invoiceNumber: 'SUP-42',
        status: 'approved',
        dueDate: new Date('2026-08-30T00:00:00Z'),
        totalAmount: '108.00',
        currency: 'USD',
      },
      vendor: {
        id: '00000000-0000-4000-8000-000000000005',
        organizationId,
        name: 'Acme Supplies',
        code: 'ACME',
        status: 'active',
      },
      entity: null,
      oldestUnresolvedSignalAt: oldestSignalSortKey,
      unresolvedSignalCount: 2,
      blockingSignalCount: 1,
    },
    {
      reviewCase: {
        id: '00000000-0000-4000-8000-000000000014',
        organizationId,
        invoiceId: '00000000-0000-4000-8000-000000000015',
        state: 'open',
        ownerId: null,
        version: 1,
        openedAt: new Date('2026-08-02T00:00:00Z'),
        resolvedAt: null,
        createdAt: new Date('2026-08-02T00:00:00Z'),
        updatedAt: new Date('2026-08-02T00:00:00Z'),
      },
      invoice: {
        id: '00000000-0000-4000-8000-000000000015',
        organizationId,
        vendorId: '00000000-0000-4000-8000-000000000005',
        entityId: null,
        internalNumber: 'INV-2026-0002',
        invoiceNumber: 'SUP-43',
        status: 'approved',
        dueDate: new Date('2026-09-01T00:00:00Z'),
        totalAmount: '12.00',
        currency: 'USD',
      },
      vendor: {
        id: '00000000-0000-4000-8000-000000000005',
        organizationId,
        name: 'Acme Supplies',
        code: 'ACME',
        status: 'active',
      },
      entity: null,
      oldestUnresolvedSignalAt: '2026-08-02T00:00:00.654321Z',
      unresolvedSignalCount: 1,
      blockingSignalCount: 1,
    },
  ];
  const builder = {
    from: () => builder,
    innerJoin: () => builder,
    leftJoin: () => builder,
    where: () => builder,
    orderBy: () => builder,
    limit: async () => rows,
  };
  const db = {
    select: () => builder,
  } as unknown as Db;

  const result = await createReviewService(db).listCases(
    organizationId,
    { limit: 1 },
    accessFor(['invoices:view_all']),
  );

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.invoice.internalNumber, 'INV-2026-0001');
  assert.equal(result.items[0]?.case.blockingSignalCount, 1);
  assert.equal(result.items[0]?.case.unresolvedSignalCount, 2);
  assert.equal(result.items[0]?.invoice.vendor, null);
  assert.deepEqual(
    result.items[0]?.case.oldestUnresolvedSignalAt,
    new Date('2026-08-01T00:00:00.123Z'),
  );
  assert.ok(result.nextCursor);
  const cursor = JSON.parse(Buffer.from(result.nextCursor, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
  assert.equal(cursor.value, oldestSignalSortKey);
});

test('queue rejects a cursor whose case id is not a UUID before querying', async () => {
  const cursor = Buffer.from(
    JSON.stringify({ sort: 'oldest_signal', value: null, id: 'not-a-uuid' }),
    'utf8',
  ).toString('base64url');
  const db = {
    select: () => {
      throw new Error('invalid cursors must not reach the database');
    },
  } as unknown as Db;

  await assert.rejects(
    createReviewService(db).listCases(organizationId, { cursor }),
    /cursor is invalid/,
  );
});

test('recordSignal preserves one signal identity across repeated observations', async () => {
  const cases: Array<Record<string, unknown>> = [];
  const signals: Array<Record<string, unknown>> = [];
  const auditClaims: Array<Record<string, unknown>> = [];
  const auditRows: Array<Record<string, unknown>> = [];
  let auditClaimLookups = 0;
  let failAudit = false;
  let nextId = 20;
  const tx = {
    execute: async () => {
      if (failAudit) throw new Error('audit write failed');
      return [
        {
          changesJson: '{}',
          metadataJson: '{}',
          createdAtText: '2026-08-01T00:00:00.000000Z',
        },
      ];
    },
    select: () => {
      let table: unknown;
      const builder = {
        from: (selectedTable: unknown) => {
          table = selectedTable;
          return builder;
        },
        where: () => builder,
        limit: () => builder,
        for: async () => {
          if (table === invoices) return [{ id: invoiceId, status: 'pending', paidAt: null }];
          if (table === invoiceReviewCases) return cases;
          if (table === invoiceReviewSignals) {
            return signals;
          }
          return [];
        },
        orderBy: () => builder,
        then: (resolve: (value: unknown) => unknown) =>
          resolve(
            table === invoices
              ? [{ id: invoiceId, status: 'pending', paidAt: null }]
              : table === invoiceReviewSignals
                ? signals.map((signal) => ({
                    severity: signal.severity,
                    status: signal.status,
                  }))
                : table === auditIdempotencyKeys
                  ? (() => {
                      auditClaimLookups += 1;
                      return auditClaimLookups === 3 ? [auditClaims[1]] : [];
                    })()
                  : table === auditLog
                    ? auditRows
                    : [],
          ),
      };
      return builder;
    },
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        if (table === auditIdempotencyKeys) {
          auditClaims.push(values);
          return {};
        }
        if (table === auditLog) {
          return {
            returning: async () => {
              const row = {
                ...values,
                entryHash: `hash-${String(values.id)}`,
              };
              auditRows.push(row);
              return [row];
            },
          };
        }
        if (table === invoiceReviewSignals) {
          return {
            returning: async () => {
              const signal = { ...values, id: `signal-${nextId++}` };
              signals.push(signal);
              return [signal];
            },
          };
        }
        return {
          onConflictDoNothing: () => ({
            returning: async () => {
              if (table !== invoiceReviewCases || cases.length > 0) return [];
              const reviewCase = {
                id: '00000000-0000-4000-8000-000000000016',
                organizationId: values.organizationId,
                invoiceId: values.invoiceId,
                state: values.state,
                ownerId: null,
                version: 1,
                openedAt: values.openedAt,
                resolvedAt: null,
                createdAt: values.createdAt,
                updatedAt: values.updatedAt,
              };
              cases.push(reviewCase);
              return [reviewCase];
            },
          }),
          onConflictDoUpdate: (config: { set: Record<string, unknown> }) => ({
            returning: async () => {
              const existing = signals.find(
                (signal) =>
                  signal.caseId === values.caseId &&
                  signal.signalType === values.signalType &&
                  signal.sourceModule === values.sourceModule &&
                  signal.sourceRecordId === values.sourceRecordId,
              );
              if (existing) {
                if (
                  existing.lastSeenAt instanceof Date &&
                  config.set.lastSeenAt instanceof Date &&
                  existing.lastSeenAt > config.set.lastSeenAt
                ) {
                  return [];
                }
                Object.assign(existing, config.set, { id: existing.id });
                return [existing];
              }
              const signal = { ...values, id: `signal-${nextId++}` };
              signals.push(signal);
              return [signal];
            },
          }),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          if (table === auditIdempotencyKeys) {
            Object.assign(auditClaims.at(-1) ?? {}, values);
            return undefined;
          }
          if (table === invoiceReviewSignals) {
            return {
              returning: async () => {
                const signal = signals[0];
                if (!signal) return [];
                Object.assign(signal, values);
                return [signal];
              },
            };
          }
          return {
            returning: async () => {
              if (table !== invoiceReviewCases) return [];
              const reviewCase = cases[0];
              if (!reviewCase) return [];
              Object.assign(reviewCase, values, {
                version: Number(reviewCase.version) + 1,
              });
              return [reviewCase];
            },
          };
        },
      }),
    }),
  };
  const db = {
    transaction: async <T>(callback: (executor: typeof tx) => Promise<T>) => {
      const casesSnapshot = cases.map((reviewCase) => ({ ...reviewCase }));
      const signalsSnapshot = signals.map((signal) => ({ ...signal }));
      const auditClaimsSnapshot = auditClaims.map((claim) => ({ ...claim }));
      const auditRowsSnapshot = auditRows.map((row) => ({ ...row }));
      try {
        return await callback(tx);
      } catch (error) {
        cases.splice(0, cases.length, ...casesSnapshot);
        signals.splice(0, signals.length, ...signalsSnapshot);
        auditClaims.splice(0, auditClaims.length, ...auditClaimsSnapshot);
        auditRows.splice(0, auditRows.length, ...auditRowsSnapshot);
        throw error;
      }
    },
  } as unknown as Db;
  const service = createReviewService(db);
  const input = {
    organizationId,
    invoiceId,
    signalType: 'match_exception' as const,
    sourceModule: 'matching',
    sourceRecordId: invoiceId,
    severity: 'blocking' as const,
    summary: 'Match is outside tolerance',
    observedAt: new Date('2026-08-01T00:00:00Z'),
  };

  const first = await service.recordSignal(input);
  const second = await service.recordSignal({
    ...input,
    summary: 'Match remains outside tolerance',
    observedAt: new Date('2026-08-02T00:00:00Z'),
  });
  const retry = await service.recordSignal({
    ...input,
    summary: 'Match remains outside tolerance',
    observedAt: new Date('2026-08-02T00:00:00Z'),
  });
  const staleResolved = await service.recordSignal({
    ...input,
    status: 'resolved',
    observedAt: new Date('2026-08-01T12:00:00Z'),
  });

  assert.equal(cases.length, 1);
  assert.equal(signals.length, 1);
  assert.equal(first.signal.id, second.signal.id);
  assert.equal(second.signal.id, retry.signal.id);
  assert.equal(retry.signal.id, staleResolved.signal.id);
  assert.equal(signals[0]?.summary, 'Match remains outside tolerance');
  assert.deepEqual(signals[0]?.firstSeenAt, new Date('2026-08-01T00:00:00Z'));
  assert.deepEqual(signals[0]?.lastSeenAt, new Date('2026-08-02T00:00:00Z'));
  assert.equal(cases[0]?.state, 'open');
  assert.equal(auditRows.length, 2);
  assert.equal(auditClaims.length, 2);
  assert.equal(auditRows[0]?.action, 'review_signal_recorded');
  assert.equal(auditRows[0]?.entityType, 'invoice_review_case');

  await service.recordSignal({
    ...input,
    status: 'resolved',
    observedAt: new Date('2026-08-03T00:00:00Z'),
  });
  const resolvedAt = cases[0]?.resolvedAt;
  await service.recordSignal({
    ...input,
    status: 'resolved',
    observedAt: new Date('2026-08-03T12:00:00Z'),
  });
  await service.recordSignal({
    ...input,
    status: 'open',
    observedAt: new Date('2026-08-02T12:00:00Z'),
  });

  assert.equal(signals[0]?.status, 'resolved');
  assert.deepEqual(signals[0]?.lastSeenAt, new Date('2026-08-03T12:00:00Z'));
  assert.equal(cases[0]?.state, 'resolved');
  assert.deepEqual(cases[0]?.resolvedAt, resolvedAt);
  assert.equal(auditRows.length, 4);
  assert.equal(auditClaims.length, 4);

  failAudit = true;
  await assert.rejects(
    service.recordSignal({
      ...input,
      sourceRecordId: '00000000-0000-4000-8000-000000000022',
      observedAt: new Date('2026-08-04T00:00:00Z'),
    }),
    /audit write failed/,
  );
  assert.equal(signals.length, 1);
  assert.equal(cases.length, 1);
  assert.equal(auditRows.length, 4);
  assert.equal(auditClaims.length, 4);
});
