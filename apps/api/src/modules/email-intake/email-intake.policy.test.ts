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

function validPdf(options?: {
  encrypted?: boolean;
  escapedEncryptName?: boolean;
  title?: string;
  afterTrailer?: string;
}): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>',
  ];
  let infoReference = '';
  if (options?.title) {
    objects.push(`<< /Title (${options.title}) >>`);
    infoReference = ` /Info ${objects.length} 0 R`;
  }
  let encryptReference = '';
  if (options?.encrypted) {
    const key = '00'.repeat(32);
    objects.push(`<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${key}> /U <${key}> /P -4 >>`);
    const name = options.escapedEncryptName ? '/Encr#79pt' : '/Encrypt';
    encryptReference = ` ${name} ${objects.length} 0 R`;
  }

  let source = '%PDF-1.7\n';
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(source, 'latin1');
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xrefOffset = Buffer.byteLength(source, 'latin1');
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  source += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${infoReference}${encryptReference} >>\n`;
  source += options?.afterTrailer ?? '';
  source += `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(source, 'latin1');
}

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

  it('accepts allowed document bytes and ignores inline images', async () => {
    const pdf = validPdf();
    assert.equal(
      (
        await decideAttachment(
          { filename: 'invoice.pdf', contentType: 'application/pdf', content: pdf },
          0,
        )
      ).status,
      'accepted',
    );
    assert.deepEqual(
      await decideAttachment(
        { filename: 'logo.png', cid: 'logo', content: Buffer.from('ignored') },
        0,
      ),
      { status: 'ignored', reason: 'inline_attachment' },
    );
    assert.equal(
      (
        await decideAttachment(
          {
            filename: 'invoice.pdf',
            cid: 'invoice',
            contentDisposition: 'attachment',
            content: pdf,
          },
          0,
        )
      ).status,
      'accepted',
    );
  });

  it('rejects archives, encrypted PDFs, oversized files, and excess attachments', async () => {
    const zip = await decideAttachment(
      {
        filename: 'invoices.zip',
        contentType: 'application/pdf',
        content: Buffer.from('PK\x03\x04'),
      },
      0,
    );
    const encrypted = await decideAttachment(
      { filename: 'locked.pdf', content: validPdf({ encrypted: true }) },
      0,
    );
    const mentionsEncryption = await decideAttachment(
      {
        filename: 'guide.pdf',
        content: validPdf({ title: 'How /Encrypt works' }),
      },
      0,
    );
    const encryptedEscapedName = await decideAttachment(
      {
        filename: 'locked-escaped.pdf',
        content: validPdf({ encrypted: true, escapedEncryptName: true }),
      },
      0,
    );
    const encryptedTrailerOutsideBudget = await decideAttachment(
      {
        filename: 'locked-distant-trailer.pdf',
        content: validPdf({
          encrypted: true,
          afterTrailer: `% ${'.'.repeat(129 * 1024)}\n% trailer << /Size 1 >>\n`,
        }),
      },
      0,
    );
    const malformedPdf = await decideAttachment(
      { filename: 'malformed.pdf', content: Buffer.from('%PDF-1.7\nnot a document') },
      0,
    );
    const oversized = await decideAttachment(
      { filename: 'huge.pdf', content: Buffer.alloc(MAX_EMAIL_ATTACHMENT_BYTES + 1, 1) },
      0,
    );
    const excess = await decideAttachment(
      { filename: 'eleven.pdf', content: Buffer.from('%PDF-1.7') },
      10,
    );
    const prefixedPdf = await decideAttachment(
      { filename: 'prefixed.pdf', content: Buffer.from('PK\x03\x04padding%PDF-1.7') },
      0,
    );
    const tar = Buffer.alloc(300);
    tar.write('%PDF-', 0, 'ascii');
    tar.write('ustar', 257, 'ascii');
    const tarDecision = await decideAttachment({ filename: 'invoice.pdf', content: tar }, 0);
    const emptyZipDirectory = Buffer.alloc(22);
    emptyZipDirectory.writeUInt32LE(0x06054b50, 0);
    const pdfZipPolyglot = await decideAttachment(
      {
        filename: 'polyglot.pdf',
        content: Buffer.concat([Buffer.from('%PDF-1.7\n%%EOF\n'), emptyZipDirectory]),
      },
      0,
    );
    const pdfZipPolyglotWithTrailingData = await decideAttachment(
      {
        filename: 'polyglot-trailing.pdf',
        content: Buffer.concat([
          Buffer.from('%PDF-1.7\n%%EOF\n'),
          emptyZipDirectory,
          Buffer.from('trailing data tolerated by ZIP readers'),
        ]),
      },
      0,
    );
    const pdfRarPolyglot = await decideAttachment(
      {
        filename: 'polyglot-rar.pdf',
        content: Buffer.concat([
          Buffer.from('%PDF-1.7\n'),
          Buffer.from('Rar!\x1a\x07\x01\x00', 'binary'),
        ]),
      },
      0,
    );
    const embeddedTar = Buffer.alloc(700);
    embeddedTar.write('%PDF-', 0, 'ascii');
    embeddedTar.write('ustar', 337, 'ascii');
    const pdfTarPolyglot = await decideAttachment(
      { filename: 'polyglot-tar.pdf', content: embeddedTar },
      0,
    );

    assert.equal(zip.status === 'rejected' && zip.reason, 'archive_not_allowed');
    assert.equal(encrypted.status === 'rejected' && encrypted.reason, 'encrypted_pdf');
    assert.equal(
      encryptedEscapedName.status === 'rejected' && encryptedEscapedName.reason,
      'encrypted_pdf',
    );
    assert.equal(
      encryptedTrailerOutsideBudget.status === 'rejected' && encryptedTrailerOutsideBudget.reason,
      'encrypted_pdf',
    );
    assert.equal(malformedPdf.status === 'rejected' && malformedPdf.reason, 'invalid_pdf');
    assert.equal(mentionsEncryption.status, 'accepted');
    assert.equal(oversized.status === 'rejected' && oversized.reason, 'attachment_too_large');
    assert.equal(excess.status === 'rejected' && excess.reason, 'attachment_count_exceeded');
    assert.equal(prefixedPdf.status === 'rejected' && prefixedPdf.reason, 'archive_not_allowed');
    assert.equal(tarDecision.status === 'rejected' && tarDecision.reason, 'archive_not_allowed');
    assert.equal(
      pdfZipPolyglot.status === 'rejected' && pdfZipPolyglot.reason,
      'archive_not_allowed',
    );
    assert.equal(
      pdfZipPolyglotWithTrailingData.status === 'rejected' && pdfZipPolyglotWithTrailingData.reason,
      'archive_not_allowed',
    );
    assert.equal(
      pdfRarPolyglot.status === 'rejected' && pdfRarPolyglot.reason,
      'archive_not_allowed',
    );
    assert.equal(
      pdfTarPolyglot.status === 'rejected' && pdfTarPolyglot.reason,
      'archive_not_allowed',
    );
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
