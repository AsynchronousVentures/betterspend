import { Injectable, Logger, Optional } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { Socket } from 'node:net';
import { formatMoney, type MoneyAmount } from '../utils/money';
import { resolveSafeSmtpTarget, type SmtpDnsLookup } from './smtp-target-policy';

export interface MailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  /**
   * Stable RFC Message-ID used by retrying callers and downstream deduplication.
   * SMTP transport is still at-least-once because not every provider deduplicates Message-ID.
   */
  messageId?: string;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  /** Tenant-controlled targets use public-only; operator-controlled targets use trusted. */
  targetPolicy: 'trusted' | 'public-only';
}

export interface SmtpTransportOptions {
  host: string;
  port: number;
  secure: boolean;
  tls?: { servername: string };
  requireTLS?: boolean;
  connectionTimeout?: number;
  greetingTimeout?: number;
  socketTimeout?: number;
  socket?: Socket;
  auth?: { user: string; pass: string };
}

interface SmtpTransportMessage {
  from: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  messageId?: string;
}

export interface SmtpTransport {
  sendMail(message: SmtpTransportMessage): Promise<unknown>;
  close(): void;
}

export type SmtpTransportFactory = (options: SmtpTransportOptions) => SmtpTransport;

export interface MailServiceDependencies {
  lookup?: SmtpDnsLookup;
  createTransport?: SmtpTransportFactory;
  publicOnlySendDeadlineMs?: number;
}

const PUBLIC_ONLY_SMTP_SEND_DEADLINE_MS = 4 * 60_000;
const PUBLIC_ONLY_SMTP_CONNECTION_TIMEOUT_MS = 60_000;
const PUBLIC_ONLY_SMTP_GREETING_TIMEOUT_MS = 30_000;

const defaultCreateTransport: SmtpTransportFactory = (options) => {
  const transporter = nodemailer.createTransport(options);
  return {
    sendMail: (message) => transporter.sendMail(message),
    close: () => transporter.close(),
  };
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly lookup: SmtpDnsLookup | undefined;
  private readonly createTransport: SmtpTransportFactory;
  private readonly publicOnlySendDeadlineMs: number;

  constructor(@Optional() dependencies?: MailServiceDependencies) {
    this.lookup = dependencies?.lookup;
    this.createTransport = dependencies?.createTransport ?? defaultCreateTransport;
    this.publicOnlySendDeadlineMs = Math.max(
      1,
      dependencies?.publicOnlySendDeadlineMs ?? PUBLIC_ONLY_SMTP_SEND_DEADLINE_MS,
    );
  }

  async sendMail(smtpConfig: SmtpConfig, options: MailOptions): Promise<boolean> {
    if (!smtpConfig.host) {
      this.logger.warn('SMTP not configured — skipping email send');
      return false;
    }
    if (smtpConfig.targetPolicy !== 'trusted' && smtpConfig.targetPolicy !== 'public-only') {
      this.logger.error('Failed to send email');
      return false;
    }

    try {
      const publicOnly = smtpConfig.targetPolicy === 'public-only';
      const message = {
        from: smtpConfig.from,
        to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
        messageId: options.messageId ? `<${options.messageId.replace(/^<|>$/g, '')}>` : undefined,
      };
      if (publicOnly) {
        await this.sendPublicOnly(smtpConfig, message);
      } else {
        const transporter = this.createTransport({
          host: smtpConfig.host,
          port: smtpConfig.port,
          secure: smtpConfig.secure,
          tls: undefined,
          requireTLS: undefined,
          connectionTimeout: undefined,
          greetingTimeout: undefined,
          socketTimeout: undefined,
          socket: undefined,
          auth: smtpConfig.user ? { user: smtpConfig.user, pass: smtpConfig.pass } : undefined,
        });
        await transporter.sendMail(message);
      }

      this.logger.log(`Email sent to ${options.to}: ${options.subject}`);
      return true;
    } catch {
      this.logger.error('Failed to send email');
      return false;
    }
  }

  private async sendPublicOnly(
    smtpConfig: SmtpConfig,
    message: SmtpTransportMessage,
  ): Promise<void> {
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let expired = false;
    let socket: Socket | undefined;
    let transporter: SmtpTransport | undefined;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      socket?.destroy();
      try {
        transporter?.close();
      } catch {
        // The send result is authoritative even if transport cleanup also fails.
      }
    };
    const deadlineError = new Error('SMTP send deadline exceeded');
    const deadline = new Promise<never>((_resolve, reject) => {
      deadlineTimer = setTimeout(() => {
        expired = true;
        close();
        reject(deadlineError);
      }, this.publicOnlySendDeadlineMs);
    });
    const send = (async () => {
      const target = await resolveSafeSmtpTarget(smtpConfig.host, smtpConfig.port, this.lookup);
      if (expired) throw deadlineError;

      socket = new Socket();
      transporter = this.createTransport({
        host: target.address,
        port: target.port,
        secure: smtpConfig.secure,
        tls: target.hostname === target.address ? undefined : { servername: target.hostname },
        requireTLS: !smtpConfig.secure ? true : undefined,
        connectionTimeout: Math.min(
          PUBLIC_ONLY_SMTP_CONNECTION_TIMEOUT_MS,
          this.publicOnlySendDeadlineMs,
        ),
        greetingTimeout: Math.min(
          PUBLIC_ONLY_SMTP_GREETING_TIMEOUT_MS,
          this.publicOnlySendDeadlineMs,
        ),
        socketTimeout: this.publicOnlySendDeadlineMs,
        socket,
        auth: smtpConfig.user ? { user: smtpConfig.user, pass: smtpConfig.pass } : undefined,
      });
      await transporter.sendMail(message);
    })();
    try {
      await Promise.race([send, deadline]);
    } finally {
      expired = true;
      if (deadlineTimer) clearTimeout(deadlineTimer);
      close();
    }
  }

  // --- Template helpers ---

  buildApprovalRequestEmail(params: {
    appName: string;
    approverName: string;
    entityType: string;
    entityNumber: string;
    requestedBy: string;
    amount?: MoneyAmount;
    currency?: string;
    locale?: string;
    appUrl: string;
    approvalId: string;
  }): MailOptions {
    const {
      appName,
      approverName,
      entityType,
      entityNumber,
      requestedBy,
      amount,
      currency,
      locale,
      appUrl,
      approvalId,
    } = params;
    const link = `${appUrl}/approvals/${approvalId}`;
    const formattedAmount = amount == null ? undefined : formatMoney(amount, currency, locale);
    return {
      to: [],
      subject: `[${appName}] Approval Required: ${entityType} ${entityNumber}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#0f172a">Action Required: Approval Request</h2>
          <p>Hi ${approverName},</p>
          <p>A new <strong>${entityType}</strong> requires your approval:</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0">
            <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:bold">Number</td><td style="padding:8px;border:1px solid #e2e8f0">${entityNumber}</td></tr>
            <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:bold">Requested By</td><td style="padding:8px;border:1px solid #e2e8f0">${requestedBy}</td></tr>
            ${formattedAmount ? `<tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:bold">Amount</td><td style="padding:8px;border:1px solid #e2e8f0">${formattedAmount}</td></tr>` : ''}
          </table>
          <a href="${link}" style="display:inline-block;background:#3b82f6;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold">Review &amp; Approve</a>
          <hr style="margin:24px 0;border:none;border-top:1px solid #e2e8f0">
          <p style="color:#94a3b8;font-size:12px">This is an automated notification from ${appName}.</p>
        </div>
      `,
    };
  }

  buildPoIssuedEmail(params: {
    appName: string;
    vendorName: string;
    vendorEmail: string;
    poNumber: string;
    totalAmount: MoneyAmount;
    currency?: string;
    locale?: string;
    appUrl: string;
    poId: string;
  }): MailOptions {
    const {
      appName,
      vendorName,
      vendorEmail,
      poNumber,
      totalAmount,
      currency,
      locale,
      appUrl,
      poId,
    } = params;
    const formattedTotalAmount = formatMoney(totalAmount, currency, locale);
    return {
      to: vendorEmail,
      subject: `[${appName}] Purchase Order ${poNumber} Issued`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#0f172a">Purchase Order Issued</h2>
          <p>Dear ${vendorName},</p>
          <p>A new purchase order has been issued to your organization:</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0">
            <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:bold">PO Number</td><td style="padding:8px;border:1px solid #e2e8f0">${poNumber}</td></tr>
            <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:bold">Total Amount</td><td style="padding:8px;border:1px solid #e2e8f0">${formattedTotalAmount}</td></tr>
          </table>
          <hr style="margin:24px 0;border:none;border-top:1px solid #e2e8f0">
          <p style="color:#94a3b8;font-size:12px">This is an automated notification from ${appName}.</p>
        </div>
      `,
    };
  }

  buildInvoiceExceptionEmail(params: {
    appName: string;
    recipientName: string;
    recipientEmail: string;
    invoiceNumber: string;
    vendorName: string;
    matchStatus: string;
    appUrl: string;
    invoiceId: string;
  }): MailOptions {
    const {
      appName,
      recipientName,
      recipientEmail,
      invoiceNumber,
      vendorName,
      matchStatus,
      appUrl,
      invoiceId,
    } = params;
    const link = `${appUrl}/invoices/${invoiceId}`;
    return {
      to: recipientEmail,
      subject: `[${appName}] Invoice Match Exception: ${invoiceNumber}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#dc2626">Invoice Match Exception</h2>
          <p>Hi ${recipientName},</p>
          <p>Invoice <strong>${invoiceNumber}</strong> from <strong>${vendorName}</strong> has a match status of <strong>${matchStatus.replace(/_/g, ' ')}</strong> and requires your attention.</p>
          <a href="${link}" style="display:inline-block;background:#dc2626;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold">Review Invoice</a>
          <hr style="margin:24px 0;border:none;border-top:1px solid #e2e8f0">
          <p style="color:#94a3b8;font-size:12px">This is an automated notification from ${appName}.</p>
        </div>
      `,
    };
  }

  buildContractExpiryEmail(params: {
    appName: string;
    recipientName: string;
    recipientEmail: string;
    contractTitle: string;
    contractNumber: string;
    vendorName: string;
    endDate: string;
    daysRemaining: number;
    appUrl: string;
    contractId: string;
  }): MailOptions {
    const {
      appName,
      recipientName,
      recipientEmail,
      contractTitle,
      contractNumber,
      vendorName,
      endDate,
      daysRemaining,
      appUrl,
      contractId,
    } = params;
    const link = `${appUrl}/contracts/${contractId}`;
    return {
      to: recipientEmail,
      subject: `[${appName}] Contract Expiring Soon: ${contractNumber}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#d97706">Contract Expiring Soon</h2>
          <p>Hi ${recipientName},</p>
          <p>The following contract is expiring in <strong>${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}</strong>:</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0">
            <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:bold">Contract</td><td style="padding:8px;border:1px solid #e2e8f0">${contractNumber} — ${contractTitle}</td></tr>
            <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:bold">Vendor</td><td style="padding:8px;border:1px solid #e2e8f0">${vendorName}</td></tr>
            <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:bold">Expires</td><td style="padding:8px;border:1px solid #e2e8f0">${endDate}</td></tr>
          </table>
          <a href="${link}" style="display:inline-block;background:#d97706;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold">View Contract</a>
          <hr style="margin:24px 0;border:none;border-top:1px solid #e2e8f0">
          <p style="color:#94a3b8;font-size:12px">This is an automated notification from ${appName}.</p>
        </div>
      `,
    };
  }
}
