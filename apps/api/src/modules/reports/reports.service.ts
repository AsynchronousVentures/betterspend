import { Injectable, Inject } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import { savedReports, type Db } from '@betterspend/db';
import { scopePredicate, type ScopeConstraint } from '../auth/scope-sql';

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(',')),
  ];
  return lines.join('\n');
}

export interface SavedReport {
  id: string;
  organizationId: string;
  name: string;
  reportType: string;
  filters: Record<string, unknown>;
  groupBy?: string;
  createdAt: string;
}

export interface CustomReportParams {
  reportType: string;
  startDate?: string;
  endDate?: string;
  groupBy?: string;
}

function reportFilters(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toSavedReport(row: typeof savedReports.$inferSelect): SavedReport {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    reportType: row.reportType,
    filters: reportFilters(row.filters),
    groupBy: row.groupBy ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class ReportsService {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  // ─── Saved Reports CRUD ───────────────────────────────────────────────────

  async listSavedReports(organizationId: string): Promise<SavedReport[]> {
    const rows = await this.db
      .select()
      .from(savedReports)
      .where(eq(savedReports.organizationId, organizationId))
      .orderBy(asc(savedReports.createdAt));
    return rows.map(toSavedReport);
  }

  async saveReport(
    organizationId: string,
    data: { name: string; reportType: string; filters: Record<string, unknown>; groupBy?: string },
  ): Promise<SavedReport> {
    const [report] = await this.db
      .insert(savedReports)
      .values({
        organizationId,
        name: data.name,
        reportType: data.reportType,
        filters: data.filters ?? {},
        groupBy: data.groupBy ?? null,
      })
      .returning();
    return toSavedReport(report);
  }

  async deleteSavedReport(organizationId: string, id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(savedReports)
      .where(and(eq(savedReports.id, id), eq(savedReports.organizationId, organizationId)))
      .returning({ id: savedReports.id });
    return deleted.length > 0;
  }

  // ─── Custom Report Runner ─────────────────────────────────────────────────

  async runCustomReport(
    orgId: string,
    params: CustomReportParams,
    scope?: ScopeConstraint,
  ): Promise<Record<string, unknown>[]> {
    switch (params.reportType) {
      case 'spend_by_vendor':
        return this.customSpendByVendor(orgId, params, scope);
      case 'spend_by_department':
        return this.customSpendByDepartment(orgId, params, scope);
      case 'spend_by_category':
        return this.customSpendByCategory(orgId, params, scope);
      case 'po_status_summary':
        return this.customPoStatusSummary(orgId, params, scope);
      case 'invoice_aging':
        return this.customInvoiceAging(orgId, params, scope);
      case 'approval_cycle_time':
        return this.customApprovalCycleTime(orgId, params, scope);
      default:
        return [];
    }
  }

  private async customSpendByVendor(
    orgId: string,
    params: CustomReportParams,
    scope?: ScopeConstraint,
  ): Promise<Record<string, unknown>[]> {
    const startDate = params.startDate ?? null;
    const endDate = params.endDate ?? null;
    const rowScope = scopePredicate(scope, {
      department: sql`r.department_id`,
      project: sql`r.project_id`,
      entity: sql`COALESCE(i.entity_id, po.entity_id)`,
    });
    const rows = await this.db.execute(sql`
      SELECT
        v.name                                       AS "vendor",
        v.code                                       AS "vendorCode",
        COUNT(DISTINCT i.id)::int                    AS "invoiceCount",
        SUM(i.total_amount)::numeric                 AS "totalSpend",
        MIN(i.invoice_date)::text                    AS "firstInvoice",
        MAX(i.invoice_date)::text                    AS "lastInvoice"
      FROM invoices i
      JOIN vendors v ON v.id = i.vendor_id
      LEFT JOIN purchase_orders po ON po.id = i.purchase_order_id
      LEFT JOIN requisitions r ON r.id = po.requisition_id
      WHERE i.organization_id = ${orgId}
        AND i.status NOT IN ('cancelled')
        AND ${rowScope}
        ${startDate ? sql`AND i.created_at >= ${startDate}::timestamptz` : sql``}
        ${endDate ? sql`AND i.created_at <= ${endDate}::timestamptz` : sql``}
      GROUP BY v.id, v.name, v.code
      ORDER BY "totalSpend" DESC NULLS LAST
    `);
    return rows as Record<string, unknown>[];
  }

  private async customSpendByDepartment(
    orgId: string,
    params: CustomReportParams,
    scope?: ScopeConstraint,
  ): Promise<Record<string, unknown>[]> {
    const startDate = params.startDate ?? null;
    const endDate = params.endDate ?? null;
    const rowScope = scopePredicate(scope, {
      department: sql`r.department_id`,
      project: sql`r.project_id`,
      entity: sql`po.entity_id`,
    });
    const rows = await this.db.execute(sql`
      SELECT
        COALESCE(d.name, 'Unassigned')               AS "department",
        COUNT(DISTINCT po.id)::int                   AS "poCount",
        SUM(po.total_amount)::numeric                AS "totalSpend"
      FROM purchase_orders po
      LEFT JOIN requisitions r  ON r.id = po.requisition_id
      LEFT JOIN departments  d  ON d.id = r.department_id
      WHERE po.organization_id = ${orgId}
        AND po.status NOT IN ('draft', 'cancelled')
        AND ${rowScope}
        ${startDate ? sql`AND po.created_at >= ${startDate}::timestamptz` : sql``}
        ${endDate ? sql`AND po.created_at <= ${endDate}::timestamptz` : sql``}
      GROUP BY d.name
      ORDER BY "totalSpend" DESC NULLS LAST
    `);
    return rows as Record<string, unknown>[];
  }

  private async customSpendByCategory(
    orgId: string,
    params: CustomReportParams,
    scope?: ScopeConstraint,
  ): Promise<Record<string, unknown>[]> {
    const startDate = params.startDate ?? null;
    const endDate = params.endDate ?? null;
    const rowScope = scopePredicate(scope, {
      department: sql`r.department_id`,
      project: sql`r.project_id`,
      entity: sql`COALESCE(i.entity_id, po.entity_id)`,
    });
    const rows = await this.db.execute(sql`
      SELECT
        COALESCE(ci.category, 'Uncategorized')       AS "category",
        COUNT(DISTINCT il.id)::int                   AS "lineCount",
        SUM(il.total_price)::numeric                 AS "totalSpend"
      FROM invoice_lines il
      JOIN invoices i ON i.id = il.invoice_id
      LEFT JOIN catalog_items ci ON ci.id = il.catalog_item_id
      LEFT JOIN po_lines pl ON pl.id = il.po_line_id
      LEFT JOIN purchase_orders po ON po.id = i.purchase_order_id
      LEFT JOIN requisitions r ON r.id = po.requisition_id
      WHERE i.organization_id = ${orgId}
        AND i.status NOT IN ('cancelled')
        AND ${rowScope}
        ${startDate ? sql`AND i.created_at >= ${startDate}::timestamptz` : sql``}
        ${endDate ? sql`AND i.created_at <= ${endDate}::timestamptz` : sql``}
      GROUP BY ci.category
      ORDER BY "totalSpend" DESC NULLS LAST
    `);
    return rows as Record<string, unknown>[];
  }

  private async customPoStatusSummary(
    orgId: string,
    params: CustomReportParams,
    scope?: ScopeConstraint,
  ): Promise<Record<string, unknown>[]> {
    const startDate = params.startDate ?? null;
    const endDate = params.endDate ?? null;
    const rowScope = scopePredicate(scope, {
      department: sql`r.department_id`,
      project: sql`r.project_id`,
      entity: sql`po.entity_id`,
    });
    const rows = await this.db.execute(sql`
      SELECT
        po.status                                    AS "status",
        COUNT(*)::int                                AS "count",
        SUM(po.total_amount)::numeric                AS "totalAmount"
      FROM purchase_orders po
      LEFT JOIN requisitions r ON r.id = po.requisition_id
      WHERE po.organization_id = ${orgId}
        AND ${rowScope}
        ${startDate ? sql`AND po.created_at >= ${startDate}::timestamptz` : sql``}
        ${endDate ? sql`AND po.created_at <= ${endDate}::timestamptz` : sql``}
      GROUP BY po.status
      ORDER BY "count" DESC
    `);
    return rows as Record<string, unknown>[];
  }

  private async customInvoiceAging(
    orgId: string,
    _params: CustomReportParams,
    scope?: ScopeConstraint,
  ): Promise<Record<string, unknown>[]> {
    const rowScope = scopePredicate(scope, {
      department: sql`r.department_id`,
      project: sql`r.project_id`,
      entity: sql`COALESCE(i.entity_id, po.entity_id)`,
    });
    const rows = await this.db.execute(sql`
      SELECT
        CASE
          WHEN i.due_date IS NULL OR i.due_date > NOW() THEN 'Current (<30d)'
          WHEN NOW() - i.due_date <= INTERVAL '30 days'  THEN 'Current (<30d)'
          WHEN NOW() - i.due_date <= INTERVAL '60 days'  THEN '30-60 days'
          WHEN NOW() - i.due_date <= INTERVAL '90 days'  THEN '60-90 days'
          ELSE '>90 days'
        END                                          AS "agingBucket",
        COUNT(*)::int                                AS "invoiceCount",
        SUM(i.total_amount)::numeric                 AS "totalAmount"
      FROM invoices i
      LEFT JOIN purchase_orders po ON po.id = i.purchase_order_id
      LEFT JOIN requisitions r ON r.id = po.requisition_id
      WHERE i.organization_id = ${orgId}
        AND i.status NOT IN ('paid', 'cancelled')
        AND ${rowScope}
      GROUP BY "agingBucket"
      ORDER BY "agingBucket"
    `);
    return rows as Record<string, unknown>[];
  }

  private async customApprovalCycleTime(
    orgId: string,
    params: CustomReportParams,
    scope?: ScopeConstraint,
  ): Promise<Record<string, unknown>[]> {
    const startDate = params.startDate ?? null;
    const endDate = params.endDate ?? null;
    const groupBy = params.groupBy ?? 'month';

    let periodExpr: ReturnType<typeof sql>;
    if (groupBy === 'quarter') {
      periodExpr = sql`TO_CHAR(DATE_TRUNC('quarter', r.created_at), 'YYYY"Q"Q')`;
    } else {
      periodExpr = sql`TO_CHAR(DATE_TRUNC('month', r.created_at), 'YYYY-MM')`;
    }

    const rowScope = scopePredicate(scope, {
      department: sql`r.department_id`,
      project: sql`r.project_id`,
      entity: sql`po.entity_id`,
    });
    const rows = await this.db.execute(sql`
      SELECT
        ${periodExpr}                                AS "period",
        COUNT(DISTINCT po.id)::int                   AS "poCount",
        ROUND(AVG(EXTRACT(EPOCH FROM (po.issued_at - r.created_at)) / 86400)::numeric, 1) AS "avgCycleDays"
      FROM purchase_orders po
      JOIN requisitions r ON r.id = po.requisition_id
      WHERE po.organization_id = ${orgId}
        AND po.issued_at IS NOT NULL
        AND ${rowScope}
        ${startDate ? sql`AND r.created_at >= ${startDate}::timestamptz` : sql``}
        ${endDate ? sql`AND r.created_at <= ${endDate}::timestamptz` : sql``}
      GROUP BY "period"
      ORDER BY "period"
    `);
    return rows as Record<string, unknown>[];
  }

  // ─── Existing CSV exports (preserved) ─────────────────────────────────────

  async exportPOs(
    organizationId: string,
    status?: string,
    scope?: ScopeConstraint,
  ): Promise<string> {
    const rowScope = scopePredicate(scope, {
      department: sql`r.department_id`,
      project: sql`r.project_id`,
      entity: sql`po.entity_id`,
    });
    const rows = await this.db.execute(sql`
      SELECT
        po.internal_number AS "PO Number",
        v.name             AS "Vendor",
        po.status          AS "Status",
        po.currency        AS "Currency",
        po.total_amount    AS "Total Amount",
        po.issued_at       AS "Issued At",
        po.created_at      AS "Created At"
      FROM purchase_orders po
      LEFT JOIN vendors v ON v.id = po.vendor_id
      LEFT JOIN requisitions r ON r.id = po.requisition_id
      WHERE po.organization_id = ${organizationId}
        AND ${rowScope}
        ${status ? sql`AND po.status = ${status}` : sql``}
      ORDER BY po.created_at DESC
    `);
    return toCsv(rows as Record<string, unknown>[]);
  }

  async exportInvoices(
    organizationId: string,
    status?: string,
    scope?: ScopeConstraint,
  ): Promise<string> {
    const rowScope = scopePredicate(scope, {
      department: sql`r.department_id`,
      project: sql`r.project_id`,
      entity: sql`COALESCE(i.entity_id, po.entity_id)`,
    });
    const rows = await this.db.execute(sql`
      SELECT
        i.internal_number  AS "Invoice Number",
        i.invoice_number   AS "Vendor Invoice #",
        v.name             AS "Vendor",
        po.internal_number AS "PO Number",
        i.status           AS "Status",
        i.match_status     AS "Match Status",
        i.currency         AS "Currency",
        i.total_amount     AS "Total Amount",
        i.invoice_date     AS "Invoice Date",
        i.due_date         AS "Due Date",
        i.approved_at      AS "Approved At",
        i.created_at       AS "Created At"
      FROM invoices i
      LEFT JOIN vendors v ON v.id = i.vendor_id
      LEFT JOIN purchase_orders po ON po.id = i.purchase_order_id
      LEFT JOIN requisitions r ON r.id = po.requisition_id
      WHERE i.organization_id = ${organizationId}
        AND ${rowScope}
        ${status ? sql`AND i.status = ${status}` : sql``}
      ORDER BY i.created_at DESC
    `);
    return toCsv(rows as Record<string, unknown>[]);
  }

  async exportRequisitions(organizationId: string, scope?: ScopeConstraint): Promise<string> {
    const rowScope = scopePredicate(scope, {
      department: sql`r.department_id`,
      project: sql`r.project_id`,
    });
    const rows = await this.db.execute(sql`
      SELECT
        r.internal_number AS "REQ Number",
        r.title           AS "Title",
        r.status          AS "Status",
        r.priority        AS "Priority",
        r.currency        AS "Currency",
        r.total_amount    AS "Total Amount",
        d.name            AS "Department",
        r.created_at      AS "Created At"
      FROM requisitions r
      LEFT JOIN departments d ON d.id = r.department_id
      WHERE r.organization_id = ${organizationId}
        AND ${rowScope}
      ORDER BY r.created_at DESC
    `);
    return toCsv(rows as Record<string, unknown>[]);
  }

  async exportSpendSummary(organizationId: string, scope?: ScopeConstraint): Promise<string> {
    const rowScope = scopePredicate(scope, {
      department: sql`r.department_id`,
      project: sql`r.project_id`,
      entity: sql`COALESCE(i.entity_id, po.entity_id)`,
    });
    const rows = await this.db.execute(sql`
      SELECT
        v.name             AS "Vendor",
        v.code             AS "Vendor Code",
        COUNT(DISTINCT i.id)::int AS "Invoice Count",
        SUM(i.total_amount)::numeric AS "Total Spend",
        MIN(i.invoice_date) AS "First Invoice",
        MAX(i.invoice_date) AS "Last Invoice"
      FROM invoices i
      JOIN vendors v ON v.id = i.vendor_id
      LEFT JOIN purchase_orders po ON po.id = i.purchase_order_id
      LEFT JOIN requisitions r ON r.id = po.requisition_id
      WHERE i.organization_id = ${organizationId}
        AND i.status = 'approved'
        AND ${rowScope}
      GROUP BY v.id, v.name, v.code
      ORDER BY "Total Spend" DESC
    `);
    return toCsv(rows as Record<string, unknown>[]);
  }

  async exportBudgets(organizationId: string, scope?: ScopeConstraint): Promise<string> {
    const rowScope = scopePredicate(scope, {
      department: sql`CASE WHEN b.budget_type = 'department' THEN b.scope_id END`,
      project: sql`CASE WHEN b.budget_type = 'project' THEN b.scope_id END`,
      entity: sql`b.entity_id`,
    });
    const rows = await this.db.execute(sql`
      SELECT
        b.name            AS "Budget Name",
        b.budget_type     AS "Type",
        b.fiscal_year     AS "Fiscal Year",
        b.total_amount    AS "Allocated",
        b.spent_amount    AS "Spent",
        (b.total_amount - b.spent_amount)::numeric AS "Remaining",
        ROUND((b.spent_amount / NULLIF(b.total_amount, 0)) * 100, 1) AS "Utilization %",
        b.currency        AS "Currency",
        d.name            AS "Department",
        p.name            AS "Project",
        b.created_at      AS "Created At"
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
        AND ${rowScope}
      ORDER BY b.fiscal_year DESC, "Utilization %" DESC
    `);
    return toCsv(rows as Record<string, unknown>[]);
  }

  async exportDepartmentSpend(organizationId: string, scope?: ScopeConstraint): Promise<string> {
    const rowScope = scopePredicate(scope, {
      department: sql`COALESCE(d.id, r.department_id)`,
      project: sql`r.project_id`,
      entity: sql`po.entity_id`,
    });
    const rows = await this.db.execute(sql`
      SELECT
        COALESCE(d.name, 'Unassigned')             AS "Department",
        COUNT(DISTINCT po.id)::int                  AS "PO Count",
        SUM(po.total_amount)::numeric               AS "PO Total",
        COUNT(DISTINCT r.id)::int                   AS "Requisition Count",
        SUM(r.total_amount)::numeric                AS "Req Total"
      FROM departments d
      FULL OUTER JOIN requisitions r ON r.department_id = d.id AND r.organization_id = ${organizationId}
      LEFT JOIN purchase_orders po ON po.requisition_id = r.id
        AND po.status NOT IN ('draft', 'cancelled')
      WHERE (d.organization_id = ${organizationId} OR r.organization_id = ${organizationId})
        AND ${rowScope}
      GROUP BY d.name
      ORDER BY "PO Total" DESC NULLS LAST
    `);
    return toCsv(rows as Record<string, unknown>[]);
  }

  async exportApAging(organizationId: string, scope?: ScopeConstraint): Promise<string> {
    const rowScope = scopePredicate(scope, {
      department: sql`r.department_id`,
      project: sql`r.project_id`,
      entity: sql`COALESCE(i.entity_id, po.entity_id)`,
    });
    const rows = await this.db.execute(sql`
      SELECT
        i.internal_number      AS "Invoice Number",
        i.invoice_number       AS "Vendor Invoice #",
        v.name                 AS "Vendor",
        i.status               AS "Status",
        i.due_date             AS "Due Date",
        i.total_amount         AS "Amount",
        CASE
          WHEN i.due_date IS NULL THEN 'No Due Date'
          WHEN NOW() - i.due_date <= INTERVAL '30 days'  THEN '0-30 days overdue'
          WHEN NOW() - i.due_date <= INTERVAL '60 days'  THEN '31-60 days overdue'
          WHEN NOW() - i.due_date <= INTERVAL '90 days'  THEN '61-90 days overdue'
          ELSE 'Over 90 days overdue'
        END                    AS "Aging Bucket",
        EXTRACT(EPOCH FROM (NOW() - i.due_date))::int / 86400 AS "Days Overdue"
      FROM invoices i
      LEFT JOIN vendors v ON v.id = i.vendor_id
      LEFT JOIN purchase_orders po ON po.id = i.purchase_order_id
      LEFT JOIN requisitions r ON r.id = po.requisition_id
      WHERE i.organization_id = ${organizationId}
        AND i.status NOT IN ('approved', 'paid', 'cancelled')
        AND (i.due_date IS NULL OR i.due_date < NOW())
        AND ${rowScope}
      ORDER BY i.due_date ASC NULLS LAST
    `);
    return toCsv(rows as Record<string, unknown>[]);
  }

  async exportGrnSummary(organizationId: string, scope?: ScopeConstraint): Promise<string> {
    const rowScope = scopePredicate(scope, {
      department: sql`r.department_id`,
      project: sql`r.project_id`,
      entity: sql`po.entity_id`,
    });
    const rows = await this.db.execute(sql`
      SELECT
        gr.grn_number                 AS "GRN Number",
        po.internal_number            AS "PO Number",
        v.name                        AS "Vendor",
        gr.status                     AS "Status",
        gr.received_at                AS "Received At",
        u.name                        AS "Received By",
        COUNT(grl.id)::int            AS "Line Count",
        SUM(grl.quantity_received)::numeric AS "Total Qty Received"
      FROM goods_receipts gr
      JOIN purchase_orders po ON po.id = gr.purchase_order_id
      LEFT JOIN requisitions r ON r.id = po.requisition_id
      LEFT JOIN vendors v ON v.id = po.vendor_id
      LEFT JOIN users u ON u.id = gr.received_by
      LEFT JOIN goods_receipt_lines grl ON grl.goods_receipt_id = gr.id
      WHERE gr.organization_id = ${organizationId}
        AND ${rowScope}
      GROUP BY gr.id, gr.grn_number, po.internal_number, v.name, gr.status, gr.received_at, u.name
      ORDER BY gr.received_at DESC
    `);
    return toCsv(rows as Record<string, unknown>[]);
  }

  toCsvPublic(rows: Record<string, unknown>[]): string {
    return toCsv(rows);
  }
}
