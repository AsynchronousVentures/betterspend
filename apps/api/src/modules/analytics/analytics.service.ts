import { Injectable, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '@betterspend/db';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class AnalyticsService {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  /** Spend by vendor (from approved invoices) */
  async spendByVendor(organizationId: string) {
    const rows = await this.db.execute(sql`
      SELECT
        v.id          AS "vendorId",
        v.name        AS "vendorName",
        SUM(i.total_amount)::numeric               AS total,
        COUNT(DISTINCT i.id)::int                  AS "invoiceCount"
      FROM invoices i
      JOIN vendors v ON v.id = i.vendor_id
      WHERE i.organization_id = ${organizationId}
        AND i.status = 'approved'
      GROUP BY v.id, v.name
      ORDER BY total DESC
      LIMIT 20
    `);
    return rows;
  }

  /** Spend by department (from active POs, via requisition link) */
  async spendByDepartment(organizationId: string) {
    const rows = await this.db.execute(sql`
      SELECT
        COALESCE(d.name, 'Unassigned')             AS department,
        SUM(po.total_amount)::numeric              AS total,
        COUNT(DISTINCT po.id)::int                 AS "poCount"
      FROM purchase_orders po
      LEFT JOIN requisitions r  ON r.id = po.requisition_id
      LEFT JOIN departments  d  ON d.id = r.department_id
      WHERE po.organization_id = ${organizationId}
        AND po.status NOT IN ('draft', 'cancelled')
      GROUP BY d.name
      ORDER BY total DESC
    `);
    return rows;
  }

  /** Monthly spend trend (last 12 months, from approved invoices) */
  async monthlySpend(organizationId: string) {
    const rows = await this.db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', i.invoice_date), 'YYYY-MM') AS month,
        SUM(i.total_amount)::numeric                             AS total,
        COUNT(DISTINCT i.id)::int                                AS "invoiceCount"
      FROM invoices i
      WHERE i.organization_id = ${organizationId}
        AND i.status = 'approved'
        AND i.invoice_date >= NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', i.invoice_date)
      ORDER BY month ASC
    `);
    return rows;
  }

  /** Invoice aging (unpaid invoices grouped by age bucket) */
  async invoiceAging(organizationId: string) {
    const rows = await this.db.execute(sql`
      SELECT
        CASE
          WHEN NOW() - i.due_date <= INTERVAL '30 days'  THEN '0-30 days'
          WHEN NOW() - i.due_date <= INTERVAL '60 days'  THEN '31-60 days'
          WHEN NOW() - i.due_date <= INTERVAL '90 days'  THEN '61-90 days'
          ELSE 'Over 90 days'
        END AS bucket,
        COUNT(*)::int                                      AS count,
        SUM(i.total_amount)::numeric                       AS total
      FROM invoices i
      WHERE i.organization_id = ${organizationId}
        AND i.status NOT IN ('approved', 'cancelled')
        AND i.due_date IS NOT NULL
      GROUP BY bucket
      ORDER BY
        CASE bucket
          WHEN '0-30 days'    THEN 1
          WHEN '31-60 days'   THEN 2
          WHEN '61-90 days'   THEN 3
          ELSE 4
        END
    `);
    return rows;
  }

  /** PO cycle time: avg days from draft to issued */
  async poCycleTime(organizationId: string) {
    const rows = await this.db.execute(sql`
      SELECT
        AVG(EXTRACT(EPOCH FROM (po.issued_at - po.created_at)) / 86400)::numeric AS "avgDays",
        MIN(EXTRACT(EPOCH FROM (po.issued_at - po.created_at)) / 86400)::numeric AS "minDays",
        MAX(EXTRACT(EPOCH FROM (po.issued_at - po.created_at)) / 86400)::numeric AS "maxDays",
        COUNT(*)::int AS "poCount"
      FROM purchase_orders po
      WHERE po.organization_id = ${organizationId}
        AND po.issued_at IS NOT NULL
    `);
    return rows[0] ?? { avgDays: null, minDays: null, maxDays: null, poCount: 0 };
  }

  /** High-level KPIs */
  async kpis(organizationId: string) {
    const [poRow, reqRow, invoiceRow, budgetRow] = await Promise.all([
      this.db.execute(sql`
        SELECT
          COUNT(*)::int                                                             AS total,
          SUM(CASE WHEN status NOT IN ('draft','cancelled') THEN 1 ELSE 0 END)::int AS active,
          COALESCE(SUM(total_amount), 0)::numeric                                   AS "totalValue"
        FROM purchase_orders
        WHERE organization_id = ${organizationId}
      `),
      this.db.execute(sql`
        SELECT COUNT(*)::int AS total FROM requisitions
        WHERE organization_id = ${organizationId}
          AND status NOT IN ('draft','cancelled')
      `),
      this.db.execute(sql`
        SELECT
          COUNT(*)::int                                                                     AS total,
          COALESCE(SUM(CASE WHEN status = 'approved' THEN total_amount::numeric ELSE 0 END), 0) AS paid,
          COALESCE(SUM(CASE WHEN status != 'approved' THEN total_amount::numeric ELSE 0 END), 0) AS pending
        FROM invoices WHERE organization_id = ${organizationId}
      `),
      this.db.execute(sql`
        SELECT COALESCE(SUM(total_amount), 0)::numeric AS "totalBudget"
        FROM budgets WHERE organization_id = ${organizationId}
          AND fiscal_year = EXTRACT(YEAR FROM NOW())::int
      `),
    ]);

    return {
      purchaseOrders: poRow[0] ?? {},
      requisitions: reqRow[0] ?? {},
      invoices: invoiceRow[0] ?? {},
      budgets: budgetRow[0] ?? {},
    };
  }

  /** Items requiring action */
  async pendingItems(organizationId: string) {
    const [approvalRow, invoiceRow, reqRow, grnRow, overdueRow, spendGuardRow, renewalRow] = await Promise.all([
      this.db.execute(sql`
        SELECT COUNT(ar.id)::int AS count
        FROM approval_requests ar
        JOIN requisitions r ON r.id = ar.approvable_id AND ar.approvable_type = 'requisition'
        WHERE r.organization_id = ${organizationId} AND ar.status = 'pending'
        UNION ALL
        SELECT COUNT(ar.id)::int AS count
        FROM approval_requests ar
        JOIN purchase_orders po ON po.id = ar.approvable_id AND ar.approvable_type = 'purchase_order'
        WHERE po.organization_id = ${organizationId} AND ar.status = 'pending'
      `),
      this.db.execute(sql`
        SELECT COUNT(*)::int AS count FROM invoices
        WHERE organization_id = ${organizationId}
          AND status IN ('exception', 'partial_match')
      `),
      this.db.execute(sql`
        SELECT COUNT(*)::int AS count FROM requisitions
        WHERE organization_id = ${organizationId}
          AND status = 'pending_approval'
      `),
      this.db.execute(sql`
        SELECT COUNT(DISTINCT po.id)::int AS count
        FROM purchase_orders po
        WHERE po.organization_id = ${organizationId}
          AND po.status = 'issued'
          AND NOT EXISTS (
            SELECT 1 FROM goods_receipts gr
            WHERE gr.purchase_order_id = po.id
          )
      `),
      this.db.execute(sql`
        SELECT COUNT(*)::int AS count FROM invoices
        WHERE organization_id = ${organizationId}
          AND status NOT IN ('approved', 'paid', 'cancelled')
          AND due_date IS NOT NULL
          AND due_date < NOW()
      `),
      this.db.execute(sql`
        SELECT COUNT(*)::int AS count FROM spend_guard_alerts
        WHERE org_id = ${organizationId}
          AND status = 'open'
      `),
      this.db.execute(sql`
        SELECT COUNT(*)::int AS count FROM software_licenses
        WHERE organization_id = ${organizationId}
          AND status IN ('active', 'renewal_due')
          AND renewal_date IS NOT NULL
          AND renewal_date <= NOW() + INTERVAL '30 days'
      `),
    ]);

    const pendingApprovals = (approvalRow as any[]).reduce(
      (sum: number, r: any) => sum + Number(r.count ?? 0),
      0,
    );

    return {
      pendingApprovals,
      invoiceExceptions: Number((invoiceRow as any[])[0]?.count ?? 0),
      requisitionsPendingApproval: Number((reqRow as any[])[0]?.count ?? 0),
      posAwaitingReceipt: Number((grnRow as any[])[0]?.count ?? 0),
      overdueInvoices: Number((overdueRow as any[])[0]?.count ?? 0),
      spendGuardAlerts: Number((spendGuardRow as any[])[0]?.count ?? 0),
      upcomingSoftwareRenewals: Number((renewalRow as any[])[0]?.count ?? 0),
    };
  }

  /** Vendor performance metrics */
  async vendorPerformance(organizationId: string) {
    const rows = await this.db.execute(sql`
      SELECT
        v.id                                                                   AS "vendorId",
        v.name                                                                 AS "vendorName",
        COUNT(DISTINCT i.id)::int                                              AS "invoiceCount",
        COUNT(DISTINCT CASE WHEN i.match_status = 'exception' THEN i.id END)::int AS "exceptionCount",
        ROUND(
          COUNT(DISTINCT CASE WHEN i.match_status = 'exception' THEN i.id END)::numeric
          / NULLIF(COUNT(DISTINCT i.id), 0) * 100, 1
        )                                                                      AS "exceptionRate",
        ROUND(AVG(
          CASE WHEN i.status = 'approved' AND i.due_date IS NOT NULL
            THEN EXTRACT(EPOCH FROM (i.updated_at - i.invoice_date)) / 86400
          END
        )::numeric, 1)                                                         AS "avgDaysToApprove",
        COALESCE(SUM(CASE WHEN i.status = 'approved' THEN i.total_amount END), 0)::numeric AS "totalApproved",
        COUNT(DISTINCT po.id)::int                                             AS "poCount"
      FROM vendors v
      LEFT JOIN invoices i  ON i.vendor_id = v.id AND i.organization_id = ${organizationId}
      LEFT JOIN purchase_orders po ON po.vendor_id = v.id AND po.organization_id = ${organizationId}
      WHERE v.organization_id = ${organizationId}
      GROUP BY v.id, v.name
      HAVING COUNT(DISTINCT i.id) > 0 OR COUNT(DISTINCT po.id) > 0
      ORDER BY "totalApproved" DESC
      LIMIT 50
    `);
    return rows;
  }

  /** Budget utilization across all active budgets */
  async budgetUtilization(organizationId: string) {
    const rows = await this.db.execute(sql`
      SELECT
        b.id                                                   AS "budgetId",
        b.name                                                 AS "budgetName",
        b.budget_type                                          AS "budgetType",
        b.fiscal_year                                          AS "fiscalYear",
        b.total_amount::numeric                                AS "totalAmount",
        b.spent_amount::numeric                                AS "spentAmount",
        ROUND((b.spent_amount / NULLIF(b.total_amount, 0)) * 100, 1) AS "utilizationPct",
        (b.total_amount - b.spent_amount)::numeric             AS "remaining",
        d.name                                                 AS "departmentName",
        p.name                                                 AS "projectName"
      FROM budgets b
      LEFT JOIN departments d ON d.id = b.department_id
      LEFT JOIN projects    p ON p.id = b.project_id
      WHERE b.organization_id = ${organizationId}
        AND b.fiscal_year = EXTRACT(YEAR FROM NOW())::int
      ORDER BY "utilizationPct" DESC NULLS LAST
    `);
    return rows;
  }

  /** Spend by GL/catalog category (from approved invoices via invoice lines → PO lines → catalog items) */
  async spendByCategory(organizationId: string) {
    return this.db.execute(sql`
      SELECT
        COALESCE(ci.category, 'Uncategorized') AS category,
        SUM(il.total_price::numeric)           AS total,
        COUNT(DISTINCT i.id)::int              AS "invoiceCount",
        COUNT(il.id)::int                      AS "lineCount"
      FROM invoice_lines il
      JOIN invoices i ON i.id = il.invoice_id
      LEFT JOIN po_lines pl ON pl.id = il.po_line_id
      LEFT JOIN catalog_items ci ON ci.id = pl.catalog_item_id
      WHERE i.organization_id = ${organizationId}
        AND i.status IN ('approved', 'paid')
      GROUP BY ci.category
      ORDER BY total DESC
      LIMIT 20
    `);
  }

  /** Spend anomaly detection: vendors with invoice amount > 2x their rolling 3-month average */
  async spendAnomalies(organizationId: string) {
    return this.db.execute(sql`
      WITH monthly_vendor_spend AS (
        SELECT
          v.id   AS "vendorId",
          v.name AS "vendorName",
          DATE_TRUNC('month', i.invoice_date) AS month,
          SUM(i.total_amount::numeric)        AS monthly_total
        FROM invoices i
        JOIN vendors v ON v.id = i.vendor_id
        WHERE i.organization_id = ${organizationId}
          AND i.status IN ('approved', 'paid')
          AND i.invoice_date >= NOW() - INTERVAL '6 months'
        GROUP BY v.id, v.name, DATE_TRUNC('month', i.invoice_date)
      ),
      vendor_stats AS (
        SELECT
          "vendorId",
          "vendorName",
          AVG(monthly_total)    AS avg_monthly,
          STDDEV(monthly_total) AS stddev_monthly,
          MAX(monthly_total)    AS max_monthly,
          MAX(month)            AS latest_month,
          COUNT(*)              AS month_count
        FROM monthly_vendor_spend
        GROUP BY "vendorId", "vendorName"
      )
      SELECT
        "vendorId",
        "vendorName",
        ROUND(avg_monthly, 2)    AS "avgMonthlySpend",
        ROUND(max_monthly, 2)    AS "maxMonthlySpend",
        ROUND(max_monthly / NULLIF(avg_monthly, 0), 2) AS "peakToAvgRatio",
        month_count              AS "monthsOfData"
      FROM vendor_stats
      WHERE month_count >= 2
        AND max_monthly > avg_monthly * 2
        AND max_monthly > 1000
      ORDER BY "peakToAvgRatio" DESC
      LIMIT 10
    `);
  }

  /** Top spending categories for current quarter vs previous quarter */
  async categoryTrend(organizationId: string) {
    return this.db.execute(sql`
      WITH quarterly AS (
        SELECT
          COALESCE(ci.category, 'Uncategorized') AS category,
          CASE
            WHEN i.invoice_date >= DATE_TRUNC('quarter', NOW()) THEN 'current'
            WHEN i.invoice_date >= DATE_TRUNC('quarter', NOW()) - INTERVAL '3 months' THEN 'previous'
          END AS period,
          SUM(il.total_price::numeric) AS total
        FROM invoice_lines il
        JOIN invoices i ON i.id = il.invoice_id
        LEFT JOIN po_lines pl ON pl.id = il.po_line_id
        LEFT JOIN catalog_items ci ON ci.id = pl.catalog_item_id
        WHERE i.organization_id = ${organizationId}
          AND i.status IN ('approved', 'paid')
          AND i.invoice_date >= DATE_TRUNC('quarter', NOW()) - INTERVAL '3 months'
        GROUP BY ci.category, period
      )
      SELECT
        category,
        MAX(CASE WHEN period = 'current' THEN total ELSE 0 END)  AS "currentQtr",
        MAX(CASE WHEN period = 'previous' THEN total ELSE 0 END) AS "previousQtr"
      FROM quarterly
      WHERE period IS NOT NULL
      GROUP BY category
      ORDER BY "currentQtr" DESC
      LIMIT 10
    `);
  }

  /** Recent activity from audit log */
  async recentActivity(organizationId: string, limit = 20) {
    return this.db.execute(sql`
      SELECT
        al.id,
        al.action,
        al.entity_type AS "entityType",
        al.entity_id AS "entityId",
        al.changes,
        al.created_at AS "createdAt",
        u.name AS "userName"
      FROM audit_log al
      LEFT JOIN users u ON u.id = al.user_id
      WHERE al.organization_id = ${organizationId}
      ORDER BY al.created_at DESC
      LIMIT ${limit}
    `);
  }
}
