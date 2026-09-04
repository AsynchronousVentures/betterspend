import assert from 'node:assert/strict';
import { Logger } from '@nestjs/common';
import { describe, it } from 'node:test';
import { MailService, type SmtpTransportOptions } from './mail.service';

describe('MailService SMTP target enforcement', () => {
  it('preserves explicitly trusted private relays and custom ports', async () => {
    let transportOptions: SmtpTransportOptions | undefined;
    const service = new MailService({
      lookup: async () => {
        throw new Error('trusted SMTP targets must not use the public-only resolver');
      },
      createTransport: (options) => {
        transportOptions = options;
        return {
          sendMail: async () => ({ accepted: ['supplier@example.com'] }),
          close: () => undefined,
        };
      },
    });

    const sent = await service.sendMail(
      {
        host: '10.0.0.25',
        port: 1025,
        secure: false,
        user: 'mailer',
        pass: 'secret',
        from: 'purchasing@example.com',
        targetPolicy: 'trusted',
      },
      {
        to: 'supplier@example.com',
        subject: 'Supplier request',
        html: '<p>Request</p>',
      },
    );

    assert.equal(sent, true);
    assert.deepEqual(transportOptions, {
      host: '10.0.0.25',
      port: 1025,
      secure: false,
      tls: undefined,
      requireTLS: undefined,
      connectionTimeout: undefined,
      greetingTimeout: undefined,
      socketTimeout: undefined,
      socket: undefined,
      auth: { user: 'mailer', pass: 'secret' },
    });
  });

  it('fails closed when an SMTP target reaches the runtime boundary unclassified', async () => {
    let transportStarted = false;
    const service = new MailService({
      createTransport: () => {
        transportStarted = true;
        return {
          sendMail: async () => ({ accepted: ['supplier@example.com'] }),
          close: () => undefined,
        };
      },
    });
    const unclassifiedConfig = {
      host: '10.0.0.25',
      port: 1025,
      secure: false,
      user: 'mailer',
      pass: 'secret',
      from: 'purchasing@example.com',
    };

    const sent = await Reflect.apply(service.sendMail, service, [
      unclassifiedConfig,
      {
        to: 'supplier@example.com',
        subject: 'Supplier request',
        html: '<p>Request</p>',
      },
    ]);

    assert.equal(sent, false);
    assert.equal(transportStarted, false);
  });

  it('pins the connection while preserving the original hostname for TLS', async () => {
    const transports: SmtpTransportOptions[] = [];
    const service = new MailService({
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      createTransport: (options) => {
        transports.push(options);
        return {
          sendMail: async () => ({ accepted: ['supplier@example.com'] }),
          close: () => undefined,
        };
      },
    });

    for (const secure of [false, true]) {
      const sent = await service.sendMail(
        {
          host: 'SMTP.Example.COM.',
          port: secure ? 465 : 587,
          secure,
          user: 'mailer',
          pass: 'secret',
          from: 'purchasing@example.com',
          targetPolicy: 'public-only',
        },
        {
          to: 'supplier@example.com',
          subject: 'Supplier request',
          html: '<p>Request</p>',
        },
      );
      assert.equal(sent, true);
    }

    assert.deepEqual(
      transports.map(
        ({
          host,
          port,
          secure,
          tls,
          requireTLS,
          connectionTimeout,
          greetingTimeout,
          socketTimeout,
          socket,
        }) => ({
          host,
          port,
          secure,
          tls,
          requireTLS,
          connectionTimeout,
          greetingTimeout,
          socketTimeout,
          hasPinnedSocket: Boolean(socket),
        }),
      ),
      [
        {
          host: '93.184.216.34',
          port: 587,
          secure: false,
          tls: { servername: 'smtp.example.com' },
          requireTLS: true,
          connectionTimeout: 60_000,
          greetingTimeout: 30_000,
          socketTimeout: 240_000,
          hasPinnedSocket: true,
        },
        {
          host: '93.184.216.34',
          port: 465,
          secure: true,
          tls: { servername: 'smtp.example.com' },
          requireTLS: undefined,
          connectionTimeout: 60_000,
          greetingTimeout: 30_000,
          socketTimeout: 240_000,
          hasPinnedSocket: true,
        },
      ],
    );
  });

  it('times out slow DNS and never starts an SMTP transport after lookup completes', async () => {
    let transportsStarted = 0;
    const service = new MailService({
      lookup: async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return [{ address: '93.184.216.34', family: 4 }];
      },
      publicOnlySendDeadlineMs: 5,
      createTransport: () => {
        transportsStarted += 1;
        return {
          sendMail: async () => ({ accepted: ['supplier@example.com'] }),
          close: () => undefined,
        };
      },
    });

    const sent = await service.sendMail(
      {
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        user: 'mailer',
        pass: 'secret',
        from: 'purchasing@example.com',
        targetPolicy: 'public-only',
      },
      {
        to: 'supplier@example.com',
        subject: 'Supplier request',
        html: '<p>Request</p>',
      },
    );

    assert.equal(sent, false);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(transportsStarted, 0);
  });

  it('closes a public-only transport and fails when the send deadline expires', async () => {
    let closed = false;
    let transportOptions: SmtpTransportOptions | undefined;
    const service = new MailService({
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      publicOnlySendDeadlineMs: 5,
      createTransport: (options) => {
        transportOptions = options;
        return {
          sendMail: async () => {
            await new Promise((resolve) => setTimeout(resolve, 25));
            return { accepted: ['supplier@example.com'] };
          },
          close: () => {
            closed = true;
          },
        };
      },
    });

    const sent = await service.sendMail(
      {
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        user: 'mailer',
        pass: 'secret',
        from: 'purchasing@example.com',
        targetPolicy: 'public-only',
      },
      {
        to: 'supplier@example.com',
        subject: 'Supplier request',
        html: '<p>Request</p>',
      },
    );

    assert.equal(sent, false);
    assert.equal(closed, true);
    assert.equal(transportOptions?.socket?.destroyed, true);
  });

  it('fails closed without logging SMTP credentials', async (context) => {
    const service = new MailService({
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      createTransport: () => ({
        sendMail: async () => {
          throw new Error('Authentication failed for mailer with top-secret');
        },
        close: () => undefined,
      }),
    });
    const errors: string[] = [];
    context.mock.method(Logger.prototype, 'error', (message: unknown) => {
      errors.push(String(message));
    });

    const sent = await service.sendMail(
      {
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        user: 'mailer',
        pass: 'top-secret',
        from: 'purchasing@example.com',
        targetPolicy: 'trusted',
      },
      {
        to: 'supplier@example.com',
        subject: 'Supplier request',
        html: '<p>Request</p>',
      },
    );

    assert.equal(sent, false);
    assert.doesNotMatch(errors.join('\n'), /mailer|top-secret/);
  });
});

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
