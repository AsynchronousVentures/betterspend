import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '@betterspend/db';
import type { AccessPolicy } from '../auth/access-policy';
import { scopedEntityPredicate } from '../auth/operational-access';

type Db = NodePgDatabase<typeof schema>;

export interface ScorecardSummary {
  vendorId: string;
  vendorName: string;
  overallScore: number;
  deliveryScore: number;
  qualityScore: number;
  priceScore: number;
  invoiceAccuracyScore: number;
  totalPos: number;
  totalInvoices: number;
}

export interface ScorecardDetail {
  vendor: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    status: string;
  };
  scores: {
    overallScore: number;
    deliveryScore: number;
    qualityScore: number;
    priceScore: number;
    invoiceAccuracyScore: number;
    totalPos: number;
    totalInvoices: number;
  };
  trend: Array<{
    month: string;
    invoiceAccuracy: number;
    priceScore: number;
  }>;
  recentPos: Array<{
    id: string;
    poNumber: string;
    status: string;
    totalAmount: string;
    issuedAt: string | null;
    expectedDeliveryDate: string | null;
  }>;
  recentInvoices: Array<{
    id: string;
    invoiceNumber: string;
    status: string;
    matchStatus: string | null;
    totalAmount: string;
    invoiceDate: string;
  }>;
}

function computeOverallScore(
  deliveryScore: number,
  invoiceAccuracyScore: number,
  priceScore: number,
  qualityScore: number,
): number {
  return Math.round(
    deliveryScore * 0.3 + invoiceAccuracyScore * 0.3 + priceScore * 0.25 + qualityScore * 0.15,
  );
}

@Injectable()
export class SupplierScorecardService {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  async listScores(
    organizationId: string,
    limit = 50,
    access?: AccessPolicy,
  ): Promise<ScorecardSummary[]> {
    const vendorScope =
      scopedEntityPredicate(access, 'vendor', 'vendors:view', sql.raw('v.entity_id')) ?? sql``;
    const rows = await this.db.execute(sql`
      WITH vendor_pos AS (
        SELECT
          v.id                         AS vendor_id,
          v.name                       AS vendor_name,
          COUNT(DISTINCT po.id)::int   AS total_pos
      FROM vendors v
        LEFT JOIN purchase_orders po
          ON po.vendor_id = v.id
          AND po.organization_id = ${organizationId}
      WHERE v.organization_id = ${organizationId}
        AND v.status = 'active'
        AND ${vendorScope}
        GROUP BY v.id, v.name
      ),
      vendor_invoices AS (
        SELECT
          i.vendor_id,
          COUNT(DISTINCT i.id)::int                                          AS total_invoices,
          COALESCE(
            ROUND(
              COUNT(DISTINCT CASE WHEN i.match_status = 'full_match' THEN i.id END)::numeric
              / NULLIF(COUNT(DISTINCT i.id), 0) * 100, 1
            ), 0
          )                                                                  AS invoice_accuracy_score
        FROM invoices i
        WHERE i.organization_id = ${organizationId}
        GROUP BY i.vendor_id
      ),
      vendor_delivery AS (
        SELECT
          gr.vendor_id,
          COALESCE(
            ROUND(
              COUNT(DISTINCT CASE WHEN gr.received_at::date <= po.expected_delivery_date THEN gr.id END)::numeric
              / NULLIF(COUNT(DISTINCT gr.id), 0) * 100, 1
            ), 100
          )                                                                  AS delivery_score
        FROM goods_receipts gr
        JOIN purchase_orders po ON po.id = gr.purchase_order_id
        WHERE gr.organization_id = ${organizationId}
          AND po.expected_delivery_date IS NOT NULL
        GROUP BY gr.vendor_id
      ),
      vendor_price AS (
        SELECT
          mr.vendor_id,
          COALESCE(
            GREATEST(
              0,
              100 - ROUND(AVG(ABS(mr.price_variance_pct::numeric)) * 10, 1)
            ), 100
          )                                                                  AS price_score
        FROM match_results mr
        WHERE mr.organization_id = ${organizationId}
          AND mr.price_variance_pct IS NOT NULL
        GROUP BY mr.vendor_id
      )
      SELECT
        vp.vendor_id                                  AS "vendorId",
        vp.vendor_name                                AS "vendorName",
        COALESCE(vi.total_invoices, 0)                AS "totalInvoices",
        vp.total_pos                                  AS "totalPos",
        COALESCE(vi.invoice_accuracy_score, 0)::int   AS "invoiceAccuracyScore",
        COALESCE(vd.delivery_score, 100)::int         AS "deliveryScore",
        85::int                                       AS "qualityScore",
        COALESCE(vpr.price_score, 100)::int           AS "priceScore"
      FROM vendor_pos vp
      LEFT JOIN vendor_invoices vi  ON vi.vendor_id  = vp.vendor_id
      LEFT JOIN vendor_delivery vd  ON vd.vendor_id  = vp.vendor_id
      LEFT JOIN vendor_price    vpr ON vpr.vendor_id = vp.vendor_id
      WHERE vp.total_pos > 0 OR COALESCE(vi.total_invoices, 0) > 0
      ORDER BY (
        COALESCE(vd.delivery_score, 100) * 0.3 +
        COALESCE(vi.invoice_accuracy_score, 0) * 0.3 +
        COALESCE(vpr.price_score, 100) * 0.25 +
        85 * 0.15
      ) DESC
      LIMIT ${limit}
    `);

    return (rows as any[]).map((r) => ({
      vendorId: r.vendorId,
      vendorName: r.vendorName,
      totalInvoices: Number(r.totalInvoices),
      totalPos: Number(r.totalPos),
      deliveryScore: Number(r.deliveryScore),
      qualityScore: Number(r.qualityScore),
      priceScore: Number(r.priceScore),
      invoiceAccuracyScore: Number(r.invoiceAccuracyScore),
      overallScore: computeOverallScore(
        Number(r.deliveryScore),
        Number(r.invoiceAccuracyScore),
        Number(r.priceScore),
        Number(r.qualityScore),
      ),
    }));
  }

  async getDetail(
    organizationId: string,
    vendorId: string,
    access?: AccessPolicy,
  ): Promise<ScorecardDetail> {
    const vendorScope =
      scopedEntityPredicate(access, 'vendor', 'vendors:view', sql.raw('entity_id')) ?? sql`true`;
    const relatedVendorScope =
      scopedEntityPredicate(access, 'vendor', 'vendors:view', sql.raw('v.entity_id')) ?? sql`true`;
    // Vendor info
    const vendorRows = await this.db.execute(sql`
      SELECT id, name, email, phone, status
      FROM vendors
      WHERE id = ${vendorId} AND organization_id = ${organizationId}
        AND ${vendorScope}
      LIMIT 1
    `);

    if ((vendorRows as any[]).length === 0) {
      throw new NotFoundException(`Vendor ${vendorId} not found`);
    }

    const vendor = (vendorRows as any[])[0];

    // Scores
    const [invoiceRows, deliveryRows, priceRows, poCountRows, invoiceCountRows] = await Promise.all(
      [
        // Invoice accuracy
        this.db.execute(sql`
        SELECT
          COUNT(DISTINCT i.id)::int AS total_invoices,
          COALESCE(
            ROUND(
              COUNT(DISTINCT CASE WHEN i.match_status = 'full_match' THEN i.id END)::numeric
              / NULLIF(COUNT(DISTINCT i.id), 0) * 100, 1
            ), 0
          ) AS invoice_accuracy_score
        FROM invoices i
        JOIN vendors v
          ON v.id = i.vendor_id
          AND v.organization_id = i.organization_id
        WHERE i.organization_id = ${organizationId}
          AND i.vendor_id = ${vendorId}
          AND ${relatedVendorScope}
      `),
        // Delivery score
        this.db.execute(sql`
        SELECT
          COALESCE(
            ROUND(
              COUNT(DISTINCT CASE WHEN gr.received_at::date <= po.expected_delivery_date THEN gr.id END)::numeric
              / NULLIF(COUNT(DISTINCT gr.id), 0) * 100, 1
            ), 100
          ) AS delivery_score
        FROM goods_receipts gr
        JOIN purchase_orders po ON po.id = gr.purchase_order_id
        JOIN vendors v
          ON v.id = gr.vendor_id
          AND v.organization_id = gr.organization_id
        WHERE gr.organization_id = ${organizationId}
          AND gr.vendor_id = ${vendorId}
          AND po.expected_delivery_date IS NOT NULL
          AND ${relatedVendorScope}
      `),
        // Price score
        this.db.execute(sql`
        SELECT
          COALESCE(
            GREATEST(
              0,
              100 - ROUND(AVG(ABS(mr.price_variance_pct::numeric)) * 10, 1)
            ), 100
          ) AS price_score
        FROM match_results mr
        JOIN vendors v
          ON v.id = mr.vendor_id
          AND v.organization_id = mr.organization_id
        WHERE mr.organization_id = ${organizationId}
          AND mr.vendor_id = ${vendorId}
          AND mr.price_variance_pct IS NOT NULL
          AND ${relatedVendorScope}
      `),
        // PO count
        this.db.execute(sql`
        SELECT COUNT(*)::int AS total_pos
        FROM purchase_orders po
        JOIN vendors v
          ON v.id = po.vendor_id
          AND v.organization_id = po.organization_id
        WHERE po.organization_id = ${organizationId}
          AND po.vendor_id = ${vendorId}
          AND ${relatedVendorScope}
      `),
        // Invoice count (redundant but cleaner)
        this.db.execute(sql`
        SELECT COUNT(*)::int AS total_invoices
        FROM invoices i
        JOIN vendors v
          ON v.id = i.vendor_id
          AND v.organization_id = i.organization_id
        WHERE i.organization_id = ${organizationId}
          AND i.vendor_id = ${vendorId}
          AND ${relatedVendorScope}
      `),
      ],
    );

    const deliveryScore = Number((deliveryRows as any[])[0]?.delivery_score ?? 100);
    const invoiceAccuracyScore = Number((invoiceRows as any[])[0]?.invoice_accuracy_score ?? 0);
    const priceScore = Number((priceRows as any[])[0]?.price_score ?? 100);
    const qualityScore = 85;
    const totalPos = Number((poCountRows as any[])[0]?.total_pos ?? 0);
    const totalInvoices = Number((invoiceCountRows as any[])[0]?.total_invoices ?? 0);
    const overallScore = computeOverallScore(
      deliveryScore,
      invoiceAccuracyScore,
      priceScore,
      qualityScore,
    );

    // 6-month trend (invoice accuracy + price score by month)
    const trendRows = await this.db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', i.invoice_date), 'YYYY-MM') AS month,
        COALESCE(
          ROUND(
            COUNT(DISTINCT CASE WHEN i.match_status = 'full_match' THEN i.id END)::numeric
            / NULLIF(COUNT(DISTINCT i.id), 0) * 100, 1
          ), 0
        ) AS invoice_accuracy,
        COALESCE(
          GREATEST(
            0,
            100 - ROUND(AVG(ABS(mr.price_variance_pct::numeric)) * 10, 1)
          ), 100
        ) AS price_score_monthly
      FROM invoices i
      JOIN vendors v
        ON v.id = i.vendor_id
        AND v.organization_id = i.organization_id
      LEFT JOIN match_results mr ON mr.vendor_id = i.vendor_id
        AND mr.organization_id = i.organization_id
        AND DATE_TRUNC('month', mr.matched_at) = DATE_TRUNC('month', i.invoice_date)
      WHERE i.organization_id = ${organizationId}
        AND i.vendor_id = ${vendorId}
        AND i.invoice_date >= NOW() - INTERVAL '6 months'
        AND ${relatedVendorScope}
      GROUP BY DATE_TRUNC('month', i.invoice_date)
      ORDER BY month ASC
    `);

    // Recent POs (last 5)
    const recentPoRows = await this.db.execute(sql`
      SELECT
        po.id,
        po.po_number AS "poNumber",
        po.status,
        po.total_amount::numeric AS "totalAmount",
        po.issued_at AS "issuedAt",
        po.expected_delivery_date AS "expectedDeliveryDate"
      FROM purchase_orders po
      JOIN vendors v
        ON v.id = po.vendor_id
        AND v.organization_id = po.organization_id
      WHERE po.organization_id = ${organizationId}
        AND po.vendor_id = ${vendorId}
        AND ${relatedVendorScope}
      ORDER BY po.created_at DESC
      LIMIT 5
    `);

    // Recent invoices (last 5)
    const recentInvoiceRows = await this.db.execute(sql`
      SELECT
        i.id,
        i.invoice_number AS "invoiceNumber",
        i.status,
        i.match_status AS "matchStatus",
        i.total_amount::numeric AS "totalAmount",
        i.invoice_date AS "invoiceDate"
      FROM invoices i
      JOIN vendors v
        ON v.id = i.vendor_id
        AND v.organization_id = i.organization_id
      WHERE i.organization_id = ${organizationId}
        AND i.vendor_id = ${vendorId}
        AND ${relatedVendorScope}
      ORDER BY i.created_at DESC
      LIMIT 5
    `);

    return {
      vendor: {
        id: vendor.id,
        name: vendor.name,
        email: vendor.email ?? null,
        phone: vendor.phone ?? null,
        status: vendor.status,
      },
      scores: {
        overallScore,
        deliveryScore,
        qualityScore,
        priceScore,
        invoiceAccuracyScore,
        totalPos,
        totalInvoices,
      },
      trend: (trendRows as any[]).map((r) => ({
        month: r.month,
        invoiceAccuracy: Number(r.invoice_accuracy),
        priceScore: Number(r.price_score_monthly),
      })),
      recentPos: (recentPoRows as any[]).map((r) => ({
        id: r.id,
        poNumber: r.poNumber,
        status: r.status,
        totalAmount: String(r.totalAmount),
        issuedAt: r.issuedAt ? String(r.issuedAt) : null,
        expectedDeliveryDate: r.expectedDeliveryDate ? String(r.expectedDeliveryDate) : null,
      })),
      recentInvoices: (recentInvoiceRows as any[]).map((r) => ({
        id: r.id,
        invoiceNumber: r.invoiceNumber,
        status: r.status,
        matchStatus: r.matchStatus ?? null,
        totalAmount: String(r.totalAmount),
        invoiceDate: String(r.invoiceDate),
      })),
    };
  }
}
