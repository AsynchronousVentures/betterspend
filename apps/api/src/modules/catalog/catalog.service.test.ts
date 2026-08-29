import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Db } from '@betterspend/db';
import type { MailOptions, MailService } from '../../common/mail/mail.service';
import { CatalogService } from './catalog.service';
import type { SettingsService } from '../settings/settings.service';

describe('CatalogService price proposal emails', () => {
  it('uses the catalog item currency when formatting vendor notifications', async () => {
    const proposal = {
      id: 'proposal-1',
      organizationId: 'org-1',
      itemId: 'item-1',
      vendorId: 'vendor-1',
      proposedPrice: '1500.5',
      currentPrice: '1234.5',
      effectiveDate: null,
      note: null,
      status: 'pending',
      submittedAt: new Date(),
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null,
      notifiedVendor: false,
      appliedAt: null,
      item: { currency: 'EUR' },
    };
    const sent: MailOptions[] = [];
    const transaction = {
      execute: async () => [],
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({ limit: async () => [] }),
            limit: async () => [],
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => ({ returning: async () => [{ ...proposal, status: 'rejected' }] }),
        }),
      }),
      insert: () => ({
        values: (values: Record<string, unknown>) => ({
          returning: async () => [values],
        }),
      }),
    };
    const db = {
      query: {
        catalogPriceProposals: { findFirst: async () => proposal },
        vendors: {
          findFirst: async () => ({
            name: 'Vendor',
            contactInfo: { email: 'vendor@example.com' },
          }),
        },
      },
      select: () => ({
        from: () => ({ where: async () => [{ id: 'vendor-1', entityId: null }] }),
      }),
      transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(transaction),
    } as unknown as Db;
    const mailService = {
      sendMail: async (_smtpConfig: unknown, options: MailOptions) => {
        sent.push(options);
        return false;
      },
    } as unknown as MailService;
    const settingsService = {
      getAll: async () => ({
        app_name: 'BetterSpend',
        smtp_host: 'smtp.example.com',
        smtp_port: '587',
        smtp_secure: 'false',
        smtp_user: '',
        smtp_pass: '',
        smtp_from: 'noreply@example.com',
      }),
    } as unknown as SettingsService;

    const service = new CatalogService(db, mailService, settingsService);
    await service.reviewPriceProposal('proposal-1', 'org-1', 'reviewer-1', { status: 'rejected' });

    assert.equal(sent.length, 1);
    assert.match(sent[0]?.html ?? '', /€1,234\.50/);
    assert.match(sent[0]?.html ?? '', /€1,500\.50/);
    assert.doesNotMatch(sent[0]?.html ?? '', /EUR 1234\.5/);
    assert.doesNotMatch(sent[0]?.html ?? '', /1234\.5/);
  });
});
