import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gt, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  approvalRequests,
  appendAuditLogIfAbsent,
  documents,
  emailIntakeItems,
  invoiceReviewCases,
  invoiceReviewSignals,
  invoices,
  legalEntities,
  messages,
  ocrJobs,
  purchaseOrders,
  requisitions,
  spendGuardAlerts,
  type Db,
  type DbTransaction,
  vendors,
} from '@betterspend/db';
import {
  invoiceReviewListQuerySchema,
  recordInvoiceReviewSignalSchema,
  type InvoiceReviewCaseState,
  type InvoiceReviewListQuery,
  type InvoiceReviewSignalSeverity,
  type InvoiceReviewSignalStatus,
  type InvoiceReviewSignalType,
  type RecordInvoiceReviewSignalInput,
} from '@betterspend/shared';
import { DB_TOKEN } from '../../database/database.module';
import type { AccessPolicy } from '../auth/access-policy';
import { permissionScopePredicate } from '../auth/access-scope';
import { canViewRelatedRecord } from '../auth/related-record-access';
import { initialReviewCaseState, nextReviewCaseState } from './invoice-review-state';

type SourceAvailability = 'present' | 'missing' | 'unknown';

export interface InvoiceReviewSourceView {
  module: string;
  recordId: string;
  availability: SourceAvailability;
}

export interface InvoiceReviewSignalView {
  id: string;
  type: InvoiceReviewSignalType;
  source: InvoiceReviewSourceView;
  severity: InvoiceReviewSignalSeverity;
  status: InvoiceReviewSignalStatus;
  summary: string;
  details: Record<string, unknown>;
  firstSeenAt: Date;
  lastSeenAt: Date;
  resolution: {
    actorId: string | null;
    command: string | null;
    reason: string | null;
    resolvedAt: Date | null;
  };
}

export interface InvoiceReviewCaseView {
  id: string;
  invoiceId: string;
  state: InvoiceReviewCaseState;
  ownerId: string | null;
  version: number;
  openedAt: Date;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InvoiceReviewListItem {
  case: InvoiceReviewCaseView & {
    ageDays: number;
    unresolvedSignalCount: number;
    blockingSignalCount: number;
    oldestUnresolvedSignalAt: Date | null;
  };
  invoice: {
    id: string;
    internalNumber: string;
    invoiceNumber: string;
    status: string;
    dueDate: Date | null;
    totalAmount: string;
    currency: string;
    vendor: { id: string; name: string; code: string | null; status: string } | null;
    entity: { id: string; name: string; code: string; currency: string } | null;
  };
}

export interface InvoiceReviewListResult {
  items: InvoiceReviewListItem[];
  nextCursor: string | null;
}

export interface InvoiceReviewProjection {
  case: InvoiceReviewCaseView & {
    owner: { id: string; name: string; email: string } | null;
  };
  invoice: {
    id: string;
    internalNumber: string;
    invoiceNumber: string;
    status: string;
    invoiceDate: Date;
    dueDate: Date | null;
    subtotal: string;
    taxAmount: string;
    totalAmount: string;
    currency: string;
    baseCurrency: string;
    baseTotalAmount: string;
    documentId: string | null;
    vendor: { id: string; name: string; code: string | null; status: string } | null;
    entity: { id: string; name: string; code: string; currency: string } | null;
    purchaseOrder: {
      id: string;
      number: string;
      status: string;
      entityId: string | null;
      vendorId: string;
      requisition: {
        id: string;
        number: string;
        status: string;
        requesterId: string;
        departmentId: string | null;
        projectId: string | null;
      } | null;
    } | null;
    lines: Array<{
      id: string;
      lineNumber: string;
      description: string;
      quantity: string;
      unitPrice: string;
      taxAmount: string;
      totalPrice: string;
      matchResults: Array<{
        id: string;
        status: string;
        priceMatch: boolean;
        quantityMatch: boolean;
        priceVariance: string;
        quantityVariance: string;
        variancePct: string;
      }>;
    }>;
  };
  signals: InvoiceReviewSignalView[];
  documents: Array<{
    id: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
    entityType: string;
    entityId: string;
    createdAt: Date;
  }>;
  messages: Array<{
    id: string;
    senderType: string;
    authorName: string;
    body: string;
    attachments: unknown;
    createdAt: Date;
  }>;
  match: {
    status: string;
    details: Record<string, unknown>;
    exceptions: InvoiceReviewProjection['invoice']['lines'][number]['matchResults'];
  };
  approvals: Array<{
    id: string;
    status: string;
    currentStep: number;
    currentNodeId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  payments: Array<{
    id: string;
    paymentRunId: string;
    amount: string;
    currency: string;
    status: string;
    paymentReference: string | null;
    paymentRun: {
      id: string;
      status: string;
      entityId: string | null;
      runDate: string;
    } | null;
  }>;
  provenance: { available: false; fields: [] };
  history: { available: false; entries: [] };
}

interface ReviewCursor {
  sort: InvoiceReviewListQuery['sort'];
  value: string | null;
  id: string;
}

const reviewCursorIdSchema = z.string().uuid();

interface SignalAuditInput {
  organizationId: string;
  caseId: string;
  signalId: string;
  signalType: InvoiceReviewSignalType;
  sourceModule: string;
  sourceRecordId: string;
  severity: InvoiceReviewSignalSeverity;
  status: InvoiceReviewSignalStatus;
  previousCaseState: InvoiceReviewCaseState;
  nextCaseState: InvoiceReviewCaseState;
}

async function appendSignalAudit(
  transaction: DbTransaction,
  input: SignalAuditInput,
): Promise<void> {
  await appendAuditLogIfAbsent(transaction, {
    organizationId: input.organizationId,
    userId: null,
    entityType: 'invoice_review_case',
    entityId: input.caseId,
    action: 'review_signal_recorded',
    changes: {
      signalId: input.signalId,
      signalType: input.signalType,
      sourceModule: input.sourceModule,
      sourceRecordId: input.sourceRecordId,
      severity: input.severity,
      status: input.status,
      previousCaseState: input.previousCaseState,
      nextCaseState: input.nextCaseState,
    },
    idempotencyKey: `invoice-review-signal:${input.signalId}`,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function dateValue(value: Date | string | null): Date | null {
  if (value === null) return null;
  return value instanceof Date ? value : new Date(value);
}

function daysSince(value: Date, now = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - value.getTime()) / 86_400_000));
}

function encodeCursor(cursor: ReviewCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(value: string, expectedSort: ReviewCursor['sort']): ReviewCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!isRecord(parsed)) throw new Error('cursor must be an object');
    const sort = parsed.sort;
    const cursorValue = parsed.value;
    const id = parsed.id;
    const parsedId = reviewCursorIdSchema.safeParse(id);
    if (
      (sort !== 'oldest_signal' && sort !== 'due_date') ||
      sort !== expectedSort ||
      (cursorValue !== null && typeof cursorValue !== 'string') ||
      !parsedId.success
    ) {
      throw new Error('cursor has an invalid shape');
    }
    if (cursorValue !== null && Number.isNaN(new Date(cursorValue).getTime())) {
      throw new Error('cursor contains an invalid date');
    }
    return { sort, value: cursorValue, id: parsedId.data };
  } catch {
    throw new BadRequestException('cursor is invalid');
  }
}

function invoiceReviewScopePredicates(organizationId: string) {
  const invoiceScope = (condition: SQL) => sql`${invoiceReviewCases.invoiceId} IN (
    SELECT ${invoices.id}
    FROM ${invoices}
    LEFT JOIN ${purchaseOrders}
      ON ${purchaseOrders.id} = ${invoices.purchaseOrderId}
    LEFT JOIN ${requisitions}
      ON ${requisitions.id} = ${purchaseOrders.requisitionId}
    WHERE ${invoices.organizationId} = ${organizationId}
      AND ${condition}
  )`;

  return {
    own: (userId: string) =>
      invoiceScope(
        sql`(${invoices.createdBy} = ${userId} OR ${requisitions.requesterId} = ${userId})`,
      ),
    department: (departmentId: string) => invoiceScope(eq(requisitions.departmentId, departmentId)),
    project: (projectId: string) => invoiceScope(eq(requisitions.projectId, projectId)),
    entity: (entityId: string) => invoiceScope(eq(invoices.entityId, entityId)),
  };
}

function invoiceReviewVisibility(access: AccessPolicy | undefined, organizationId: string): SQL {
  return permissionScopePredicate(
    access,
    'invoice',
    ['invoices:view_all', 'invoices:manage', 'invoices:approve'],
    invoiceReviewScopePredicates(organizationId),
  );
}

function signalKey(module: string, recordId: string): string {
  return `${module}\u0000${recordId}`;
}

@Injectable()
export class InvoiceReviewsService {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  /**
   * Read the queue through the invoice visibility predicate already used by
   * the invoice module. The review tables never widen access to an invoice.
   */
  async listCases(
    organizationId: string,
    rawQuery: unknown = {},
    access?: AccessPolicy,
  ): Promise<InvoiceReviewListResult> {
    const query = invoiceReviewListQuerySchema.parse(rawQuery);
    const oldestUnresolvedSignalAtForSort = sql<Date | null>`(
      SELECT MIN(${invoiceReviewSignals.firstSeenAt})
      FROM ${invoiceReviewSignals}
      WHERE ${invoiceReviewSignals.organizationId} = ${organizationId}
        AND ${invoiceReviewSignals.caseId} = ${invoiceReviewCases.id}
        AND ${invoiceReviewSignals.status} = 'open'
        AND ${invoiceReviewSignals.severity} <> 'informational'
    )`;
    const unresolvedSignalCountForSummary = sql<number>`(
      SELECT COUNT(*)::integer
      FROM ${invoiceReviewSignals}
      WHERE ${invoiceReviewSignals.organizationId} = ${organizationId}
        AND ${invoiceReviewSignals.caseId} = ${invoiceReviewCases.id}
        AND ${invoiceReviewSignals.status} = 'open'
        AND ${invoiceReviewSignals.severity} <> 'informational'
    )`;
    const blockingSignalCountForSummary = sql<number>`(
      SELECT COUNT(*)::integer
      FROM ${invoiceReviewSignals}
      WHERE ${invoiceReviewSignals.organizationId} = ${organizationId}
        AND ${invoiceReviewSignals.caseId} = ${invoiceReviewCases.id}
        AND ${invoiceReviewSignals.status} = 'open'
        AND ${invoiceReviewSignals.severity} = 'blocking'
    )`;
    const conditions: SQL[] = [
      eq(invoiceReviewCases.organizationId, organizationId),
      invoiceReviewVisibility(access, organizationId),
    ];

    if (query.state) conditions.push(eq(invoiceReviewCases.state, query.state));
    if (query.ownerId) conditions.push(eq(invoiceReviewCases.ownerId, query.ownerId));
    if (query.vendorId) {
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM ${invoices}
          WHERE ${invoices.id} = ${invoiceReviewCases.invoiceId}
            AND ${invoices.organizationId} = ${organizationId}
            AND ${invoices.vendorId} = ${query.vendorId}
        )`,
      );
    }
    if (query.entityId) {
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM ${invoices}
          WHERE ${invoices.id} = ${invoiceReviewCases.invoiceId}
            AND ${invoices.organizationId} = ${organizationId}
            AND ${invoices.entityId} = ${query.entityId}
        )`,
      );
    }
    if (query.signalType || query.severity) {
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM ${invoiceReviewSignals}
          WHERE ${invoiceReviewSignals.caseId} = ${invoiceReviewCases.id}
            AND ${invoiceReviewSignals.organizationId} = ${organizationId}
            ${query.signalType ? sql`AND ${invoiceReviewSignals.signalType} = ${query.signalType}` : sql``}
            ${query.severity ? sql`AND ${invoiceReviewSignals.severity} = ${query.severity}` : sql``}
        )`,
      );
    }
    if (query.minAgeDays !== undefined) {
      conditions.push(
        lte(invoiceReviewCases.openedAt, new Date(Date.now() - query.minAgeDays * 86_400_000)),
      );
    }

    if (query.cursor) {
      const cursor = decodeCursor(query.cursor, query.sort);
      const cursorId = cursor.id;
      if (query.sort === 'oldest_signal') {
        const cursorDate = cursor.value === null ? null : new Date(cursor.value);
        conditions.push(
          cursorDate === null
            ? (and(isNull(oldestUnresolvedSignalAtForSort), gt(invoiceReviewCases.id, cursorId)) ??
                sql`false`)
            : (or(
                gt(oldestUnresolvedSignalAtForSort, cursorDate),
                and(
                  eq(oldestUnresolvedSignalAtForSort, cursorDate),
                  gt(invoiceReviewCases.id, cursorId),
                ),
                isNull(oldestUnresolvedSignalAtForSort),
              ) ?? sql`false`),
        );
      } else if (cursor.value === null) {
        conditions.push(
          and(isNull(invoices.dueDate), gt(invoiceReviewCases.id, cursorId)) ?? sql`false`,
        );
      } else {
        const cursorDate = new Date(cursor.value);
        conditions.push(
          or(
            gt(invoices.dueDate, cursorDate),
            and(eq(invoices.dueDate, cursorDate), gt(invoiceReviewCases.id, cursorId)),
            isNull(invoices.dueDate),
          ) ?? sql`false`,
        );
      }
    }

    const rows = await this.db
      .select({
        reviewCase: invoiceReviewCases,
        invoice: invoices,
        vendor: vendors,
        entity: legalEntities,
        oldestUnresolvedSignalAt: oldestUnresolvedSignalAtForSort,
        unresolvedSignalCount: unresolvedSignalCountForSummary,
        blockingSignalCount: blockingSignalCountForSummary,
      })
      .from(invoiceReviewCases)
      .innerJoin(
        invoices,
        and(
          eq(invoiceReviewCases.invoiceId, invoices.id),
          eq(invoiceReviewCases.organizationId, invoices.organizationId),
        ),
      )
      .leftJoin(
        vendors,
        and(eq(invoices.vendorId, vendors.id), eq(invoices.organizationId, vendors.organizationId)),
      )
      .leftJoin(
        legalEntities,
        and(
          eq(invoices.entityId, legalEntities.id),
          eq(invoices.organizationId, legalEntities.organizationId),
        ),
      )
      .where(and(...conditions))
      .orderBy(
        query.sort === 'due_date' ? asc(invoices.dueDate) : asc(oldestUnresolvedSignalAtForSort),
        asc(invoiceReviewCases.id),
      )
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const visibleRows = hasMore ? rows.slice(0, query.limit) : rows;
    const items = visibleRows.map(
      ({
        reviewCase,
        invoice,
        vendor,
        entity,
        oldestUnresolvedSignalAt,
        unresolvedSignalCount,
        blockingSignalCount,
      }) => {
        return {
          case: {
            ...this.caseView(reviewCase),
            ageDays: daysSince(reviewCase.openedAt),
            unresolvedSignalCount,
            blockingSignalCount,
            oldestUnresolvedSignalAt: dateValue(oldestUnresolvedSignalAt ?? null),
          },
          invoice: {
            id: invoice.id,
            internalNumber: invoice.internalNumber,
            invoiceNumber: invoice.invoiceNumber,
            status: invoice.status,
            dueDate: invoice.dueDate,
            totalAmount: invoice.totalAmount,
            currency: invoice.currency,
            vendor: vendor
              ? { id: vendor.id, name: vendor.name, code: vendor.code, status: vendor.status }
              : null,
            entity: entity
              ? { id: entity.id, name: entity.name, code: entity.code, currency: entity.currency }
              : null,
          },
        } satisfies InvoiceReviewListItem;
      },
    );

    const lastRow = visibleRows.at(-1);
    return {
      items,
      nextCursor:
        hasMore && lastRow
          ? encodeCursor({
              sort: query.sort,
              value:
                query.sort === 'due_date'
                  ? (lastRow.invoice.dueDate?.toISOString() ?? null)
                  : (dateValue(lastRow.oldestUnresolvedSignalAt ?? null)?.toISOString() ?? null),
              id: lastRow.reviewCase.id,
            })
          : null,
    };
  }

  async getProjection(
    invoiceId: string,
    organizationId: string,
    access?: AccessPolicy,
  ): Promise<InvoiceReviewProjection> {
    const reviewCase = await this.db.query.invoiceReviewCases.findFirst({
      where: (record, operators) =>
        operators.and(
          operators.eq(record.organizationId, organizationId),
          operators.eq(record.invoiceId, invoiceId),
          invoiceReviewVisibility(access, organizationId),
        ),
      with: {
        owner: { columns: { id: true, name: true, email: true } },
        invoice: {
          columns: {
            id: true,
            createdBy: true,
            internalNumber: true,
            invoiceNumber: true,
            status: true,
            invoiceDate: true,
            dueDate: true,
            subtotal: true,
            taxAmount: true,
            totalAmount: true,
            currency: true,
            entityId: true,
            baseCurrency: true,
            baseTotalAmount: true,
            documentId: true,
            vendorId: true,
            purchaseOrderId: true,
            matchStatus: true,
            matchDetails: true,
          },
          with: {
            vendor: {
              columns: {
                id: true,
                organizationId: true,
                entityId: true,
                name: true,
                code: true,
                status: true,
              },
            },
            entity: {
              columns: { id: true, organizationId: true, name: true, code: true, currency: true },
            },
            purchaseOrder: {
              columns: {
                id: true,
                organizationId: true,
                issuedBy: true,
                number: true,
                status: true,
                entityId: true,
                vendorId: true,
              },
              with: {
                requisition: {
                  columns: {
                    id: true,
                    organizationId: true,
                    number: true,
                    status: true,
                    requesterId: true,
                    departmentId: true,
                    projectId: true,
                  },
                },
              },
            },
            lines: {
              columns: {
                id: true,
                lineNumber: true,
                description: true,
                quantity: true,
                unitPrice: true,
                taxAmount: true,
                totalPrice: true,
              },
              with: {
                matchResults: {
                  columns: {
                    id: true,
                    status: true,
                    priceMatch: true,
                    quantityMatch: true,
                    priceVariance: true,
                    quantityVariance: true,
                    variancePct: true,
                  },
                },
              },
            },
            paymentRunInvoices: {
              columns: {
                id: true,
                paymentRunId: true,
                amount: true,
                currency: true,
                status: true,
                paymentReference: true,
              },
              with: {
                paymentRun: {
                  columns: { id: true, orgId: true, status: true, entityId: true, runDate: true },
                },
              },
            },
          },
        },
        signals: {
          orderBy: (signal, operators) => [
            operators.asc(signal.firstSeenAt),
            operators.asc(signal.id),
          ],
        },
      },
    });
    if (!reviewCase?.invoice) {
      throw new NotFoundException(`Invoice review case for invoice ${invoiceId} not found`);
    }

    const invoice = reviewCase.invoice;
    const purchaseOrder = invoice.purchaseOrder;
    const purchaseOrderScope = {
      ownerIds: [purchaseOrder?.issuedBy, purchaseOrder?.requisition?.requesterId],
      departmentId: purchaseOrder?.requisition?.departmentId,
      projectId: purchaseOrder?.requisition?.projectId,
      entityId: purchaseOrder?.entityId,
    };
    const visiblePurchaseOrder =
      purchaseOrder &&
      canViewRelatedRecord(
        access,
        'purchase_order',
        [
          'purchase_orders:view_all',
          'purchase_orders:view_own',
          'purchase_orders:manage',
          'purchase_orders:issue',
        ],
        purchaseOrderScope,
      )
        ? purchaseOrder
        : null;
    const visibleRequisition =
      visiblePurchaseOrder?.requisition &&
      canViewRelatedRecord(
        access,
        'requisition',
        ['requisitions:view_all', 'requisitions:view_own', 'requisitions:manage'],
        {
          ownerIds: [visiblePurchaseOrder.requisition.requesterId],
          departmentId: visiblePurchaseOrder.requisition.departmentId,
          projectId: visiblePurchaseOrder.requisition.projectId,
        },
      )
        ? visiblePurchaseOrder.requisition
        : null;
    const visibleVendor =
      invoice.vendor &&
      canViewRelatedRecord(access, 'vendor', ['vendors:view'], {
        entityId: invoice.vendor.entityId,
      })
        ? invoice.vendor
        : null;
    const relatedRecordScope = {
      ownerIds: [invoice.createdBy, purchaseOrder?.requisition?.requesterId],
      departmentId: purchaseOrder?.requisition?.departmentId,
      projectId: purchaseOrder?.requisition?.projectId,
      entityId: invoice.entityId ?? purchaseOrder?.entityId,
    };
    const canViewApprovals = canViewRelatedRecord(
      access,
      'approval',
      ['approvals:view', 'approvals:act'],
      relatedRecordScope,
    );

    const [documentRows, messageRows, sourceAvailability] = await Promise.all([
      this.db.query.documents.findMany({
        where: (document, operators) =>
          operators.and(
            operators.eq(document.organizationId, organizationId),
            operators.eq(document.entityType, 'invoice'),
            operators.eq(document.entityId, invoiceId),
          ),
        columns: {
          id: true,
          filename: true,
          contentType: true,
          sizeBytes: true,
          entityType: true,
          entityId: true,
          createdAt: true,
        },
        orderBy: (document, operators) => operators.asc(document.createdAt),
      }),
      this.db.query.messages.findMany({
        where: (message, operators) =>
          operators.and(
            operators.eq(message.organizationId, organizationId),
            operators.eq(message.threadType, 'invoice'),
            operators.eq(message.threadId, invoiceId),
          ),
        columns: {
          id: true,
          senderType: true,
          authorName: true,
          body: true,
          attachments: true,
          createdAt: true,
        },
        orderBy: (message, operators) => operators.asc(message.createdAt),
      }),
      this.resolveSourceAvailability(organizationId, invoiceId, reviewCase.signals),
    ]);

    const approvalRows = canViewApprovals
      ? await this.db.query.approvalRequests.findMany({
          where: (request, operators) =>
            operators.and(
              operators.eq(request.organizationId, organizationId),
              operators.eq(request.approvableType, 'invoice'),
              operators.eq(request.approvableId, invoiceId),
            ),
          columns: {
            id: true,
            status: true,
            currentStep: true,
            currentNodeId: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: (request, operators) => [
            operators.asc(request.createdAt),
            operators.asc(request.id),
          ],
        })
      : [];
    const matchExceptions = invoice.lines.flatMap((line) =>
      line.matchResults.filter((result) => result.status === 'exception'),
    );

    return {
      case: {
        ...this.caseView(reviewCase),
        owner: reviewCase.owner
          ? { id: reviewCase.owner.id, name: reviewCase.owner.name, email: reviewCase.owner.email }
          : null,
      },
      invoice: {
        id: invoice.id,
        internalNumber: invoice.internalNumber,
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        invoiceDate: invoice.invoiceDate,
        dueDate: invoice.dueDate,
        subtotal: invoice.subtotal,
        taxAmount: invoice.taxAmount,
        totalAmount: invoice.totalAmount,
        currency: invoice.currency,
        baseCurrency: invoice.baseCurrency,
        baseTotalAmount: invoice.baseTotalAmount,
        documentId: invoice.documentId,
        vendor:
          visibleVendor?.organizationId === organizationId
            ? {
                id: visibleVendor.id,
                name: visibleVendor.name,
                code: visibleVendor.code,
                status: visibleVendor.status,
              }
            : null,
        entity:
          invoice.entity?.organizationId === organizationId
            ? {
                id: invoice.entity.id,
                name: invoice.entity.name,
                code: invoice.entity.code,
                currency: invoice.entity.currency,
              }
            : null,
        purchaseOrder:
          visiblePurchaseOrder?.organizationId === organizationId
            ? {
                id: visiblePurchaseOrder.id,
                number: visiblePurchaseOrder.number,
                status: visiblePurchaseOrder.status,
                entityId: visiblePurchaseOrder.entityId,
                vendorId: visiblePurchaseOrder.vendorId,
                requisition:
                  visibleRequisition?.organizationId === organizationId
                    ? {
                        id: visibleRequisition.id,
                        number: visibleRequisition.number,
                        status: visibleRequisition.status,
                        requesterId: visibleRequisition.requesterId,
                        departmentId: visibleRequisition.departmentId,
                        projectId: visibleRequisition.projectId,
                      }
                    : null,
              }
            : null,
        lines: invoice.lines.map((line) => ({
          id: line.id,
          lineNumber: line.lineNumber,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          taxAmount: line.taxAmount,
          totalPrice: line.totalPrice,
          matchResults: line.matchResults,
        })),
      },
      signals: reviewCase.signals.map((signal) =>
        this.signalView(
          signal,
          sourceAvailability.get(signalKey(signal.sourceModule, signal.sourceRecordId)) ??
            'unknown',
        ),
      ),
      documents: documentRows,
      messages: messageRows,
      match: {
        status: invoice.matchStatus,
        details: asRecord(invoice.matchDetails),
        exceptions: matchExceptions,
      },
      approvals: approvalRows,
      payments: invoice.paymentRunInvoices.flatMap((payment) => {
        if (
          payment.paymentRun?.orgId !== organizationId ||
          !canViewRelatedRecord(access, 'payment', ['payments:view', 'payments:manage'], {
            entityId: payment.paymentRun.entityId,
          })
        ) {
          return [];
        }
        return [{ ...payment, paymentRun: payment.paymentRun }];
      }),
      provenance: { available: false, fields: [] },
      history: { available: false, entries: [] },
    };
  }

  /**
   * Internal producer seam. Repeated observations update one signal identity,
   * preserve its first-seen time, and derive case state in one transaction.
   */
  async recordSignal(rawInput: RecordInvoiceReviewSignalInput) {
    const input = recordInvoiceReviewSignalSchema.parse(rawInput);
    const observedAt = input.observedAt ?? new Date();

    return this.db.transaction(async (tx) => {
      const [invoice] = await tx
        .select({ id: invoices.id })
        .from(invoices)
        .where(
          and(eq(invoices.id, input.invoiceId), eq(invoices.organizationId, input.organizationId)),
        )
        .limit(1);
      if (!invoice) throw new NotFoundException(`Invoice ${input.invoiceId} not found`);

      let [reviewCase] = await tx
        .select()
        .from(invoiceReviewCases)
        .where(
          and(
            eq(invoiceReviewCases.organizationId, input.organizationId),
            eq(invoiceReviewCases.invoiceId, input.invoiceId),
          ),
        )
        .for('update');

      if (!reviewCase) {
        [reviewCase] = await tx
          .insert(invoiceReviewCases)
          .values({
            organizationId: input.organizationId,
            invoiceId: input.invoiceId,
            state: initialReviewCaseState(input),
            openedAt: observedAt,
            createdAt: observedAt,
            updatedAt: observedAt,
          })
          .onConflictDoNothing({
            target: [invoiceReviewCases.organizationId, invoiceReviewCases.invoiceId],
          })
          .returning();

        if (!reviewCase) {
          [reviewCase] = await tx
            .select()
            .from(invoiceReviewCases)
            .where(
              and(
                eq(invoiceReviewCases.organizationId, input.organizationId),
                eq(invoiceReviewCases.invoiceId, input.invoiceId),
              ),
            )
            .for('update');
        }
      }
      if (!reviewCase) throw new Error('Invoice review case could not be created');

      const [signal] = await tx
        .insert(invoiceReviewSignals)
        .values({
          organizationId: input.organizationId,
          caseId: reviewCase.id,
          signalType: input.signalType,
          sourceModule: input.sourceModule,
          sourceRecordId: input.sourceRecordId,
          severity: input.severity,
          status: input.status,
          summary: input.summary,
          details: input.details,
          firstSeenAt: observedAt,
          lastSeenAt: observedAt,
          resolvedAt: input.status === 'resolved' ? observedAt : null,
          updatedAt: observedAt,
        })
        .onConflictDoUpdate({
          target: [
            invoiceReviewSignals.caseId,
            invoiceReviewSignals.signalType,
            invoiceReviewSignals.sourceModule,
            invoiceReviewSignals.sourceRecordId,
          ],
          set: {
            severity: input.severity,
            status: input.status,
            summary: input.summary,
            details: input.details,
            lastSeenAt: observedAt,
            resolvedAt: input.status === 'resolved' ? observedAt : null,
            updatedAt: observedAt,
          },
        })
        .returning();
      if (!signal) throw new Error('Invoice review signal could not be written');

      const currentSignals = await tx
        .select({ severity: invoiceReviewSignals.severity, status: invoiceReviewSignals.status })
        .from(invoiceReviewSignals)
        .where(
          and(
            eq(invoiceReviewSignals.caseId, reviewCase.id),
            eq(invoiceReviewSignals.organizationId, input.organizationId),
          ),
        );
      const nextState = nextReviewCaseState(reviewCase.state, currentSignals);
      const [updatedCase] = await tx
        .update(invoiceReviewCases)
        .set({
          state: nextState,
          resolvedAt: nextState === 'resolved' ? observedAt : null,
          updatedAt: observedAt,
          version: sql`${invoiceReviewCases.version} + 1`,
        })
        .where(
          and(
            eq(invoiceReviewCases.id, reviewCase.id),
            eq(invoiceReviewCases.organizationId, input.organizationId),
          ),
        )
        .returning();

      await appendSignalAudit(tx, {
        organizationId: input.organizationId,
        caseId: reviewCase.id,
        signalId: signal.id,
        signalType: signal.signalType,
        sourceModule: signal.sourceModule,
        sourceRecordId: signal.sourceRecordId,
        severity: signal.severity,
        status: signal.status,
        previousCaseState: reviewCase.state,
        nextCaseState: nextState,
      });

      return { case: updatedCase ?? reviewCase, signal };
    });
  }

  private caseView(reviewCase: typeof invoiceReviewCases.$inferSelect): InvoiceReviewCaseView {
    return {
      id: reviewCase.id,
      invoiceId: reviewCase.invoiceId,
      state: reviewCase.state,
      ownerId: reviewCase.ownerId,
      version: reviewCase.version,
      openedAt: reviewCase.openedAt,
      resolvedAt: reviewCase.resolvedAt,
      createdAt: reviewCase.createdAt,
      updatedAt: reviewCase.updatedAt,
    };
  }

  private signalView(
    signal: typeof invoiceReviewSignals.$inferSelect,
    availability: SourceAvailability,
  ): InvoiceReviewSignalView {
    return {
      id: signal.id,
      type: signal.signalType,
      source: {
        module: signal.sourceModule,
        recordId: signal.sourceRecordId,
        availability,
      },
      severity: signal.severity,
      status: signal.status,
      summary: signal.summary,
      details: asRecord(signal.details),
      firstSeenAt: signal.firstSeenAt,
      lastSeenAt: signal.lastSeenAt,
      resolution: {
        actorId: signal.resolutionActorId,
        command: signal.resolutionCommand,
        reason: signal.resolutionReason,
        resolvedAt: signal.resolvedAt,
      },
    };
  }

  private async resolveSourceAvailability(
    organizationId: string,
    invoiceId: string,
    signals: readonly (typeof invoiceReviewSignals.$inferSelect)[],
  ): Promise<Map<string, SourceAvailability>> {
    const availability = new Map<string, SourceAvailability>();
    const alertIds = new Set<string>();
    const ocrIds = new Set<string>();
    const intakeIds = new Set<string>();
    for (const signal of signals) {
      const key = signalKey(signal.sourceModule, signal.sourceRecordId);
      if (signal.sourceModule === 'matching') {
        availability.set(key, signal.sourceRecordId === invoiceId ? 'present' : 'missing');
      } else if (signal.sourceModule === 'spend_guard') {
        availability.set(key, 'missing');
        alertIds.add(signal.sourceRecordId);
      } else if (signal.sourceModule === 'ocr') {
        availability.set(key, 'missing');
        ocrIds.add(signal.sourceRecordId);
      } else if (signal.sourceModule === 'email_intake') {
        availability.set(key, 'missing');
        intakeIds.add(signal.sourceRecordId);
      } else {
        availability.set(key, 'unknown');
      }
    }

    const [alerts, ocr, intake] = await Promise.all([
      alertIds.size === 0
        ? []
        : this.db.query.spendGuardAlerts.findMany({
            where: (record, operators) =>
              operators.and(
                operators.eq(record.orgId, organizationId),
                operators.inArray(record.id, [...alertIds]),
              ),
            columns: { id: true },
          }),
      ocrIds.size === 0
        ? []
        : this.db.query.ocrJobs.findMany({
            where: (record, operators) =>
              operators.and(
                operators.eq(record.organizationId, organizationId),
                operators.inArray(record.id, [...ocrIds]),
              ),
            columns: { id: true },
          }),
      intakeIds.size === 0
        ? []
        : this.db.query.emailIntakeItems.findMany({
            where: (record, operators) =>
              operators.and(
                operators.eq(record.organizationId, organizationId),
                operators.inArray(record.id, [...intakeIds]),
              ),
            columns: { id: true },
          }),
    ]);
    for (const record of alerts) availability.set(signalKey('spend_guard', record.id), 'present');
    for (const record of ocr) availability.set(signalKey('ocr', record.id), 'present');
    for (const record of intake) availability.set(signalKey('email_intake', record.id), 'present');
    return availability;
  }
}
