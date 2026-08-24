import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_EMAIL_ATTACHMENT_BYTES,
  allowsAttachmentPromotion,
  allowsAutomaticReply,
  assessSenderRisk,
  classifySender,
  decideAttachment,
  extractInvoiceNumberHint,
  normalizeSesReceipt,
  sanitizeAttachmentFilename,
} from './email-intake.policy';

const passVerdicts = { spam: 'PASS', virus: 'PASS', spf: 'PASS', dkim: 'PASS', dmarc: 'PASS' };

describe('email intake policy', () => {
  it('normalizes a native SES receipt notification', () => {
    const receipt = normalizeSesReceipt({
      notificationType: 'Received',
      mail: {
        messageId: 'ses-123',
        source: 'billing@vendor.test',
        destination: ['opaque@inbound.test'],
        timestamp: '2026-08-24T12:00:00Z',
        commonHeaders: { from: ['attacker@spoofed.test'], subject: 'Invoice 123' },
      },
      receipt: {
        recipients: ['opaque@inbound.test'],
        spamVerdict: { status: 'PASS' },
        virusVerdict: { status: 'PASS' },
        spfVerdict: { status: 'FAIL' },
        dkimVerdict: { status: 'PASS' },
        dmarcVerdict: { status: 'GRAY' },
        action: { type: 'S3', objectKey: 'email-intake/raw/ses-123' },
      },
    });

    assert.equal(receipt.messageId, 'ses-123');
    assert.equal(receipt.source, 'billing@vendor.test');
    assert.equal(receipt.rawStorageKey, 'email-intake/raw/ses-123');
    assert.deepEqual(receipt.recipients, ['opaque@inbound.test']);
    assert.equal(receipt.verdicts.spf, 'FAIL');
    assert.equal(receipt.verdicts.dmarc, 'GRAY');
  });

  it('unwraps an SNS notification without following subscription URLs', () => {
    const receipt = normalizeSesReceipt({
      Type: 'Notification',
      Message: JSON.stringify({
        messageId: 'ses-456',
        source: 'ap@vendor.test',
        recipients: ['opaque@inbound.test'],
        rawStorageKey: 'email-intake/raw/ses-456',
        receivedAt: '2026-08-24T12:00:00Z',
        verdicts: { spam: 'PASS' },
      }),
    });

    assert.equal(receipt.messageId, 'ses-456');
    assert.equal(receipt.verdicts.spam, 'PASS');
  });

  it('rejects receipt metadata without an authoritative timestamp', () => {
    assert.throws(() =>
      normalizeSesReceipt({
        messageId: 'ses-untimed',
        source: 'ap@vendor.test',
        recipients: ['opaque@inbound.test'],
        rawStorageKey: 'email-intake/raw/ses-untimed',
      }),
    );
  });

  it('ranks known vendor senders ahead of employees and unknown senders', () => {
    const vendorDomains = new Set(['vendor.test']);
    const employeeDomains = new Set(['buyer.test']);
    assert.equal(
      classifySender('Billing <billing@vendor.test>', vendorDomains, employeeDomains),
      'known_vendor',
    );
    assert.equal(
      classifySender('requester@buyer.test', vendorDomains, employeeDomains),
      'employee',
    );
    assert.equal(
      classifySender('attacker@lookalike.test', vendorDomains, employeeDomains),
      'unknown',
    );

    const known = assessSenderRisk('known_vendor', passVerdicts, false);
    const employee = assessSenderRisk('employee', passVerdicts, false);
    const unknown = assessSenderRisk('unknown', passVerdicts, false);
    assert.ok(known.score < employee.score);
    assert.ok(employee.score < unknown.score);
  });

  it('stores authentication failures as risk instead of rejecting the message', () => {
    const risk = assessSenderRisk(
      'known_vendor',
      { ...passVerdicts, spf: 'FAIL', dmarc: 'GRAY' },
      true,
    );
    assert.equal(risk.score, 45);
    assert.deepEqual(risk.signals, [
      'sender:known_vendor',
      'spf:fail',
      'dmarc:gray',
      'duplicate:vendor_invoice_number',
    ]);
  });

  it('requires a passing virus verdict before promoting attachments', () => {
    assert.equal(allowsAttachmentPromotion(passVerdicts), true);
    assert.equal(allowsAttachmentPromotion({ ...passVerdicts, virus: 'FAIL' }), false);
    assert.equal(allowsAttachmentPromotion({ ...passVerdicts, virus: 'UNKNOWN' }), false);
  });

  it('allows automatic replies only for DMARC-aligned human mail', () => {
    assert.equal(allowsAutomaticReply(passVerdicts, undefined), true);
    assert.equal(allowsAutomaticReply(passVerdicts, 'no'), true);
    assert.equal(allowsAutomaticReply({ ...passVerdicts, spf: 'FAIL' }, undefined), false);
    assert.equal(allowsAutomaticReply({ ...passVerdicts, dmarc: 'FAIL' }, undefined), false);
    assert.equal(allowsAutomaticReply(passVerdicts, 'auto-replied'), false);
    assert.equal(allowsAutomaticReply(passVerdicts, {}), false);
  });

  it('accepts allowed document bytes and ignores inline images', () => {
    const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj');
    assert.equal(
      decideAttachment({ filename: 'invoice.pdf', contentType: 'application/pdf', content: pdf }, 0)
        .status,
      'accepted',
    );
    assert.deepEqual(
      decideAttachment({ filename: 'logo.png', cid: 'logo', content: Buffer.from('ignored') }, 0),
      { status: 'ignored', reason: 'inline_attachment' },
    );
    assert.equal(
      decideAttachment(
        {
          filename: 'invoice.pdf',
          cid: 'invoice',
          contentDisposition: 'attachment',
          content: pdf,
        },
        0,
      ).status,
      'accepted',
    );
  });

  it('rejects archives, encrypted PDFs, oversized files, and excess attachments', () => {
    const zip = decideAttachment(
      {
        filename: 'invoices.zip',
        contentType: 'application/pdf',
        content: Buffer.from('PK\x03\x04'),
      },
      0,
    );
    const encrypted = decideAttachment(
      {
        filename: 'locked.pdf',
        content: Buffer.from('%PDF-1.7\ntrailer\n<< /Size 3 /Encrypt 2 0 R >>\nstartxref\n0'),
      },
      0,
    );
    const mentionsEncryption = decideAttachment(
      {
        filename: 'guide.pdf',
        content: Buffer.from(
          '%PDF-1.7\n1 0 obj\n<< /Title (How /Encrypt works) >>\nendobj\ntrailer\n<< /Size 2 >>',
        ),
      },
      0,
    );
    const oversized = decideAttachment(
      { filename: 'huge.pdf', content: Buffer.alloc(MAX_EMAIL_ATTACHMENT_BYTES + 1, 1) },
      0,
    );
    const excess = decideAttachment(
      { filename: 'eleven.pdf', content: Buffer.from('%PDF-1.7') },
      10,
    );
    const prefixedPdf = decideAttachment(
      { filename: 'prefixed.pdf', content: Buffer.from('PK\x03\x04padding%PDF-1.7') },
      0,
    );
    const tar = Buffer.alloc(300);
    tar.write('%PDF-', 0, 'ascii');
    tar.write('ustar', 257, 'ascii');
    const tarDecision = decideAttachment({ filename: 'invoice.pdf', content: tar }, 0);

    assert.equal(zip.status === 'rejected' && zip.reason, 'archive_not_allowed');
    assert.equal(encrypted.status === 'rejected' && encrypted.reason, 'encrypted_pdf');
    assert.equal(mentionsEncryption.status, 'accepted');
    assert.equal(oversized.status === 'rejected' && oversized.reason, 'attachment_too_large');
    assert.equal(excess.status === 'rejected' && excess.reason, 'attachment_count_exceeded');
    assert.equal(prefixedPdf.status === 'rejected' && prefixedPdf.reason, 'archive_not_allowed');
    assert.equal(tarDecision.status === 'rejected' && tarDecision.reason, 'archive_not_allowed');
  });

  it('extracts an invoice number hint for fuzzy duplicate checks', () => {
    assert.equal(
      extractInvoiceNumberHint('Invoice no. INV-2026/0042', 'ignored.pdf'),
      'INV-2026/0042',
    );
    assert.equal(extractInvoiceNumberHint('Monthly statement'), null);
    assert.equal(extractInvoiceNumberHint('Invoice date: 2026-08-24'), null);
    assert.equal(extractInvoiceNumberHint('Invoice attached'), null);
  });

  it('removes path separators and control characters from attachment names', () => {
    assert.equal(sanitizeAttachmentFilename('../invoice\n2026.pdf'), '.._invoice_2026.pdf');
  });
});
