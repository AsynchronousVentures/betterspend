import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '@betterspend/db';
import { globalOnlyPredicate, scopePredicate, type ScopeConstraint } from '../auth/scope-sql';

type Db = NodePgDatabase<typeof schema>;

export interface ExportQuery {
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

function csvEscape(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function buildCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const lines: string[] = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  }
  return lines.join('\n');
}

export type ExportType =
  | 'purchase-orders'
  | 'invoices'
  | 'budgets'
  | 'audit-log'
  | 'spend-by-vendor'
  | 'spend-by-category';

@Injectable()
export class ExportService {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  private queryPurchaseOrders(organizationId: string, query: ExportQuery, scope?: ScopeConstraint) {
    const { from, to } = query;
    const rowScope = scopePredicate(scope, {
      department: sql`r.department_id`,
      project: sql`r.project_id`,
      entity: sql`po.entity_id`,
    });
    return sql`
      SELECT
        po.id,
        po.number,
        po.status,
        po.po_type            AS "poType",
        po.currency,
        po.total_amount       AS "totalAmount",
        po.version,
        po.issued_at          AS "issuedAt",
        po.created_at         AS "createdAt",
        v.name                AS "vendorName",
        v.contact_info->>'email'               AS "vendorEmail",
        d.name                AS "departmentName"
      FROM purchase_orders po
      LEFT JOIN vendors      v  ON v.id = po.vendor_id
      LEFT JOIN requisitions r  ON r.id = po.requisition_id
      LEFT JOIN departments  d  ON d.id = r.department_id
      WHERE po.organization_id = ${organizationId}
        ${from ? sql`AND po.created_at >= ${new Date(from)}` : sql``}
        ${to ? sql`AND po.created_at <= ${new Date(to + 'T23:59:59Z')}` : sql``}
        AND ${rowScope}
    `;
  }

  private queryInvoices(organizationId: string, query: ExportQuery, scope?: ScopeConstraint) {
    const { from, to } = query;
    const rowScope = scopePredicate(scope, {
      department: sql`r.department_id`,
      project: sql`r.project_id`,
      entity: sql`COALESCE(i.entity_id, po.entity_id)`,
    });
    return sql`
      SELECT
        i.id,
        i.internal_number     AS "internalNumber",
        i.invoice_number      AS "invoiceNumber",
        i.status,
        i.match_status        AS "matchStatus",
        i.currency,
        i.subtotal,
        i.tax_amount          AS "taxAmount",
        i.total_amount        AS "totalAmount",
        i.invoice_date        AS "invoiceDate",
        i.due_date            AS "dueDate",
        i.approved_at         AS "approvedAt",
        i.created_at          AS "createdAt",
        v.name                AS "vendorName",
        po.number             AS "poNumber"
      FROM invoices i
      LEFT JOIN vendors        v   ON v.id = i.vendor_id
      LEFT JOIN purchase_orders po ON po.id = i.purchase_order_id
      LEFT JOIN requisitions r ON r.id = po.requisition_id
      WHERE i.organization_id = ${organizationId}
        ${from ? sql`AND i.created_at >= ${new Date(from)}` : sql``}
        ${to ? sql`AND i.created_at <= ${new Date(to + 'T23:59:59Z')}` : sql``}
        AND ${rowScope}
    `;
  }

  private queryBudgets(organizationId: string, query: ExportQuery, scope?: ScopeConstraint) {
    const { from, to } = query;
    const rowScope = scopePredicate(scope, {
      department: sql`CASE WHEN b.budget_type = 'department' THEN b.scope_id END`,
      project: sql`CASE WHEN b.budget_type = 'project' THEN b.scope_id END`,
      entity: sql`b.entity_id`,
    });
    return sql`
      SELECT
        b.id,
        b.name,
        b.budget_type         AS "budgetType",
        b.fiscal_year         AS "fiscalYear",
        b.total_amount        AS "totalAmount",
        b.spent_amount        AS "spentAmount",
        b.currency,
        b.created_at          AS "createdAt",
        d.name                AS "departmentName",
        p.name                AS "projectName"
      FROM budgets b
      LEFT JOIN departments d
        ON b.budget_type = 'department'
       AND d.id = b.scope_id
       AND d.organization_id = b.organization_id
      LEFT JOIN projects p
        ON b.budget_type = 'project'
       AND p.id = b.scope_id
       AND p.organization_id = b.organization_id
      WHERE b.organization_id = ${organizationId}
        ${from ? sql`AND b.created_at >= ${new Date(from)}` : sql``}
        ${to ? sql`AND b.created_at <= ${new Date(to + 'T23:59:59Z')}` : sql``}
        AND ${rowScope}
    `;
  }

  private queryAuditLog(organizationId: string, query: ExportQuery, scope?: ScopeConstraint) {
    const { from, to } = query;
    const rowScope = globalOnlyPredicate(scope);
    return sql`
      SELECT
        al.id,
        al.entity_type        AS "entityType",
        al.entity_id          AS "entityId",
        al.action,
        al.user_id            AS "userId",
        al.created_at         AS "createdAt"
      FROM audit_log al
      WHERE al.organization_id = ${organizationId}
        ${from ? sql`AND al.created_at >= ${new Date(from)}` : sql``}
        ${to ? sql`AND al.created_at <= ${new Date(to + 'T23:59:59Z')}` : sql``}
        AND ${rowScope}
    `;
  }

  private querySpendByVendor(organizationId: string, query: ExportQuery, scope?: ScopeConstraint) {
    const { from, to } = query;
    const rowScope = scopePredicate(scope, {
      department: sql`r.department_id`,
      project: sql`r.project_id`,
      entity: sql`COALESCE(i.entity_id, po.entity_id)`,
    });
    return sql`
      SELECT
        v.id                              AS "vendorId",
        v.name                            AS "vendorName",
        v.contact_info->>'email'                           AS "vendorEmail",
        COUNT(DISTINCT i.id)::int         AS "invoiceCount",
        SUM(i.total_amount)::numeric      AS "totalSpend",
        MIN(i.invoice_date)               AS "firstInvoiceDate",
        MAX(i.invoice_date)               AS "lastInvoiceDate"
      FROM invoices i
      JOIN vendors v ON v.id = i.vendor_id
      LEFT JOIN purchase_orders po ON po.id = i.purchase_order_id
      LEFT JOIN requisitions r ON r.id = po.requisition_id
      WHERE i.organization_id = ${organizationId}
        AND i.status IN ('approved', 'paid')
        ${from ? sql`AND i.invoice_date >= ${new Date(from)}` : sql``}
        ${to ? sql`AND i.invoice_date <= ${new Date(to + 'T23:59:59Z')}` : sql``}
        AND ${rowScope}
      GROUP BY v.id, v.name
    `;
  }

  private querySpendByCategory(
    organizationId: string,
    query: ExportQuery,
    scope?: ScopeConstraint,
  ) {
    const { from, to } = query;
    const rowScope = scopePredicate(scope, {
      department: sql`r.department_id`,
      project: sql`r.project_id`,
      entity: sql`COALESCE(i.entity_id, po.entity_id)`,
    });
    return sql`
      SELECT
        COALESCE(il.gl_account, 'Uncategorized')   AS "glAccount",
        COUNT(DISTINCT i.id)::int                  AS "invoiceCount",
        SUM(il.total_price)::numeric               AS "totalSpend"
      FROM invoice_lines il
      JOIN invoices i ON i.id = il.invoice_id
      LEFT JOIN po_lines pl ON pl.id = il.po_line_id
      LEFT JOIN purchase_orders po ON po.id = i.purchase_order_id
      LEFT JOIN requisitions r ON r.id = po.requisition_id
      WHERE i.organization_id = ${organizationId}
        AND i.status IN ('approved', 'paid')
        ${from ? sql`AND i.invoice_date >= ${new Date(from)}` : sql``}
        ${to ? sql`AND i.invoice_date <= ${new Date(to + 'T23:59:59Z')}` : sql``}
        AND ${rowScope}
      GROUP BY il.gl_account
    `;
  }

  buildCsvForType(type: string, rows: Record<string, unknown>[]): string {
    const HEADERS: Record<string, string[]> = {
      'purchase-orders': ['id', 'number', 'status', 'poType', 'currency', 'totalAmount', 'version', 'issuedAt', 'createdAt', 'vendorName', 'vendorEmail', 'departmentName'],
      'invoices': ['id', 'internalNumber', 'invoiceNumber', 'status', 'matchStatus', 'currency', 'subtotal', 'taxAmount', 'totalAmount', 'invoiceDate', 'dueDate', 'approvedAt', 'createdAt', 'vendorName', 'poNumber'],
      'budgets': ['id', 'name', 'budgetType', 'fiscalYear', 'totalAmount', 'spentAmount', 'currency', 'createdAt', 'departmentName', 'projectName'],
      'audit-log': ['id', 'entityType', 'entityId', 'action', 'userId', 'createdAt'],
      'spend-by-vendor': ['vendorId', 'vendorName', 'vendorEmail', 'invoiceCount', 'totalSpend', 'firstInvoiceDate', 'lastInvoiceDate'],
      'spend-by-category': ['glAccount', 'invoiceCount', 'totalSpend'],
    };
    const headers = HEADERS[type] ?? Object.keys(rows[0] ?? {});
    return buildCsv(headers, rows);
  }

  normalizeQuery(query: ExportQuery): Required<Pick<ExportQuery, 'page' | 'limit'>> & ExportQuery {
    const page = query.page ?? 1;
    const limit = query.limit ?? 500;
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 1000 ||
      !Number.isSafeInteger((page - 1) * limit)
    )
      throw new BadRequestException('Invalid export page or limit');
    for (const value of [query.from, query.to]) {
      if (
        value !== undefined &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          Number.isNaN(Date.parse(value)) ||
          new Date(value).toISOString().slice(0, 10) !== value)
      ) {
        throw new BadRequestException('Export dates must use YYYY-MM-DD');
      }
    }
    return { ...query, page, limit };
  }

  private source(
    type: ExportType,
    organizationId: string,
    query: ExportQuery,
    scope?: ScopeConstraint,
  ): { query: SQL; order: SQL } {
    switch (type) {
      case 'purchase-orders':
        return {
          query: this.queryPurchaseOrders(organizationId, query, scope),
          order: sql`"createdAt" DESC, id`,
        };
      case 'invoices':
        return {
          query: this.queryInvoices(organizationId, query, scope),
          order: sql`"createdAt" DESC, id`,
        };
      case 'budgets':
        return {
          query: this.queryBudgets(organizationId, query, scope),
          order: sql`"fiscalYear" DESC, name, id`,
        };
      case 'audit-log':
        return {
          query: this.queryAuditLog(organizationId, query, scope),
          order: sql`"createdAt" DESC, id`,
        };
      case 'spend-by-vendor':
        return {
          query: this.querySpendByVendor(organizationId, query, scope),
          order: sql`"totalSpend" DESC, "vendorId"`,
        };
      case 'spend-by-category':
        return {
          query: this.querySpendByCategory(organizationId, query, scope),
          order: sql`"totalSpend" DESC, il.gl_account ASC NULLS FIRST`,
        };
    }
  }

  async getPage(
    type: ExportType,
    organizationId: string,
    query: ExportQuery,
    scope?: ScopeConstraint,
  ) {
    const normalized = this.normalizeQuery(query);
    const { page, limit } = normalized;
    const source = this.source(type, organizationId, normalized, scope);
    const [data, totals] = await Promise.all([
      this.db.execute(
        sql`${source.query} ORDER BY ${source.order} LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      ),
      this.db.execute(sql`SELECT COUNT(*)::int AS total FROM (${source.query}) export_rows`),
    ]);
    const total = Number((totals as unknown as { total: number }[])[0]?.total ?? 0);
    return {
      data: data as unknown as Record<string, unknown>[],
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  async *csvChunks(
    type: ExportType,
    organizationId: string,
    query: ExportQuery,
    scope?: ScopeConstraint,
  ) {
    const source = this.source(type, organizationId, this.normalizeQuery(query), scope);
    yield this.buildCsvForType(type, []) + '\n';
    const batchSize = 1000;
    for (let offset = 0; ; offset += batchSize) {
      const rows = (await this.db.execute(
        sql`${source.query} ORDER BY ${source.order} LIMIT ${batchSize} OFFSET ${offset}`,
      )) as unknown as Record<string, unknown>[];
      if (!rows.length) return;
      const csv = this.buildCsvForType(type, rows);
      yield csv.slice(csv.indexOf('\n') + 1) + '\n';
      if (rows.length < batchSize) return;
    }
  }
}
