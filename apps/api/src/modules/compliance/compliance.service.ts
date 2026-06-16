import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '@betterspend/db';
import { auditLog, authAccounts, authSessions, users } from '@betterspend/db';
import { DB_TOKEN } from '../../database/database.module';
import { AuditService } from '../audit/audit.service';

export type ComplianceFramework = 'soc2' | 'iso27001' | 'custom';

interface AuditPackageInput {
  framework?: ComplianceFramework;
  from?: string;
  to?: string;
}

interface DateRange {
  from: Date;
  to: Date;
}

type DataRow = Record<string, unknown>;

const FRAMEWORKS = new Set<ComplianceFramework>(['soc2', 'iso27001', 'custom']);

const AUDIT_PACKAGE_FILES = [
  'manifest.json',
  'audit-log.csv',
  'user-roster.csv',
  'approval-chain.csv',
  'data-retention-summary.json',
] as const;

@Injectable()
export class ComplianceService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly auditService: AuditService,
  ) {}

  async previewAuditPackage(organizationId: string, input: AuditPackageInput) {
    const packageData = await this.collectAuditPackageData(organizationId, input);
    return {
      manifest: packageData.manifest,
      files: AUDIT_PACKAGE_FILES,
      recentAuditEntries: packageData.auditRows.slice(0, 8),
      userRosterSample: packageData.userRoster.slice(0, 8),
      approvalSample: packageData.approvalEvidence.slice(0, 8),
      retentionSummary: packageData.retentionSummary,
    };
  }

  async generateAuditPackage(
    organizationId: string,
    actorUserId: string,
    input: AuditPackageInput,
  ) {
    await this.auditService.log(
      organizationId,
      actorUserId,
      'compliance',
      organizationId,
      'audit_package_generated',
      {},
      {
        framework: input.framework ?? 'soc2',
        from: input.from ?? null,
        to: input.to ?? null,
      },
    );

    const packageData = await this.collectAuditPackageData(organizationId, input);
    const files = [
      {
        path: 'manifest.json',
        data: JSON.stringify(packageData.manifest, null, 2),
      },
      {
        path: 'audit-log.csv',
        data: toCsv(packageData.auditRows),
      },
      {
        path: 'user-roster.csv',
        data: toCsv(packageData.userRoster),
      },
      {
        path: 'approval-chain.csv',
        data: toCsv(packageData.approvalEvidence),
      },
      {
        path: 'data-retention-summary.json',
        data: JSON.stringify(packageData.retentionSummary, null, 2),
      },
      {
        path: 'README.txt',
        data: [
          'BetterSpend audit evidence package',
          '',
          `Framework: ${packageData.manifest.framework}`,
          `Period: ${packageData.manifest.period.from} to ${packageData.manifest.period.to}`,
          '',
          'Files:',
          ...AUDIT_PACKAGE_FILES.map((file) => `- ${file}`),
        ].join('\n'),
      },
    ];

    const date = new Date().toISOString().slice(0, 10);
    return {
      filename: `betterspend-${packageData.manifest.framework}-audit-package-${date}.zip`,
      buffer: createStoredZip(files),
    };
  }

  async exportUserData(organizationId: string, actorUserId: string, subjectUserId: string) {
    const subject = await this.findSubjectUser(organizationId, subjectUserId);
    const [
      roles,
      authAccountsRows,
      sessions,
      auditEntries,
      approvalActions,
      requisitions,
      purchaseOrders,
      invoices,
    ] = await Promise.all([
      this.getSubjectRoles(subjectUserId),
      this.getSubjectAuthAccounts(subjectUserId),
      this.getSubjectSessions(subjectUserId),
      this.getSubjectAuditEntries(organizationId, subjectUserId),
      this.getSubjectApprovalActions(organizationId, subjectUserId),
      this.getSubjectRequisitions(organizationId, subjectUserId),
      this.getSubjectPurchaseOrders(organizationId, subjectUserId),
      this.getSubjectInvoices(organizationId, subjectUserId),
    ]);

    await this.auditService.log(
      organizationId,
      actorUserId,
      'user',
      subjectUserId,
      'gdpr_export_generated',
      {},
      { subjectUserId },
    );

    return {
      generatedAt: new Date().toISOString(),
      subject: {
        id: subject.id,
        name: subject.name,
        email: subject.email,
        emailVerified: subject.emailVerified,
        departmentId: subject.departmentId,
        isActive: subject.isActive,
        createdAt: subject.createdAt,
        updatedAt: subject.updatedAt,
      },
      personalData: {
        roles,
        authAccounts: authAccountsRows,
        sessions,
      },
      records: {
        requisitions,
        purchaseOrders,
        invoices,
        approvalActions,
        auditEntries,
      },
      retentionNotice:
        'Audit records are retained as immutable compliance evidence. User-facing identifiers are pseudonymized by the GDPR delete action.',
    };
  }

  async pseudonymizeUser(organizationId: string, actorUserId: string, subjectUserId: string) {
    await this.findSubjectUser(organizationId, subjectUserId);
    const pseudonymizedEmail = `deleted-${subjectUserId}@deleted.local`;

    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          name: '[deleted]',
          email: pseudonymizedEmail,
          image: null,
          isActive: false,
          updatedAt: new Date(),
        })
        .where(and(eq(users.id, subjectUserId), eq(users.organizationId, organizationId)));

      await tx
        .update(authAccounts)
        .set({
          accountId: pseudonymizedEmail,
          accessToken: null,
          refreshToken: null,
          idToken: null,
          password: null,
          updatedAt: new Date(),
        })
        .where(eq(authAccounts.userId, subjectUserId));

      await tx.delete(authSessions).where(eq(authSessions.userId, subjectUserId));
    });

    await this.auditService.log(
      organizationId,
      actorUserId,
      'user',
      subjectUserId,
      'gdpr_user_pseudonymized',
      { personalIdentifiers: 'pseudonymized', sessions: 'revoked' },
      { subjectUserId },
    );

    return {
      success: true,
      userId: subjectUserId,
      pseudonymizedEmail,
      message: 'User personal identifiers were pseudonymized and active sessions were revoked.',
    };
  }

  private async collectAuditPackageData(organizationId: string, input: AuditPackageInput) {
    const framework = normalizeFramework(input.framework);
    const range = parseDateRange(input);
    const [auditRows, userRoster, approvalEvidence, retentionSummary, auditBreakdown] =
      await Promise.all([
        this.getAuditRows(organizationId, range),
        this.getUserRoster(organizationId),
        this.getApprovalEvidence(organizationId, range),
        this.getRetentionSummary(organizationId),
        this.getAuditBreakdown(organizationId, range),
      ]);

    const manifest = {
      packageType: 'betterspend.audit_evidence',
      framework,
      generatedAt: new Date().toISOString(),
      organizationId,
      period: {
        from: range.from.toISOString(),
        to: range.to.toISOString(),
      },
      counts: {
        auditEntries: auditRows.length,
        users: userRoster.length,
        approvalEvidenceRows: approvalEvidence.length,
      },
      auditBreakdown,
      includedFiles: AUDIT_PACKAGE_FILES,
      notes: [
        'Audit log rows are immutable application events scoped to this organization.',
        'User roster includes role assignments and last known session activity when available.',
        'Approval chain evidence joins approval requests to requisitions, purchase orders, or invoices where possible.',
      ],
    };

    return {
      manifest,
      auditRows,
      userRoster,
      approvalEvidence,
      retentionSummary,
    };
  }

  private async getAuditRows(organizationId: string, range: DateRange): Promise<DataRow[]> {
    const rows = await this.db.execute(sql`
      SELECT
        id::text                         AS "id",
        user_id::text                    AS "userId",
        entity_type                      AS "entityType",
        entity_id::text                  AS "entityId",
        action                           AS "action",
        changes::text                    AS "changes",
        metadata::text                   AS "metadata",
        created_at                       AS "createdAt"
      FROM audit_log
      WHERE organization_id = ${organizationId}
        AND created_at >= ${range.from}
        AND created_at <= ${range.to}
      ORDER BY created_at DESC
    `);
    return rows as DataRow[];
  }

  private async getUserRoster(organizationId: string): Promise<DataRow[]> {
    const rows = await this.db.execute(sql`
      SELECT
        u.id::text                                               AS "id",
        u.name                                                   AS "name",
        u.email                                                  AS "email",
        u.email_verified                                         AS "emailVerified",
        u.is_active                                              AS "isActive",
        COALESCE(string_agg(DISTINCT COALESCE(cr.name, ur.role), ', '), '') AS "roles",
        MAX(s.updated_at)                                        AS "lastSessionAt",
        u.created_at                                             AS "createdAt",
        u.updated_at                                             AS "updatedAt"
      FROM users u
      LEFT JOIN user_roles ur ON ur.user_id = u.id
      LEFT JOIN custom_roles cr ON cr.id = ur.custom_role_id
      LEFT JOIN auth_sessions s ON s.user_id = u.id
      WHERE u.organization_id = ${organizationId}
      GROUP BY u.id
      ORDER BY u.name ASC
    `);
    return rows as DataRow[];
  }

  private async getApprovalEvidence(organizationId: string, range: DateRange): Promise<DataRow[]> {
    const rows = await this.db.execute(sql`
      SELECT
        ar.id::text                         AS "approvalRequestId",
        ar.approvable_type                  AS "approvableType",
        ar.approvable_id::text              AS "approvableId",
        COALESCE(r.number, po.number, i.internal_number) AS "entityNumber",
        COALESCE(r.title, po.notes, i.invoice_number)    AS "entityLabel",
        ar.status                           AS "requestStatus",
        rule.name                           AS "approvalRule",
        ar.current_step                     AS "currentStep",
        ar.created_at                       AS "requestedAt",
        ar.updated_at                       AS "requestUpdatedAt",
        aa.step_order                       AS "actionStep",
        aa.approver_id::text                AS "approverId",
        approver.email                      AS "approverEmail",
        aa.action                           AS "action",
        aa.comment                          AS "comment",
        aa.acted_at                         AS "actedAt"
      FROM approval_requests ar
      LEFT JOIN approval_rules rule ON rule.id = ar.approval_rule_id
      LEFT JOIN requisitions r
        ON ar.approvable_type = 'requisition'
       AND r.id = ar.approvable_id
      LEFT JOIN purchase_orders po
        ON ar.approvable_type = 'purchase_order'
       AND po.id = ar.approvable_id
      LEFT JOIN invoices i
        ON ar.approvable_type = 'invoice'
       AND i.id = ar.approvable_id
      LEFT JOIN approval_actions aa ON aa.approval_request_id = ar.id
      LEFT JOIN users approver ON approver.id = aa.approver_id
      WHERE COALESCE(rule.organization_id, r.organization_id, po.organization_id, i.organization_id) = ${organizationId}
        AND (
          ar.created_at BETWEEN ${range.from} AND ${range.to}
          OR aa.acted_at BETWEEN ${range.from} AND ${range.to}
        )
      ORDER BY ar.created_at DESC, aa.acted_at ASC
    `);
    return rows as DataRow[];
  }

  private async getRetentionSummary(organizationId: string) {
    const rows = await this.db.execute(sql`
      SELECT 'audit_log' AS "dataSet", COUNT(*)::int AS "recordCount", MIN(created_at) AS "oldestRecord", MAX(created_at) AS "newestRecord"
      FROM audit_log WHERE organization_id = ${organizationId}
      UNION ALL
      SELECT 'users' AS "dataSet", COUNT(*)::int AS "recordCount", MIN(created_at) AS "oldestRecord", MAX(updated_at) AS "newestRecord"
      FROM users WHERE organization_id = ${organizationId}
      UNION ALL
      SELECT 'requisitions' AS "dataSet", COUNT(*)::int AS "recordCount", MIN(created_at) AS "oldestRecord", MAX(updated_at) AS "newestRecord"
      FROM requisitions WHERE organization_id = ${organizationId}
      UNION ALL
      SELECT 'purchase_orders' AS "dataSet", COUNT(*)::int AS "recordCount", MIN(created_at) AS "oldestRecord", MAX(updated_at) AS "newestRecord"
      FROM purchase_orders WHERE organization_id = ${organizationId}
      UNION ALL
      SELECT 'invoices' AS "dataSet", COUNT(*)::int AS "recordCount", MIN(created_at) AS "oldestRecord", MAX(updated_at) AS "newestRecord"
      FROM invoices WHERE organization_id = ${organizationId}
    `);

    return {
      generatedAt: new Date().toISOString(),
      policyStatus: 'informational',
      recommendedPolicies: [
        {
          dataSet: 'audit_log',
          recommendation:
            'Retain for at least seven years or the organization-specific audit period.',
        },
        {
          dataSet: 'users',
          recommendation:
            'Retain active users indefinitely; pseudonymize departed users after legal hold review.',
        },
        {
          dataSet: 'transaction_records',
          recommendation:
            'Retain requisitions, purchase orders, invoices, and approvals for finance recordkeeping.',
        },
      ],
      dataSets: rows,
    };
  }

  private async getAuditBreakdown(organizationId: string, range: DateRange): Promise<DataRow[]> {
    const rows = await this.db.execute(sql`
      SELECT
        entity_type AS "entityType",
        action      AS "action",
        COUNT(*)::int AS "count"
      FROM audit_log
      WHERE organization_id = ${organizationId}
        AND created_at >= ${range.from}
        AND created_at <= ${range.to}
      GROUP BY entity_type, action
      ORDER BY count DESC, entity_type ASC, action ASC
    `);
    return rows as DataRow[];
  }

  private async findSubjectUser(organizationId: string, subjectUserId: string) {
    const subject = await this.db.query.users.findFirst({
      where: (user, { and, eq }) =>
        and(eq(user.id, subjectUserId), eq(user.organizationId, organizationId)),
    });
    if (!subject) throw new NotFoundException(`User ${subjectUserId} not found`);
    return subject;
  }

  private async getSubjectRoles(subjectUserId: string): Promise<DataRow[]> {
    const rows = await this.db.execute(sql`
      SELECT
        ur.id::text           AS "id",
        ur.role               AS "role",
        ur.scope_type         AS "scopeType",
        ur.scope_id::text     AS "scopeId",
        cr.name               AS "customRoleName",
        cr.permissions::text  AS "customRolePermissions",
        ur.created_at         AS "createdAt"
      FROM user_roles ur
      LEFT JOIN custom_roles cr ON cr.id = ur.custom_role_id
      WHERE ur.user_id = ${subjectUserId}
      ORDER BY ur.created_at ASC
    `);
    return rows as DataRow[];
  }

  private async getSubjectAuthAccounts(subjectUserId: string): Promise<DataRow[]> {
    const rows = await this.db.execute(sql`
      SELECT
        provider_id AS "providerId",
        account_id  AS "accountId",
        expires_at  AS "expiresAt",
        created_at  AS "createdAt",
        updated_at  AS "updatedAt"
      FROM auth_accounts
      WHERE user_id = ${subjectUserId}
      ORDER BY created_at ASC
    `);
    return rows as DataRow[];
  }

  private async getSubjectSessions(subjectUserId: string): Promise<DataRow[]> {
    const rows = await this.db.execute(sql`
      SELECT
        id          AS "id",
        expires_at  AS "expiresAt",
        ip_address  AS "ipAddress",
        user_agent  AS "userAgent",
        created_at  AS "createdAt",
        updated_at  AS "updatedAt"
      FROM auth_sessions
      WHERE user_id = ${subjectUserId}
      ORDER BY updated_at DESC
    `);
    return rows as DataRow[];
  }

  private async getSubjectAuditEntries(
    organizationId: string,
    subjectUserId: string,
  ): Promise<DataRow[]> {
    const rows = await this.db
      .select({
        id: auditLog.id,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        action: auditLog.action,
        changes: auditLog.changes,
        metadata: auditLog.metadata,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .where(and(eq(auditLog.organizationId, organizationId), eq(auditLog.userId, subjectUserId)))
      .orderBy(sql`${auditLog.createdAt} DESC`)
      .limit(1000);
    return rows as DataRow[];
  }

  private async getSubjectApprovalActions(
    organizationId: string,
    subjectUserId: string,
  ): Promise<DataRow[]> {
    const rows = await this.db.execute(sql`
      SELECT
        ar.id::text                         AS "approvalRequestId",
        ar.approvable_type                  AS "approvableType",
        ar.approvable_id::text              AS "approvableId",
        ar.status                           AS "requestStatus",
        aa.step_order                       AS "stepOrder",
        aa.action                           AS "action",
        aa.comment                          AS "comment",
        aa.acted_at                         AS "actedAt"
      FROM approval_actions aa
      INNER JOIN approval_requests ar ON ar.id = aa.approval_request_id
      LEFT JOIN approval_rules rule ON rule.id = ar.approval_rule_id
      LEFT JOIN requisitions r
        ON ar.approvable_type = 'requisition'
       AND r.id = ar.approvable_id
      LEFT JOIN purchase_orders po
        ON ar.approvable_type = 'purchase_order'
       AND po.id = ar.approvable_id
      LEFT JOIN invoices i
        ON ar.approvable_type = 'invoice'
       AND i.id = ar.approvable_id
      WHERE aa.approver_id = ${subjectUserId}
        AND COALESCE(rule.organization_id, r.organization_id, po.organization_id, i.organization_id) = ${organizationId}
      ORDER BY aa.acted_at DESC
    `);
    return rows as DataRow[];
  }

  private async getSubjectRequisitions(
    organizationId: string,
    subjectUserId: string,
  ): Promise<DataRow[]> {
    const rows = await this.db.execute(sql`
      SELECT
        id::text       AS "id",
        number         AS "number",
        title          AS "title",
        status         AS "status",
        total_amount   AS "totalAmount",
        currency       AS "currency",
        submitted_at   AS "submittedAt",
        created_at     AS "createdAt",
        updated_at     AS "updatedAt"
      FROM requisitions
      WHERE organization_id = ${organizationId}
        AND requester_id = ${subjectUserId}
      ORDER BY created_at DESC
    `);
    return rows as DataRow[];
  }

  private async getSubjectPurchaseOrders(
    organizationId: string,
    subjectUserId: string,
  ): Promise<DataRow[]> {
    const rows = await this.db.execute(sql`
      SELECT
        id::text       AS "id",
        number         AS "number",
        status         AS "status",
        total_amount   AS "totalAmount",
        currency       AS "currency",
        issued_at      AS "issuedAt",
        created_at     AS "createdAt",
        updated_at     AS "updatedAt"
      FROM purchase_orders
      WHERE organization_id = ${organizationId}
        AND issued_by = ${subjectUserId}
      ORDER BY created_at DESC
    `);
    return rows as DataRow[];
  }

  private async getSubjectInvoices(
    organizationId: string,
    subjectUserId: string,
  ): Promise<DataRow[]> {
    const rows = await this.db.execute(sql`
      SELECT
        id::text        AS "id",
        internal_number AS "internalNumber",
        invoice_number  AS "invoiceNumber",
        status          AS "status",
        total_amount    AS "totalAmount",
        currency        AS "currency",
        approved_at     AS "approvedAt",
        created_at      AS "createdAt",
        updated_at      AS "updatedAt"
      FROM invoices
      WHERE organization_id = ${organizationId}
        AND approved_by = ${subjectUserId}
      ORDER BY created_at DESC
    `);
    return rows as DataRow[];
  }
}

function normalizeFramework(framework: ComplianceFramework | undefined): ComplianceFramework {
  if (!framework) return 'soc2';
  if (!FRAMEWORKS.has(framework)) {
    throw new BadRequestException('framework must be one of: soc2, iso27001, custom');
  }
  return framework;
}

function parseDateRange(input: AuditPackageInput): DateRange {
  const to = parseDate(input.to, new Date());
  const defaultFrom = new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000);
  const from = parseDate(input.from, defaultFrom);

  if (from.getTime() > to.getTime()) {
    throw new BadRequestException('from must be before to');
  }

  return { from, to };
}

function parseDate(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestException(`Invalid date: ${value}`);
  return parsed;
}

function toCsv(rows: DataRow[]): string {
  if (!rows.length) return '';
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const escapeCell = (value: unknown) => {
    const stringValue = formatCsvValue(value);
    return /[",\n\r]/.test(stringValue) ? `"${stringValue.replace(/"/g, '""')}"` : stringValue;
  };

  return [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => escapeCell(row[header])).join(',')),
  ].join('\n');
}

function formatCsvValue(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function createStoredZip(files: Array<{ path: string; data: string | Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const fileName = Buffer.from(file.path, 'utf8');
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8');
    const crc = crc32(data);
    const timestamp = dosDateTime(new Date());

    const localHeader = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(timestamp.time),
      u16(timestamp.date),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(fileName.length),
      u16(0),
      fileName,
    ]);
    localParts.push(localHeader, data);

    const centralHeader = Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(timestamp.time),
      u16(timestamp.date),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(fileName.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      fileName,
    ]);
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const localData = Buffer.concat(localParts);
  const endRecord = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralDirectory.length),
    u32(localData.length),
    u16(0),
  ]);

  return Buffer.concat([localData, centralDirectory, endRecord]);
}

function u16(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

function dosDateTime(date: Date): { date: number; time: number } {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
}

let crcTable: Uint32Array | null = null;

function crc32(buffer: Buffer): number {
  if (!crcTable) crcTable = buildCrcTable();
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
}
