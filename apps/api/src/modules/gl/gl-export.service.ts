import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHash, randomUUID } from 'crypto';
import { and, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { syncRecords, type Db } from '@betterspend/db';
import type { ResourceScope } from '@betterspend/shared';
import { DB_TOKEN } from '../../database/database.module';
import { GlMappingsService } from './gl-mappings.service';
import { OAuthService } from './oauth.service';
import { QboClientService, QboConnectionRequiredError } from './qbo-client.service';
import { XeroClientService, XeroConnectionRequiredError } from './xero-client.service';
import {
  ExternalEntityMappingsService,
  type ExternalMappingResolution,
  type ExternalMappingResolver,
} from './external-entity-mappings.service';

export type GlTargetSystem = 'qbo' | 'xero';

export interface GlExportLine {
  lineNumber: number;
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  glAccount: string | null;
  externalAccountCode: string | null;
  externalAccountName: string | null;
  unmapped: boolean;
}

export interface GlExportPayload {
  invoiceId: string;
  internalNumber: string;
  invoiceNumber: string;
  vendorName: string;
  invoiceDate: string;
  dueDate: string | null;
  currency: string;
  totalAmount: number;
  lines: GlExportLine[];
  unmappedAccounts: string[];
  qboDepartmentId: string | null;
  qboClassId: string | null;
  qboConnectionId: string | null;
  qboRealmId: string | null;
  unmappedQboClass: boolean;
}

type SendOutcome =
  | { kind: 'pending'; reason: string }
  | { kind: 'synced'; externalId: string; connectionId: string };

type XeroInvoiceResponse = { Invoices?: Array<{ InvoiceID?: string }> };

function invoiceScopePredicate(scope: ResourceScope | undefined): SQL | undefined {
  if (!scope || scope.unrestricted) return undefined;
  if (scope.ownOnly) return sql`false`;

  const clauses: SQL[] = [
    ...scope.departmentIds.map((id) => sql`r.department_id = ${id}`),
    ...scope.projectIds.map((id) => sql`r.project_id = ${id}`),
    ...scope.entityIds.map((id) => sql`COALESCE(i.entity_id, po.entity_id) = ${id}`),
  ];
  return clauses.length > 0 ? sql`(${sql.join(clauses, sql` OR `)})` : sql`false`;
}

@Injectable()
export class GlExportService {
  private readonly logger = new Logger(GlExportService.name);

  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly glMappingsService: GlMappingsService,
    private readonly oauthService: OAuthService,
    private readonly qboClient: QboClientService,
    @InjectQueue('gl-export') private readonly glQueue: Queue,
    private readonly xeroClient: XeroClientService,
    @Inject(ExternalEntityMappingsService)
    private readonly externalEntityMappingsService: ExternalMappingResolver,
  ) {}

  /** Enqueues the one shared path used by first attempts, queue retries, and manual retries. */
  async enqueue(
    organizationId: string,
    invoiceId: string,
    targetSystem: GlTargetSystem,
    jobId?: string,
    scope?: ResourceScope,
  ): Promise<void> {
    await this.assertInvoiceInScope(organizationId, invoiceId, scope);
    try {
      await this.glQueue.add(
        'process-export',
        { organizationId, invoiceId, targetSystem },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          ...(jobId ? { jobId } : {}),
        },
      );
    } catch (error) {
      this.logger.error(`Failed to enqueue GL export for invoice ${invoiceId}: ${String(error)}`);
      throw error;
    }
  }

  async processExport(
    organizationId: string,
    invoiceId: string,
    targetSystem: GlTargetSystem,
  ): Promise<void> {
    const requestId = this.requestId(organizationId, invoiceId, targetSystem);
    const [record] = await this.db
      .insert(syncRecords)
      .values({
        organizationId,
        provider: targetSystem,
        direction: 'outbound',
        localEntity: 'invoice',
        localId: invoiceId,
        externalEntity: targetSystem === 'qbo' ? 'Bill' : 'Invoice',
        status: 'queued',
        requestId,
        docNumber: invoiceId,
        payload: null,
      })
      .onConflictDoUpdate({
        target: [
          syncRecords.organizationId,
          syncRecords.provider,
          syncRecords.direction,
          syncRecords.localEntity,
          syncRecords.localId,
        ],
        set: { requestId: sql`${syncRecords.requestId}` },
      })
      .returning({ id: syncRecords.id, status: syncRecords.status });

    if (record.status === 'synced') return;

    const attemptId = randomUUID();
    const started = await this.db
      .update(syncRecords)
      .set({
        status: 'queued',
        attempts: sql`${syncRecords.attempts} + 1`,
        attemptId,
        lastAttemptAt: new Date(),
        errorCode: null,
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(and(eq(syncRecords.id, record.id), ne(syncRecords.status, 'synced')))
      .returning({ id: syncRecords.id });
    if (started.length === 0) return;

    let payload: GlExportPayload;
    try {
      payload = await this.buildPayload(organizationId, invoiceId, targetSystem);
      await this.markRecord(record.id, attemptId, {
        docNumber: payload.invoiceNumber || payload.internalNumber,
        payload: payload as unknown as Record<string, unknown>,
      });
    } catch (error: unknown) {
      await this.markRecord(record.id, attemptId, {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    if (targetSystem === 'qbo') {
      const unmappedLines = payload.lines
        .filter((line) => line.unmapped)
        .map((line) =>
          line.glAccount ? `GL account ${line.glAccount}` : `line ${line.lineNumber}`,
        );
      const unmappedDimensions = payload.unmappedQboClass
        ? [`department ${payload.qboDepartmentId}`]
        : [];
      const errorCode = payload.unmappedQboClass
        ? unmappedLines.length > 0
          ? 'UNMAPPED_GL_ACCOUNT'
          : 'UNMAPPED_QBO_CLASS'
        : unmappedLines.length > 0
          ? 'UNMAPPED_GL_ACCOUNT'
          : null;
      if (errorCode) {
        await this.markRecord(record.id, attemptId, {
          status: 'failed',
          errorCode,
          errorMessage: `QBO export blocked before provider call: unmapped ${[
            ...unmappedDimensions,
            ...unmappedLines,
          ].join(', ')}`,
        });
        return;
      }
    }

    const allUnmapped = payload.lines.length > 0 && payload.lines.every((line) => line.unmapped);
    if (allUnmapped) {
      await this.markRecord(record.id, attemptId, {
        status: 'skipped',
        errorMessage: `No GL mappings found for ${targetSystem}`,
      });
      return;
    }

    try {
      const outcome = await this.sendToExternalSystem(
        organizationId,
        targetSystem,
        payload,
        requestId,
      );
      if (outcome.kind === 'pending') {
        await this.markRecord(record.id, attemptId, {
          status: 'pending',
          errorMessage: outcome.reason,
        });
        return;
      }

      await this.markRecord(record.id, attemptId, {
        status: 'synced',
        connectionId: outcome.connectionId,
        externalId: outcome.externalId,
        syncedAt: new Date(),
        errorMessage: null,
      });
      this.logger.log(
        `GL export synced for invoice ${payload.internalNumber} -> ${targetSystem} (externalId=${outcome.externalId})`,
      );
    } catch (error: unknown) {
      await this.markRecord(record.id, attemptId, {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async findJobsForInvoice(invoiceId: string, organizationId: string, scope?: ResourceScope) {
    if (!(await this.assertInvoiceInScope(organizationId, invoiceId, scope, false))) return [];
    const records = await this.db.query.syncRecords.findMany({
      where: (record, { and: andFn, eq: eqFn, or: orFn }) =>
        andFn(
          eqFn(record.organizationId, organizationId),
          eqFn(record.direction, 'outbound'),
          eqFn(record.localEntity, 'invoice'),
          eqFn(record.localId, invoiceId),
          orFn(eqFn(record.provider, 'qbo'), eqFn(record.provider, 'xero')),
        ),
      orderBy: (record, { desc }) => desc(record.createdAt),
    });
    return records.map((record) => this.toLegacyApiShape(record));
  }

  async retryJob(recordId: string, organizationId: string, scope?: ResourceScope): Promise<void> {
    const record = await this.db.query.syncRecords.findFirst({
      where: (row, { and: andFn, eq: eqFn, or: orFn }) =>
        andFn(
          eqFn(row.id, recordId),
          eqFn(row.organizationId, organizationId),
          eqFn(row.direction, 'outbound'),
          eqFn(row.localEntity, 'invoice'),
          orFn(eqFn(row.provider, 'qbo'), eqFn(row.provider, 'xero')),
        ),
    });
    if (!record) throw new BadRequestException(`GL sync record ${recordId} not found`);
    await this.assertInvoiceInScope(organizationId, record.localId, scope);
    if (record.status === 'synced')
      throw new BadRequestException('A synced record cannot be retried');

    const previous = {
      status: record.status,
      errorCode: record.errorCode,
      errorMessage: record.errorMessage,
    };
    await this.db
      .update(syncRecords)
      .set({ status: 'pending', errorCode: null, errorMessage: null, updatedAt: new Date() })
      .where(eq(syncRecords.id, recordId));
    try {
      await this.glQueue.add(
        'process-export',
        {
          organizationId,
          invoiceId: record.localId,
          targetSystem: record.provider as GlTargetSystem,
        },
        { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
      );
    } catch (error: unknown) {
      await this.db
        .update(syncRecords)
        .set({ ...previous, updatedAt: new Date() })
        .where(eq(syncRecords.id, recordId));
      throw error;
    }
  }

  async findAll(organizationId: string, scope?: ResourceScope) {
    const rowScope = invoiceScopePredicate(scope);

    const records = await this.db.query.syncRecords.findMany({
      where: (record, { and: andFn, eq: eqFn, or: orFn }) => {
        const scopedInvoiceId = rowScope
          ? sql`${record.localId} IN (
              SELECT i.id
              FROM invoices i
              LEFT JOIN purchase_orders po ON po.id = i.purchase_order_id
              LEFT JOIN requisitions r ON r.id = po.requisition_id
              WHERE i.organization_id = ${organizationId}
                AND ${rowScope}
            )`
          : undefined;
        return andFn(
          eqFn(record.organizationId, organizationId),
          eqFn(record.direction, 'outbound'),
          eqFn(record.localEntity, 'invoice'),
          scopedInvoiceId,
          orFn(eqFn(record.provider, 'qbo'), eqFn(record.provider, 'xero')),
        );
      },
      orderBy: (record, { desc }) => desc(record.createdAt),
      limit: 100,
    });
    const invoiceRows =
      records.length === 0
        ? []
        : await this.db.query.invoices.findMany({
            where: (invoice, { and: andFn, eq: eqFn, inArray }) =>
              andFn(
                eqFn(invoice.organizationId, organizationId),
                inArray(
                  invoice.id,
                  records.map((record) => record.localId),
                ),
              ),
          });
    const invoicesById = new Map(invoiceRows.map((invoice) => [invoice.id, invoice]));
    return records.map((record) =>
      this.toLegacyApiShape({ ...record, invoice: invoicesById.get(record.localId) ?? null }),
    );
  }

  private async assertInvoiceInScope(
    organizationId: string,
    invoiceId: string,
    scope: ResourceScope | undefined,
    throwOnFailure = true,
  ): Promise<boolean> {
    const rowScope = invoiceScopePredicate(scope);
    if (!rowScope) return true;

    const rows = await this.db.execute(sql`
      SELECT 1
      FROM invoices i
      LEFT JOIN purchase_orders po ON po.id = i.purchase_order_id
      LEFT JOIN requisitions r ON r.id = po.requisition_id
      WHERE i.organization_id = ${organizationId}
        AND i.id = ${invoiceId}
        AND ${rowScope}
      LIMIT 1
    `);
    if ((rows as unknown as unknown[]).length === 0) {
      if (throwOnFailure) {
        throw new BadRequestException(`Invoice ${invoiceId} is outside your access scope`);
      }
      return false;
    }
    return true;
  }

  private async buildPayload(
    organizationId: string,
    invoiceId: string,
    targetSystem: GlTargetSystem,
  ): Promise<GlExportPayload> {
    const invoice = await this.db.query.invoices.findFirst({
      where: (row, { and: andFn, eq: eqFn }) =>
        andFn(eqFn(row.id, invoiceId), eqFn(row.organizationId, organizationId)),
      with: {
        vendor: { columns: { punchoutConfig: false } },
        lines: true,
        purchaseOrder: { with: { requisition: { columns: { departmentId: true } } } },
      },
    });
    if (!invoice) throw new BadRequestException(`Invoice ${invoiceId} not found`);

    let qboClassId: string | null = null;
    let qboConnectionId: string | null = null;
    let qboRealmId: string | null = null;
    const departmentId = invoice.purchaseOrder?.requisition?.departmentId;
    if (targetSystem === 'qbo' && departmentId) {
      const mapping = await this.externalEntityMappingsService.resolve({
        organizationId,
        provider: 'qbo',
        direction: 'inbound',
        externalEntity: 'Class',
        localEntity: 'department',
        localId: departmentId,
        fallbackToDefault: true,
      });
      qboClassId = mapping?.externalId ?? null;
      qboConnectionId = mapping?.connectionId ?? null;
      qboRealmId = mapping?.realmId ?? null;
    }
    const unmappedQboClass = targetSystem === 'qbo' && departmentId != null && qboClassId === null;

    const lines = invoice.lines as Array<{
      lineNumber: string;
      description: string;
      quantity: string;
      unitPrice: string;
      totalPrice: string;
      glAccount: string | null;
    }>;
    const qboAccountIds = [
      ...new Set(
        lines
          .map((line) => line.glAccount)
          .filter((glAccount): glAccount is string => Boolean(glAccount)),
      ),
    ];
    let qboAccountMappings: ReadonlyMap<string, ExternalMappingResolution> = new Map();
    if (targetSystem === 'qbo' && qboAccountIds.length > 0) {
      qboAccountMappings = await this.externalEntityMappingsService.resolveMany({
        organizationId,
        provider: 'qbo',
        direction: 'inbound',
        externalEntity: 'Account',
        localEntity: 'gl_account',
        localIds: qboAccountIds,
      });
      const mappingRealms = [...qboAccountMappings.values()];
      const firstMapping = mappingRealms[0];
      qboConnectionId ??= firstMapping?.connectionId ?? null;
      qboRealmId ??= firstMapping?.realmId ?? null;
      if (
        mappingRealms.some(
          (mapping) =>
            (mapping.connectionId != null && mapping.connectionId !== qboConnectionId) ||
            (mapping.realmId != null && mapping.realmId !== qboRealmId),
        )
      ) {
        throw new BadRequestException('QBO mappings changed realms while building the export');
      }
    }

    const exportLines: GlExportLine[] = [];
    const unmappedAccounts: string[] = [];
    for (const line of lines) {
      let externalAccountCode: string | null = null;
      let externalAccountName: string | null = null;
      if (line.glAccount) {
        if (targetSystem === 'qbo') {
          // Legacy QBO gl_mappings contain no authoritative Account identity,
          // so they stay out of this provider call until a later backfill.
          const mapping = qboAccountMappings.get(line.glAccount);
          externalAccountCode = mapping?.externalId ?? null;
          externalAccountName = mapping?.displayName ?? null;
        } else {
          const mapping = await this.glMappingsService.findByGlAccount(
            organizationId,
            line.glAccount,
            targetSystem,
          );
          externalAccountCode = mapping?.externalAccountCode ?? null;
          externalAccountName = mapping?.externalAccountName ?? null;
        }
      }
      const unmapped = externalAccountCode === null;
      if (unmapped && line.glAccount && !unmappedAccounts.includes(line.glAccount)) {
        unmappedAccounts.push(line.glAccount);
      }
      exportLines.push({
        lineNumber: Number(line.lineNumber),
        description: line.description,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        totalPrice: Number(line.totalPrice),
        glAccount: line.glAccount,
        externalAccountCode,
        externalAccountName,
        unmapped,
      });
    }

    const vendor = invoice.vendor as { name: string } | null;
    return {
      invoiceId: invoice.id,
      internalNumber: invoice.internalNumber,
      invoiceNumber: invoice.invoiceNumber,
      vendorName: vendor?.name ?? 'Unknown Vendor',
      invoiceDate: invoice.invoiceDate.toISOString(),
      dueDate: invoice.dueDate?.toISOString() ?? null,
      currency: invoice.currency,
      totalAmount: Number(invoice.totalAmount),
      lines: exportLines,
      unmappedAccounts,
      qboDepartmentId: departmentId ?? null,
      qboClassId,
      qboConnectionId,
      qboRealmId,
      unmappedQboClass,
    };
  }

  private async sendToExternalSystem(
    organizationId: string,
    targetSystem: GlTargetSystem,
    payload: GlExportPayload,
    requestId: string,
  ): Promise<SendOutcome> {
    return targetSystem === 'qbo'
      ? this.sendToQbo(organizationId, payload, requestId)
      : this.sendToXero(organizationId, payload, requestId);
  }

  private async sendToQbo(
    organizationId: string,
    payload: GlExportPayload,
    requestId: string,
  ): Promise<SendOutcome> {
    const lineItems = payload.lines
      .filter((line) => !line.unmapped && line.externalAccountCode)
      .map((line) => ({
        Amount: line.totalPrice,
        DetailType: 'AccountBasedExpenseLineDetail',
        Description: line.description,
        AccountBasedExpenseLineDetail: {
          AccountRef: { value: line.externalAccountCode },
          ...(payload.qboClassId ? { ClassRef: { value: payload.qboClassId } } : {}),
        },
      }));
    if (lineItems.length === 0)
      return { kind: 'pending', reason: 'No mapped QBO lines are available' };

    let response;
    try {
      response = await this.qboClient.request<{ Bill?: { Id?: string } }>({
        organizationId,
        method: 'POST',
        path: 'bill',
        requestId,
        expectedConnectionId: payload.qboConnectionId ?? undefined,
        expectedRealmId: payload.qboRealmId ?? undefined,
        data: {
          VendorRef: { name: payload.vendorName },
          TxnDate: payload.invoiceDate.split('T')[0],
          DueDate: payload.dueDate?.split('T')[0],
          DocNumber: payload.invoiceNumber,
          CurrencyRef: { value: payload.currency },
          Line: lineItems,
        },
      });
    } catch (error: unknown) {
      if (error instanceof QboConnectionRequiredError) {
        return { kind: 'pending', reason: 'QBO is not connected' };
      }
      throw error;
    }
    const externalId = response.data.Bill?.Id;
    if (!externalId) throw new Error('QBO did not return a Bill ID');
    return { kind: 'synced', externalId, connectionId: response.connectionId };
  }

  private async sendToXero(
    organizationId: string,
    payload: GlExportPayload,
    requestId: string,
  ): Promise<SendOutcome> {
    const tokens = await this.oauthService.getXeroToken(organizationId);
    if (!tokens) return { kind: 'pending', reason: 'Xero is not connected' };

    const lineItems = payload.lines
      .filter((line) => !line.unmapped && line.externalAccountCode)
      .map((line) => ({
        Description: line.description,
        Quantity: line.quantity,
        UnitAmount: line.unitPrice,
        AccountCode: line.externalAccountCode,
      }));
    if (lineItems.length === 0)
      return { kind: 'pending', reason: 'No mapped Xero lines are available' };

    const requestData = {
      Invoices: [
        {
          Type: 'ACCPAY',
          Contact: { Name: payload.vendorName },
          Date: payload.invoiceDate.split('T')[0],
          DueDate: payload.dueDate?.split('T')[0],
          InvoiceNumber: payload.invoiceNumber,
          CurrencyCode: payload.currency,
          LineItems: lineItems,
          Status: 'AUTHORISED',
        },
      ],
    };
    let response: { data: XeroInvoiceResponse };
    try {
      response = await this.xeroClient.request<XeroInvoiceResponse>({
        organizationId,
        method: 'POST',
        path: 'Invoices',
        data: requestData,
        idempotencyKey: requestId,
        priority: 'background',
      });
    } catch (error: unknown) {
      if (error instanceof XeroConnectionRequiredError) {
        return { kind: 'pending', reason: 'Xero is not connected' };
      }
      throw error;
    }
    const externalId = response.data.Invoices?.[0]?.InvoiceID;
    if (!externalId) throw new Error('Xero did not return an Invoice ID');
    return { kind: 'synced', externalId, connectionId: tokens.connectionId };
  }

  private async markRecord(
    id: string,
    attemptId: string,
    values: Partial<typeof syncRecords.$inferInsert>,
  ): Promise<void> {
    await this.db
      .update(syncRecords)
      .set({ ...values, updatedAt: new Date() })
      .where(
        and(
          eq(syncRecords.id, id),
          eq(syncRecords.attemptId, attemptId),
          ne(syncRecords.status, 'synced'),
        ),
      );
  }

  private requestId(organizationId: string, invoiceId: string, provider: GlTargetSystem): string {
    return createHash('sha256')
      .update(`${organizationId}:${provider}:invoice:${invoiceId}`)
      .digest('hex')
      .slice(0, 50);
  }

  private toLegacyApiShape<T extends { provider: string; localId: string; syncedAt: Date | null }>(
    record: T,
  ) {
    const { payload: _payload, ...publicRecord } = record as T & { payload?: unknown };
    return {
      ...publicRecord,
      invoiceId: record.localId,
      targetSystem: record.provider,
      exportedAt: record.syncedAt,
      completedAt: record.syncedAt,
    };
  }
}
