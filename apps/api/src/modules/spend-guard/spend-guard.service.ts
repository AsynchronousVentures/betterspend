import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { and, desc, eq, gte, ne, sql, type SQL } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db } from '@betterspend/db';
import { spendGuardAlerts } from '@betterspend/db';
import type { ResourceScope } from '@betterspend/shared';
import { NotificationsService } from '../notifications/notifications.service';
import { resolveOrganizationAdminId } from '../../common/demo-identity';

const DUPLICATE_LOOKBACK_DAYS = 30;
const NEAR_DUPLICATE_TOLERANCE = 0.05;
const SPLIT_REQ_WINDOW_HOURS = 6;
const SPLIT_REQ_THRESHOLD = 1_000;

type AlertSeverity = 'low' | 'medium' | 'high';
type AlertStatus = 'open' | 'dismissed' | 'escalated';

function alertScopePredicate(scope: ResourceScope | undefined): SQL | undefined {
  if (!scope || scope.unrestricted) return undefined;

  const clauses: SQL[] = [];
  for (const id of scope.departmentIds) {
    clauses.push(sql`(
      (a.record_type = 'invoice' AND EXISTS (
        SELECT 1
        FROM invoices i
        LEFT JOIN purchase_orders po ON po.id = i.purchase_order_id
        LEFT JOIN requisitions r ON r.id = po.requisition_id
        WHERE i.id = a.record_id
          AND i.organization_id = a.org_id
          AND r.department_id = ${id}
      ))
      OR (a.record_type = 'requisition' AND EXISTS (
        SELECT 1
        FROM requisitions r
        WHERE r.id = a.record_id
          AND r.organization_id = a.org_id
          AND r.department_id = ${id}
      ))
    )`);
  }
  for (const id of scope.projectIds) {
    clauses.push(sql`(
      (a.record_type = 'invoice' AND EXISTS (
        SELECT 1
        FROM invoices i
        LEFT JOIN purchase_orders po ON po.id = i.purchase_order_id
        LEFT JOIN requisitions r ON r.id = po.requisition_id
        WHERE i.id = a.record_id
          AND i.organization_id = a.org_id
          AND r.project_id = ${id}
      ))
      OR (a.record_type = 'requisition' AND EXISTS (
        SELECT 1
        FROM requisitions r
        WHERE r.id = a.record_id
          AND r.organization_id = a.org_id
          AND r.project_id = ${id}
      ))
    )`);
  }
  for (const id of scope.entityIds) {
    clauses.push(sql`(
      (a.record_type = 'invoice' AND EXISTS (
        SELECT 1
        FROM invoices i
        LEFT JOIN purchase_orders po ON po.id = i.purchase_order_id
        WHERE i.id = a.record_id
          AND i.organization_id = a.org_id
          AND COALESCE(i.entity_id, po.entity_id) = ${id}
      ))
      OR (a.record_type = 'requisition' AND EXISTS (
        SELECT 1
        FROM requisitions r
        JOIN purchase_orders po ON po.requisition_id = r.id
        WHERE r.id = a.record_id
          AND r.organization_id = a.org_id
          AND po.organization_id = a.org_id
          AND po.entity_id = ${id}
      ))
    )`);
  }

  return clauses.length > 0 ? sql`(${sql.join(clauses, sql` OR `)})` : sql`false`;
}

@Injectable()
export class SpendGuardService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  async list(
    orgId: string,
    status: AlertStatus | 'all' = 'open',
    scope?: ResourceScope,
  ) {
    const rowScope = alertScopePredicate(scope);

    return this.db.query.spendGuardAlerts.findMany({
      where: (alert, operators) => {
        const scopedAlertId = rowScope
          ? sql`${alert.id} IN (
              SELECT a.id
              FROM spend_guard_alerts a
              WHERE a.org_id = ${orgId}
                AND ${rowScope}
            )`
          : undefined;
        return status === 'all'
          ? operators.and(operators.eq(alert.orgId, orgId), scopedAlertId)
          : operators.and(
              operators.eq(alert.orgId, orgId),
              operators.eq(alert.status, status),
              scopedAlertId,
            );
      },
      orderBy: (alert) => [desc(alert.createdAt)],
    });
  }

  async updateStatus(
    id: string,
    orgId: string,
    userId: string,
    status: Exclude<AlertStatus, 'open'>,
    note?: string,
    scope?: ResourceScope,
  ) {
    const rowScope = alertScopePredicate(scope);
    const scopedAlertId = rowScope
      ? sql`${spendGuardAlerts.id} IN (
          SELECT a.id
          FROM spend_guard_alerts a
          WHERE a.org_id = ${orgId}
            AND ${rowScope}
        )`
      : undefined;

    const [updated] = await this.db
      .update(spendGuardAlerts)
      .set({
        status,
        note: note?.trim() || null,
        resolvedAt: new Date(),
        resolvedBy: userId,
        updatedAt: new Date(),
      })
      .where(and(eq(spendGuardAlerts.id, id), eq(spendGuardAlerts.orgId, orgId), scopedAlertId))
      .returning();

    if (!updated) throw new NotFoundException(`Spend guard alert ${id} not found`);
    return updated;
  }

  async countOpen(orgId: string) {
    const rows = await this.db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(spendGuardAlerts)
      .where(and(eq(spendGuardAlerts.orgId, orgId), eq(spendGuardAlerts.status, 'open')));
    return rows[0]?.count ?? 0;
  }

  async analyzeInvoice(orgId: string, invoiceId: string) {
    const invoice = await this.db.query.invoices.findFirst({
      where: (record, operators) => and(eq(record.id, invoiceId), eq(record.organizationId, orgId)),
      with: { vendor: { columns: { punchoutConfig: false } } },
    });
    if (!invoice) return [];

    const alerts: string[] = [];
    const invoiceDate = new Date(invoice.invoiceDate ?? invoice.createdAt ?? new Date());
    const cutoff = new Date(invoiceDate);
    cutoff.setDate(cutoff.getDate() - DUPLICATE_LOOKBACK_DAYS);

    const duplicateCandidates = await this.db.query.invoices.findMany({
      where: (record, operators) =>
        and(
          eq(record.organizationId, orgId),
          eq(record.vendorId, invoice.vendorId),
          ne(record.id, invoice.id),
          gte(record.invoiceDate, cutoff),
        ),
      orderBy: (record) => [desc(record.invoiceDate)],
      limit: 20,
    });

    const exactAmountMatch = duplicateCandidates.find(
      (candidate) => Number(candidate.totalAmount ?? 0) === Number(invoice.totalAmount ?? 0),
    );
    if (exactAmountMatch) {
      await this.createAlert(orgId, {
        alertType: 'duplicate_invoice_amount',
        severity: 'high',
        recordType: 'invoice',
        recordId: invoice.id,
        details: {
          invoiceNumber: invoice.invoiceNumber,
          vendorId: invoice.vendorId,
          vendorName: invoice.vendor?.name ?? null,
          totalAmount: invoice.totalAmount,
          matchedInvoiceId: exactAmountMatch.id,
          matchedInvoiceNumber: exactAmountMatch.invoiceNumber,
        },
      });
      alerts.push('duplicate_invoice_amount');
    }

    const nearDuplicate = duplicateCandidates.find((candidate) => {
      const amount = Number(invoice.totalAmount ?? 0);
      const otherAmount = Number(candidate.totalAmount ?? 0);
      if (amount <= 0 || otherAmount <= 0) return false;
      return Math.abs(otherAmount - amount) / amount <= NEAR_DUPLICATE_TOLERANCE;
    });
    if (nearDuplicate) {
      await this.createAlert(orgId, {
        alertType: 'near_duplicate_invoice',
        severity: 'medium',
        recordType: 'invoice',
        recordId: invoice.id,
        details: {
          invoiceNumber: invoice.invoiceNumber,
          vendorId: invoice.vendorId,
          vendorName: invoice.vendor?.name ?? null,
          totalAmount: invoice.totalAmount,
          matchedInvoiceId: nearDuplicate.id,
          matchedInvoiceNumber: nearDuplicate.invoiceNumber,
          matchedAmount: nearDuplicate.totalAmount,
        },
      });
      alerts.push('near_duplicate_invoice');
    }

    const hour = invoiceDate.getUTCHours();
    if (hour >= 22 || hour < 5) {
      await this.createAlert(orgId, {
        alertType: 'off_hours_submission',
        severity: 'low',
        recordType: 'invoice',
        recordId: invoice.id,
        details: {
          invoiceNumber: invoice.invoiceNumber,
          vendorId: invoice.vendorId,
          vendorName: invoice.vendor?.name ?? null,
          createdAt: invoiceDate.toISOString(),
          evaluatedTimezone: 'UTC',
        },
      });
      alerts.push('off_hours_submission');
    }

    return alerts;
  }

  async analyzeRequisition(orgId: string, requisitionId: string) {
    const requisition = await this.db.query.requisitions.findFirst({
      where: (record, operators) =>
        and(eq(record.id, requisitionId), eq(record.organizationId, orgId)),
      with: { lines: true },
    });
    if (!requisition || !requisition.lines?.length) return [];

    const alerts: string[] = [];
    const createdAt = new Date(requisition.createdAt ?? new Date());
    const vendorIds = Array.from(
      new Set(requisition.lines.map((line) => line.vendorId).filter(Boolean)),
    ) as string[];
    const cutoff = new Date(createdAt);
    cutoff.setHours(cutoff.getHours() - SPLIT_REQ_WINDOW_HOURS);

    for (const vendorId of vendorIds) {
      const rows = await this.db.execute(sql`
        SELECT
          r.id,
          r.number,
          r.total_amount::numeric AS total_amount
        FROM requisitions r
        JOIN requisition_lines rl ON rl.requisition_id = r.id
        WHERE r.organization_id = ${orgId}
          AND r.requester_id = ${requisition.requesterId}
          AND r.id <> ${requisition.id}
          AND rl.vendor_id = ${vendorId}
          AND r.created_at >= ${cutoff}
        GROUP BY r.id, r.number, r.total_amount
      `);
      const total = rows.reduce(
        (sum: number, row: any) => sum + Number(row.total_amount ?? 0),
        Number(requisition.totalAmount ?? 0),
      );
      if (total > SPLIT_REQ_THRESHOLD && rows.length > 0) {
        const vendor = await this.db.query.vendors.findFirst({
          where: (record, operators) => eq(record.id, vendorId),
        });
        await this.createAlert(orgId, {
          alertType: 'split_requisition',
          severity: 'high',
          recordType: 'requisition',
          recordId: requisition.id,
          details: {
            requisitionNumber: requisition.number,
            requesterId: requisition.requesterId,
            vendorId,
            vendorName: vendor?.name ?? null,
            relatedRequisitionIds: rows.map((row: any) => row.id),
            combinedAmount: total.toFixed(2),
            windowHours: SPLIT_REQ_WINDOW_HOURS,
            threshold: SPLIT_REQ_THRESHOLD,
          },
        });
        alerts.push('split_requisition');
      }
    }

    const hour = createdAt.getUTCHours();
    if (hour >= 22 || hour < 5) {
      await this.createAlert(orgId, {
        alertType: 'off_hours_submission',
        severity: 'low',
        recordType: 'requisition',
        recordId: requisition.id,
        details: {
          requisitionNumber: requisition.number,
          requesterId: requisition.requesterId,
          createdAt: createdAt.toISOString(),
          evaluatedTimezone: 'UTC',
        },
      });
      alerts.push('off_hours_submission');
    }

    return alerts;
  }

  private async createAlert(
    orgId: string,
    input: {
      alertType: string;
      severity: AlertSeverity;
      recordType: string;
      recordId: string;
      details: Record<string, unknown>;
    },
  ) {
    const existing = await this.db.query.spendGuardAlerts.findFirst({
      where: (record, operators) =>
        operators.and(
          operators.eq(record.orgId, orgId),
          operators.eq(record.recordType, input.recordType),
          operators.eq(record.recordId, input.recordId),
          operators.eq(record.alertType, input.alertType),
          operators.eq(record.status, 'open'),
        ),
    });
    if (existing) return existing;

    const [created] = await this.db
      .insert(spendGuardAlerts)
      .values({
        orgId,
        alertType: input.alertType,
        severity: input.severity,
        recordType: input.recordType,
        recordId: input.recordId,
        details: input.details,
        status: 'open',
      })
      .returning();

    if (this.notifications) {
      const adminId = await resolveOrganizationAdminId(this.db, orgId).catch(() => null);
      if (adminId) {
        await this.notifications
          .create(
            orgId,
            adminId,
            'spend_guard_alert',
            'Spend Guard Alert',
            `${this.humanize(input.alertType)} detected on ${input.recordType}.`,
            input.recordType,
            input.recordId,
          )
          .catch(() => {});
      }
    }

    return created;
  }

  private humanize(value: string) {
    return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  }
}
