import { Injectable, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '@betterspend/db';

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

function paginate<T>(items: T[], page: number, limit: number): { data: T[]; total: number; page: number; limit: number; pages: number } {
  const total = items.length;
  const pages = Math.ceil(total / limit);
  const data = items.slice((page - 1) * limit, page * limit);
  return { data, total, page, limit, pages };
}

@Injectable()
export class ExportService {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  async getPurchaseOrders(organizationId: string, query: ExportQuery) {
    const { from, to } = query;
    const rows = await this.db.execute(sql`
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
        v.email               AS "vendorEmail",
        d.name                AS "departmentName"
      FROM purchase_orders po
      LEFT JOIN vendors      v  ON v.id = po.vendor_id
      LEFT JOIN requisitions r  ON r.id = po.requisition_id
      LEFT JOIN departments  d  ON d.id = r.department_id
      WHERE po.organization_id = ${organizationId}
        ${from ? sql`AND po.created_at >= ${new Date(from)}` : sql``}
        ${to ? sql`AND po.created_at <= ${new Date(to + 'T23:59:59Z')}` : sql``}
      ORDER BY po.created_at DESC
    `);
    return rows as Record<string, unknown>[];
  }

  async getInvoices(organizationId: string, query: ExportQuery) {
    const { from, to } = query;
    const rows = await this.db.execute(sql`
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
      WHERE i.organization_id = ${organizationId}
        ${from ? sql`AND i.created_at >= ${new Date(from)}` : sql``}
        ${to ? sql`AND i.created_at <= ${new Date(to + 'T23:59:59Z')}` : sql``}
      ORDER BY i.created_at DESC
    `);
    return rows as Record<string, unknown>[];
  }

  async getBudgets(organizationId: string, query: ExportQuery) {
    const { from, to } = query;
    const rows = await this.db.execute(sql`
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
      LEFT JOIN departments d ON d.id = b.department_id
      LEFT JOIN projects    p ON p.id = b.project_id
      WHERE b.organization_id = ${organizationId}
        ${from ? sql`AND b.created_at >= ${new Date(from)}` : sql``}
        ${to ? sql`AND b.created_at <= ${new Date(to + 'T23:59:59Z')}` : sql``}
      ORDER BY b.fiscal_year DESC, b.name ASC
    `);
    return rows as Record<string, unknown>[];
  }

  async getAuditLog(organizationId: string, query: ExportQuery) {
    const { from, to } = query;
    const rows = await this.db.execute(sql`
      SELECT
        al.id,
        al.entity_type        AS "entityType",
        al.entity_id          AS "entityId",
        al.action,
        al.user_id            AS "userId",
        al.ip_address         AS "ipAddress",
        al.created_at         AS "createdAt"
      FROM audit_log al
      WHERE al.organization_id = ${organizationId}
        ${from ? sql`AND al.created_at >= ${new Date(from)}` : sql``}
        ${to ? sql`AND al.created_at <= ${new Date(to + 'T23:59:59Z')}` : sql``}
      ORDER BY al.created_at DESC
    `);
    return rows as Record<string, unknown>[];
  }

  async getSpendByVendor(organizationId: string, query: ExportQuery) {
    const { from, to } = query;
    const rows = await this.db.execute(sql`
      SELECT
        v.id                              AS "vendorId",
        v.name                            AS "vendorName",
        v.email                           AS "vendorEmail",
        COUNT(DISTINCT i.id)::int         AS "invoiceCount",
        SUM(i.total_amount)::numeric      AS "totalSpend",
        MIN(i.invoice_date)               AS "firstInvoiceDate",
        MAX(i.invoice_date)               AS "lastInvoiceDate"
      FROM invoices i
      JOIN vendors v ON v.id = i.vendor_id
      WHERE i.organization_id = ${organizationId}
        AND i.status IN ('approved', 'paid')
        ${from ? sql`AND i.invoice_date >= ${new Date(from)}` : sql``}
        ${to ? sql`AND i.invoice_date <= ${new Date(to + 'T23:59:59Z')}` : sql``}
      GROUP BY v.id, v.name, v.email
      ORDER BY "totalSpend" DESC
    `);
    return rows as Record<string, unknown>[];
  }

  async getSpendByCategory(organizationId: string, query: ExportQuery) {
    const { from, to } = query;
    const rows = await this.db.execute(sql`
      SELECT
        COALESCE(il.gl_account, 'Uncategorized')   AS "glAccount",
        COUNT(DISTINCT i.id)::int                  AS "invoiceCount",
        SUM(il.total_price)::numeric               AS "totalSpend"
      FROM invoice_lines il
      JOIN invoices i ON i.id = il.invoice_id
      WHERE i.organization_id = ${organizationId}
        AND i.status IN ('approved', 'paid')
        ${from ? sql`AND i.invoice_date >= ${new Date(from)}` : sql``}
        ${to ? sql`AND i.invoice_date <= ${new Date(to + 'T23:59:59Z')}` : sql``}
      GROUP BY il.gl_account
      ORDER BY "totalSpend" DESC
    `);
    return rows as Record<string, unknown>[];
  }

  buildCsvForType(type: string, rows: Record<string, unknown>[]): string {
    const HEADERS: Record<string, string[]> = {
      'purchase-orders': ['id', 'number', 'status', 'poType', 'currency', 'totalAmount', 'version', 'issuedAt', 'createdAt', 'vendorName', 'vendorEmail', 'departmentName'],
      'invoices': ['id', 'internalNumber', 'invoiceNumber', 'status', 'matchStatus', 'currency', 'subtotal', 'taxAmount', 'totalAmount', 'invoiceDate', 'dueDate', 'approvedAt', 'createdAt', 'vendorName', 'poNumber'],
      'budgets': ['id', 'name', 'budgetType', 'fiscalYear', 'totalAmount', 'spentAmount', 'currency', 'createdAt', 'departmentName', 'projectName'],
      'audit-log': ['id', 'entityType', 'entityId', 'action', 'userId', 'ipAddress', 'createdAt'],
      'spend-by-vendor': ['vendorId', 'vendorName', 'vendorEmail', 'invoiceCount', 'totalSpend', 'firstInvoiceDate', 'lastInvoiceDate'],
      'spend-by-category': ['glAccount', 'invoiceCount', 'totalSpend'],
    };
    const headers = HEADERS[type] ?? Object.keys(rows[0] ?? {});
    return buildCsv(headers, rows);
  }

  paginateRows(rows: Record<string, unknown>[], page: number, limit: number) {
    return paginate(rows, page, limit);
  }
}
