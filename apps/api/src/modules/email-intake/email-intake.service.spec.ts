import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { EmailIntakeService } from './email-intake.service';

const organizationId = '00000000-0000-0000-0000-000000000001';
const secret = 'a'.repeat(32);

function receipt(rawStorageKey = 'email-intake/raw/ses-123') {
  return {
    messageId: 'ses-123',
    source: 'billing@vendor.test',
    recipients: ['opaque@inbound.test'],
    subject: 'Invoice 123',
    receivedAt: '2026-08-24T12:00:00Z',
    rawStorageKey,
    verdicts: { spam: 'PASS', virus: 'PASS', spf: 'PASS', dkim: 'PASS', dmarc: 'PASS' },
  };
}

function serviceWith(options?: {
  message?: { id: string };
  priorJob?: { getState: () => Promise<string>; remove: () => Promise<void> };
}) {
  const add = jest.fn().mockResolvedValue(undefined);
  const getJob = jest.fn().mockResolvedValue(options?.priorJob);
  const findAddresses = jest.fn().mockResolvedValue([{ organizationId }]);
  const findMessage = jest.fn().mockResolvedValue(options?.message);
  const service = new EmailIntakeService(
    {
      query: {
        emailIntakeAddresses: { findMany: findAddresses },
        emailIntakeMessages: { findFirst: findMessage },
      },
    } as never,
    { add, getJob } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, add, getJob, findAddresses };
}

describe('EmailIntakeService receipt enqueueing', () => {
  beforeEach(() => {
    process.env.EMAIL_INTAKE_DOMAIN = 'inbound.test';
    process.env.EMAIL_INTAKE_RAW_PREFIX = 'email-intake/raw/';
    process.env.EMAIL_INTAKE_WEBHOOK_SECRET = secret;
  });

  it('requires the raw object key to be the configured prefix plus the SES message ID', async () => {
    const harness = serviceWith();

    await expect(
      harness.service.enqueueSesReceipt(receipt('email-intake/raw/another-message'), secret),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(harness.findAddresses).not.toHaveBeenCalled();
  });

  it('requeues a terminal failed job even when its durable message already exists', async () => {
    const remove = jest.fn().mockResolvedValue(undefined);
    const harness = serviceWith({
      message: { id: '00000000-0000-0000-0000-000000000099' },
      priorJob: { getState: jest.fn().mockResolvedValue('failed'), remove },
    });

    await expect(harness.service.enqueueSesReceipt(receipt(), secret)).resolves.toMatchObject({
      accepted: true,
      duplicate: true,
    });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(harness.add).toHaveBeenCalledTimes(1);
  });

  it('rejects a queue receipt whose security verdicts are not webhook-signed', async () => {
    const harness = serviceWith();

    await expect(
      harness.service.processSesReceipt({ receipt: receipt(), signature: '0'.repeat(64) }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(harness.findAddresses).not.toHaveBeenCalled();
  });
});

describe('EmailIntakeService attachment promotion', () => {
  it('leaves the durable attachment pending when object upload fails', async () => {
    const findAttachment = jest
      .fn()
      .mockResolvedValueOnce({
        status: 'pending',
        contentHash: 'a'.repeat(64),
        storageKey: 'email-intake/attachments/org/message/attachment',
      })
      .mockResolvedValueOnce(undefined);
    const insert = jest.fn();
    const update = jest.fn();
    const transaction = jest.fn(async (callback) =>
      callback({
        execute: jest.fn(),
        query: { emailIntakeAttachments: { findFirst: findAttachment } },
        insert,
        update,
      }),
    );
    const upload = jest.fn().mockRejectedValue(new Error('S3 unavailable'));
    const service = new EmailIntakeService(
      { transaction } as never,
      {} as never,
      { exists: jest.fn().mockResolvedValue(false), upload } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service['promotePendingAttachments']({
        organizationId,
        messageId: '00000000-0000-0000-0000-000000000041',
        sourceEmail: 'billing@vendor.test',
        subject: 'Invoice 123',
        body: 'Invoice 123',
        vendorName: 'Vendor',
        riskScore: 10,
        riskSignals: ['sender:known_vendor'],
        outcomes: [
          {
            id: '00000000-0000-0000-0000-000000000051',
            filename: 'invoice.pdf',
            contentType: 'application/pdf',
            contentHash: 'a'.repeat(64),
            sizeBytes: 8,
            status: 'pending',
            rejectionReason: null,
            storageKey: 'email-intake/attachments/org/message/attachment',
            intakeItemId: null,
            invoiceNumberHint: '123',
          },
        ],
        attachments: [
          {
            id: '00000000-0000-0000-0000-000000000051',
            content: Buffer.from('%PDF-1'),
            decision: {
              status: 'accepted',
              filename: 'invoice.pdf',
              contentType: 'application/pdf',
              contentHash: 'a'.repeat(64),
            },
            invoiceNumberHint: '123',
          },
        ],
      }),
    ).rejects.toThrow('S3 unavailable');
    expect(upload).toHaveBeenCalledTimes(1);
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
