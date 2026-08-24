import { createHash } from 'node:crypto';

export const MAX_EMAIL_ATTACHMENTS = 10;
export const MAX_EMAIL_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export type SenderClassification = 'known_vendor' | 'employee' | 'unknown';

export interface SesAuthVerdicts {
  spam: string;
  virus: string;
  spf: string;
  dkim: string;
  dmarc: string;
}

export interface NormalizedSesReceipt {
  messageId: string;
  source: string;
  recipients: string[];
  subject: string;
  receivedAt: string;
  rawStorageKey: string;
  verdicts: SesAuthVerdicts;
}

export interface IntakeAttachmentCandidate {
  filename?: string;
  contentType?: string;
  contentDisposition?: string;
  cid?: string;
  content: Buffer;
}

export type AttachmentDecision =
  | { status: 'ignored'; reason: 'inline_attachment' }
  | { status: 'rejected'; reason: string; filename: string; contentType: string }
  | {
      status: 'accepted';
      filename: string;
      contentType: string;
      contentHash: string;
    };

const ARCHIVE_CONTENT_TYPES = new Set([
  'application/gzip',
  'application/vnd.rar',
  'application/x-7z-compressed',
  'application/x-rar-compressed',
  'application/x-tar',
  'application/zip',
]);

const ARCHIVE_EXTENSIONS = /\.(?:7z|gz|rar|tar|tgz|zip)$/i;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function requiredString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} is required`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${field} is too long`);
  return normalized;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function verdict(
  directVerdicts: Record<string, unknown> | undefined,
  receipt: Record<string, unknown> | undefined,
  name: keyof SesAuthVerdicts,
): string {
  const direct = directVerdicts?.[name] ?? receipt?.[`${name}Verdict`];
  const nested = asRecord(direct)?.status;
  const value =
    typeof nested === 'string' ? nested : typeof direct === 'string' ? direct : 'UNKNOWN';
  return value.toUpperCase();
}

/** Accepts either a direct BetterSpend receipt or the SES receipt JSON carried by SNS. */
export function normalizeSesReceipt(payload: unknown): NormalizedSesReceipt {
  let root = asRecord(payload);
  if (!root) throw new Error('Receipt payload must be an object');

  if (typeof root.Message === 'string') {
    try {
      root = asRecord(JSON.parse(root.Message));
    } catch {
      throw new Error('SNS Message must contain valid JSON');
    }
    if (!root) throw new Error('SNS Message must contain an object');
  }

  const mail = asRecord(root.mail);
  const receipt = asRecord(root.receipt);
  const action = asRecord(receipt?.action);
  const commonHeaders = asRecord(mail?.commonHeaders);
  const directVerdicts = asRecord(root.verdicts);

  const recipients = [
    ...stringArray(root.recipients),
    ...stringArray(receipt?.recipients),
    ...stringArray(mail?.destination),
  ];
  const uniqueRecipients = [...new Set(recipients.map((address) => address.trim().toLowerCase()))];
  if (uniqueRecipients.length === 0) throw new Error('At least one recipient is required');
  if (uniqueRecipients.length > 100) throw new Error('Too many recipients');
  if (uniqueRecipients.some((address) => address.length > 320)) {
    throw new Error('Recipient address is too long');
  }

  const receivedAtValue = root.receivedAt ?? mail?.timestamp;
  const receivedAt = requiredString(receivedAtValue, 'receivedAt', 100);
  if (Number.isNaN(Date.parse(receivedAt))) throw new Error('receivedAt must be an ISO timestamp');

  const fromHeader = stringArray(commonHeaders?.from)[0];
  return {
    messageId: requiredString(root.messageId ?? mail?.messageId, 'messageId', 255),
    source: requiredString(
      root.source ?? root.sourceEmail ?? mail?.source ?? fromHeader,
      'source',
      255,
    ),
    recipients: uniqueRecipients,
    subject:
      typeof (root.subject ?? commonHeaders?.subject) === 'string'
        ? String(root.subject ?? commonHeaders?.subject)
            .trim()
            .slice(0, 500)
        : '',
    receivedAt: new Date(receivedAt).toISOString(),
    rawStorageKey: requiredString(
      root.rawStorageKey ?? root.s3Key ?? root.objectKey ?? action?.objectKey,
      'rawStorageKey',
      500,
    ),
    verdicts: {
      spam: verdict(directVerdicts, receipt, 'spam'),
      virus: verdict(directVerdicts, receipt, 'virus'),
      spf: verdict(directVerdicts, receipt, 'spf'),
      dkim: verdict(directVerdicts, receipt, 'dkim'),
      dmarc: verdict(directVerdicts, receipt, 'dmarc'),
    },
  };
}

export function emailDomain(address: string): string | null {
  const match = address
    .trim()
    .toLowerCase()
    .match(/(?:<)?[^<>@\s]+@([^<>\s]+?)(?:>)?$/);
  return match?.[1]?.replace(/[>;,]+$/, '') ?? null;
}

export function classifySender(
  sourceEmail: string,
  vendorDomains: ReadonlySet<string>,
  employeeDomains: ReadonlySet<string>,
): SenderClassification {
  const domain = emailDomain(sourceEmail);
  if (domain && vendorDomains.has(domain)) return 'known_vendor';
  if (domain && employeeDomains.has(domain)) return 'employee';
  return 'unknown';
}

export function assessSenderRisk(
  classification: SenderClassification,
  verdicts: SesAuthVerdicts,
  fuzzyDuplicate: boolean,
): { score: number; signals: string[] } {
  let score = classification === 'known_vendor' ? 10 : classification === 'employee' ? 30 : 60;
  const signals = [`sender:${classification}`];

  const penalties: Array<[keyof SesAuthVerdicts, number]> = [
    ['spam', 25],
    ['virus', 40],
    ['spf', 10],
    ['dkim', 10],
    ['dmarc', 15],
  ];
  for (const [name, penalty] of penalties) {
    const status = verdicts[name].toUpperCase();
    if (status === 'FAIL' || status === 'PROCESSING_FAILED') {
      score += penalty;
      signals.push(`${name}:${status.toLowerCase()}`);
    } else if (status === 'GRAY') {
      score += 5;
      signals.push(`${name}:gray`);
    }
  }

  if (fuzzyDuplicate) {
    score += 20;
    signals.push('duplicate:vendor_invoice_number');
  }

  return { score: Math.min(score, 100), signals };
}

export function allowsAttachmentPromotion(verdicts: SesAuthVerdicts): boolean {
  return verdicts.virus === 'PASS';
}

export function allowsAutomaticReply(verdicts: SesAuthVerdicts, autoSubmitted: unknown): boolean {
  if (verdicts.spf !== 'PASS' || verdicts.dmarc !== 'PASS') return false;
  if (autoSubmitted === undefined) return true;
  const values = Array.isArray(autoSubmitted) ? autoSubmitted : [autoSubmitted];
  return (
    values.length > 0 &&
    values.every((value) => typeof value === 'string' && value.trim().toLowerCase() === 'no')
  );
}

function archiveMagic(content: Buffer): boolean {
  return (
    content.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b])) ||
    content.subarray(0, 2).equals(Buffer.from('PK')) ||
    content.subarray(0, 6).equals(Buffer.from('Rar!\x1a\x07', 'binary')) ||
    content.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) ||
    content.subarray(257, 262).toString('ascii') === 'ustar'
  );
}

function detectedContentType(content: Buffer): string | null {
  if (content.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (
    content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (content.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (
    content.subarray(0, 4).toString('ascii') === 'RIFF' &&
    content.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export function isEncryptedPdf(content: Buffer): boolean {
  if (detectedContentType(content) !== 'application/pdf') return false;
  const tail = content.subarray(Math.max(0, content.length - 128 * 1024)).toString('latin1');
  const structuralDictionaries: string[] = [];
  const startXref = tail.lastIndexOf('startxref');
  const structuralEnd = startXref >= 0 ? startXref : tail.length;

  const trailer = tail.lastIndexOf('trailer', structuralEnd);
  if (trailer >= 0) {
    const dictionary = pdfDictionaryAt(tail, tail.indexOf('<<', trailer));
    if (dictionary) structuralDictionaries.push(dictionary);
  }

  const xrefMarkers = [...tail.slice(0, structuralEnd).matchAll(/\/Type\s*\/XRef\b/g)];
  const xrefMarker = xrefMarkers.at(-1);
  if (xrefMarker?.index !== undefined) {
    const dictionary = pdfDictionaryAt(tail, tail.lastIndexOf('<<', xrefMarker.index));
    if (dictionary) structuralDictionaries.push(dictionary);
  }

  return structuralDictionaries.some((dictionary) => /\/Encrypt\b/.test(dictionary));
}

function pdfDictionaryAt(source: string, start: number): string | null {
  if (start < 0 || source.slice(start, start + 2) !== '<<') return null;
  let depth = 0;
  let literalDepth = 0;
  let escaped = false;

  const end = Math.min(source.length - 1, start + 64 * 1024);
  for (let index = start; index < end; index += 1) {
    const character = source[index]!;
    if (literalDepth > 0) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '(') {
        literalDepth += 1;
      } else if (character === ')') {
        literalDepth -= 1;
      }
      continue;
    }
    if (character === '(') {
      literalDepth = 1;
      continue;
    }
    if (character === '%') {
      const lineEnding = source.slice(index + 1).search(/[\r\n]/);
      if (lineEnding < 0) return null;
      index += lineEnding + 1;
      continue;
    }
    if (source.slice(index, index + 2) === '<<') {
      depth += 1;
      index += 1;
      continue;
    }
    if (source.slice(index, index + 2) === '>>') {
      depth -= 1;
      index += 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return null;
}

export function sanitizeAttachmentFilename(filename: string): string {
  const normalized = filename
    .normalize('NFKC')
    .replace(/[\\/\u0000-\u001f\u007f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return (normalized || 'attachment').slice(0, 255);
}

export function decideAttachment(
  attachment: IntakeAttachmentCandidate,
  topLevelIndex: number,
): AttachmentDecision {
  const disposition = attachment.contentDisposition?.toLowerCase();
  if (disposition === 'inline' || (attachment.cid && !disposition?.startsWith('attachment'))) {
    return { status: 'ignored', reason: 'inline_attachment' };
  }

  const filename = sanitizeAttachmentFilename(attachment.filename ?? 'attachment');
  const declaredType = (attachment.contentType ?? 'application/octet-stream').toLowerCase();
  if (
    ARCHIVE_CONTENT_TYPES.has(declaredType) ||
    ARCHIVE_EXTENSIONS.test(filename) ||
    archiveMagic(attachment.content)
  ) {
    return {
      status: 'rejected',
      reason: 'archive_not_allowed',
      filename,
      contentType: declaredType,
    };
  }
  if (topLevelIndex >= MAX_EMAIL_ATTACHMENTS) {
    return {
      status: 'rejected',
      reason: 'attachment_count_exceeded',
      filename,
      contentType: declaredType,
    };
  }
  if (attachment.content.length > MAX_EMAIL_ATTACHMENT_BYTES) {
    return {
      status: 'rejected',
      reason: 'attachment_too_large',
      filename,
      contentType: declaredType,
    };
  }

  const contentType = detectedContentType(attachment.content);
  if (!contentType) {
    return {
      status: 'rejected',
      reason: 'unsupported_file_type',
      filename,
      contentType: declaredType,
    };
  }
  if (contentType === 'application/pdf' && isEncryptedPdf(attachment.content)) {
    return { status: 'rejected', reason: 'encrypted_pdf', filename, contentType };
  }

  return {
    status: 'accepted',
    filename,
    contentType,
    contentHash: createHash('sha256').update(attachment.content).digest('hex'),
  };
}

export function extractInvoiceNumberHint(...values: Array<string | undefined>): string | null {
  const text = values.filter(Boolean).join('\n');
  const match = text.match(
    /\b(?:invoice|inv|bill)\s+(?:number|no\.?|#)\s*[:#-]?\s*([a-z0-9][a-z0-9._/-]{2,})/i,
  );
  return match?.[1]?.replace(/[.,;:]+$/, '').slice(0, 100) ?? null;
}

export function normalizeInvoiceNumber(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}
