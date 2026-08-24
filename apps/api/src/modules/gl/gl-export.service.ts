import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHash } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import axios from 'axios';
import { syncRecords, type Db } from '@betterspend/db';
import { DB_TOKEN } from '../../database/database.module';
import { GlMappingsService } from './gl-mappings.service';
import { OAuthService } from './oauth.service';

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
}

type SendOutcome =
  | { kind: 'pending'; reason: string }
  | { kind: 'synced'; externalId: string; connectionId: string };

@Injectable()
export class GlExportService {
  private readonly logger = new Logger(GlExportService.name);

  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly glMappingsService: GlMappingsService,
    private readonly oauthService: OAuthService,
    @InjectQueue('gl-export') private readonly glQueue: Queue,
  ) {}

  /** Enqueues the one shared path used by first attempts, queue retries, and manual retries. */
  enqueue(organizationId: string, invoiceId: string, targetSystem: GlTargetSystem): void {
    this.glQueue
      .add(
        'process-export',
        { organizationId, invoiceId, targetSystem },
        { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
      )
      .catch((error: unknown) =>
        this.logger.error(`Failed to enqueue GL export for invoice ${invoiceId}: ${String(error)}`),
      );
  }

  async processExport(
    organizationId: string,
    invoiceId: string,
    targetSystem: GlTargetSystem,
  ): Promise<void> {
    const payload = await this.buildPayload(organizationId, invoiceId, targetSystem);
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
        docNumber: payload.invoiceNumber || payload.internalNumber,
        payload: payload as unknown as Record<string, unknown>,
      })
      .onConflictDoUpdate({
        target: [
          syncRecords.organizationId,
          syncRecords.provider,
          syncRecords.direction,
          syncRecords.localEntity,
          syncRecords.localId,
        ],
        set: {
          docNumber: payload.invoiceNumber || payload.internalNumber,
          payload: payload as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        },
      })
      .returning({ id: syncRecords.id, status: syncRecords.status });

    if (record.status === 'synced') return;

    await this.db
      .update(syncRecords)
      .set({
        status: 'queued',
        attempts: sql`${syncRecords.attempts} + 1`,
        lastAttemptAt: new Date(),
        errorCode: null,
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(syncRecords.id, record.id));

    const allUnmapped = payload.lines.length > 0 && payload.lines.every((line) => line.unmapped);
    if (allUnmapped) {
      await this.markRecord(record.id, {
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
        await this.markRecord(record.id, { status: 'pending', errorMessage: outcome.reason });
        return;
      }

      await this.markRecord(record.id, {
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
      await this.markRecord(record.id, {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async findJobsForInvoice(invoiceId: string) {
    const records = await this.db.query.syncRecords.findMany({
      where: (record, { and: andFn, eq: eqFn }) =>
        andFn(eqFn(record.localEntity, 'invoice'), eqFn(record.localId, invoiceId)),
      orderBy: (record, { desc }) => desc(record.createdAt),
    });
    return records.map((record) => this.toLegacyApiShape(record));
  }

  async retryJob(recordId: string, organizationId: string): Promise<void> {
    const record = await this.db.query.syncRecords.findFirst({
      where: (row, { and: andFn, eq: eqFn }) =>
        andFn(eqFn(row.id, recordId), eqFn(row.organizationId, organizationId)),
    });
    if (!record) throw new BadRequestException(`GL sync record ${recordId} not found`);
    if (record.status === 'synced')
      throw new BadRequestException('A synced record cannot be retried');

    await this.db
      .update(syncRecords)
      .set({ status: 'pending', errorCode: null, errorMessage: null, updatedAt: new Date() })
      .where(eq(syncRecords.id, recordId));
    await this.glQueue.add(
      'process-export',
      {
        organizationId,
        invoiceId: record.localId,
        targetSystem: record.provider as GlTargetSystem,
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
    );
  }

  async findAll(organizationId: string) {
    const records = await this.db.query.syncRecords.findMany({
      where: (record, { and: andFn, eq: eqFn }) =>
        andFn(eqFn(record.organizationId, organizationId), eqFn(record.localEntity, 'invoice')),
      with: { invoice: true },
      orderBy: (record, { desc }) => desc(record.createdAt),
      limit: 100,
    });
    return records.map((record) => this.toLegacyApiShape(record));
  }

  private async buildPayload(
    organizationId: string,
    invoiceId: string,
    targetSystem: GlTargetSystem,
  ): Promise<GlExportPayload> {
    const invoice = await this.db.query.invoices.findFirst({
      where: (row, { and: andFn, eq: eqFn }) =>
        andFn(eqFn(row.id, invoiceId), eqFn(row.organizationId, organizationId)),
      with: { vendor: true, lines: true },
    });
    if (!invoice) throw new BadRequestException(`Invoice ${invoiceId} not found`);

    const exportLines: GlExportLine[] = [];
    const unmappedAccounts: string[] = [];
    for (const line of invoice.lines as Array<{
      lineNumber: string;
      description: string;
      quantity: string;
      unitPrice: string;
      totalPrice: string;
      glAccount: string | null;
    }>) {
      const mapping = line.glAccount
        ? await this.glMappingsService.findByGlAccount(organizationId, line.glAccount, targetSystem)
        : null;
      const unmapped = !mapping;
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
        externalAccountCode: mapping?.externalAccountCode ?? null,
        externalAccountName: mapping?.externalAccountName ?? null,
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
    const tokens = await this.oauthService.getQboToken(organizationId);
    if (!tokens) return { kind: 'pending', reason: 'QBO is not connected' };

    const lineItems = payload.lines
      .filter((line) => !line.unmapped && line.externalAccountCode)
      .map((line) => ({
        Amount: line.totalPrice,
        DetailType: 'AccountBasedExpenseLineDetail',
        Description: line.description,
        AccountBasedExpenseLineDetail: { AccountRef: { value: line.externalAccountCode } },
      }));
    if (lineItems.length === 0)
      return { kind: 'pending', reason: 'No mapped QBO lines are available' };

    const baseUrl = process.env.QBO_API_URL || 'https://quickbooks.api.intuit.com';
    const response = await axios.post<{ Bill?: { Id?: string } }>(
      `${baseUrl}/v3/company/${tokens.realmId}/bill?requestid=${encodeURIComponent(requestId)}`,
      {
        VendorRef: { name: payload.vendorName },
        TxnDate: payload.invoiceDate.split('T')[0],
        DueDate: payload.dueDate?.split('T')[0],
        DocNumber: payload.invoiceNumber,
        CurrencyRef: { value: payload.currency },
        Line: lineItems,
      },
      {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      },
    );
    const externalId = response.data.Bill?.Id;
    if (!externalId) throw new Error('QBO did not return a Bill ID');
    return { kind: 'synced', externalId, connectionId: tokens.connectionId };
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

    const response = await axios.post<{ Invoices?: Array<{ InvoiceID?: string }> }>(
      'https://api.xero.com/api.xro/2.0/Invoices',
      {
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
      },
      {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          'xero-tenant-id': tokens.tenantId,
          'Idempotency-Key': requestId,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      },
    );
    const externalId = response.data.Invoices?.[0]?.InvoiceID;
    if (!externalId) throw new Error('Xero did not return an Invoice ID');
    return { kind: 'synced', externalId, connectionId: tokens.connectionId };
  }

  private async markRecord(
    id: string,
    values: Partial<typeof syncRecords.$inferInsert>,
  ): Promise<void> {
    await this.db
      .update(syncRecords)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(syncRecords.id, id));
  }

  private requestId(organizationId: string, invoiceId: string, provider: GlTargetSystem): string {
    return createHash('sha256')
      .update(`${organizationId}:${provider}:invoice:${invoiceId}`)
      .digest('hex')
      .slice(0, 50);
  }

  private toLegacyApiShape<T extends { provider: string; syncedAt: Date | null }>(record: T) {
    return {
      ...record,
      targetSystem: record.provider,
      exportedAt: record.syncedAt,
      completedAt: record.syncedAt,
    };
  }
}
