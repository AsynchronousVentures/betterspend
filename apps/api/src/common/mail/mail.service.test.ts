import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MailService } from './mail.service';

describe('MailService money templates', () => {
  it('formats PO totals with currency and locale-aware output', () => {
    const mail = new MailService().buildPoIssuedEmail({
      appName: 'BetterSpend',
      vendorName: 'Vendor',
      vendorEmail: 'vendor@example.com',
      poNumber: 'PO-2026-0001',
      totalAmount: '1234.5',
      currency: 'EUR',
      locale: 'de-DE',
      appUrl: 'https://example.com',
      poId: 'po-1',
    });

    assert.match(mail.html, /1\.234,50 €/);
    assert.doesNotMatch(mail.html, /EUR 1234\.5/);
  });

  it('formats approval amounts, including zero', () => {
    const mail = new MailService().buildApprovalRequestEmail({
      appName: 'BetterSpend',
      approverName: 'Approver',
      entityType: 'Requisition',
      entityNumber: 'REQ-2026-0001',
      requestedBy: 'Requester',
      amount: '0',
      currency: 'USD',
      appUrl: 'https://example.com',
      approvalId: 'approval-1',
    });

    assert.match(mail.html, /\$0\.00/);
  });
});
