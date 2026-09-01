import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '@betterspend/db';
import type { Db } from '@betterspend/db';
import {
  MailService,
  type SmtpConfig,
  type SmtpTransportOptions,
} from '../../common/mail/mail.service';
import { InvoiceReviewDeliveries } from './invoice-review-deliveries.service';

const organizationId = '00000000-0000-4000-8000-000000000001';
const caseId = '00000000-0000-4000-8000-000000000002';
const invoiceId = '00000000-0000-4000-8000-000000000003';
const vendorId = '00000000-0000-4000-8000-000000000004';
const messageId = '00000000-0000-4000-8000-000000000005';
const supplierIntentId = '00000000-0000-4000-8000-000000000006';
const internalIntentId = '00000000-0000-4000-8000-000000000007';

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE TABLE invoices (id uuid PRIMARY KEY, organization_id uuid NOT NULL, vendor_id uuid);
    CREATE TABLE vendors (id uuid PRIMARY KEY, organization_id uuid NOT NULL, name varchar(255) NOT NULL, contact_info jsonb);
    CREATE TABLE messages (
      id uuid PRIMARY KEY, organization_id uuid NOT NULL, thread_type varchar(20) NOT NULL, thread_id uuid NOT NULL,
      author_name varchar(255) NOT NULL, body text NOT NULL
    );
    CREATE TABLE invoice_review_notification_intents (
      id uuid PRIMARY KEY, organization_id uuid NOT NULL, case_id uuid NOT NULL, intent_kind varchar(50) NOT NULL,
      recipient_user_id uuid, message_id uuid, action varchar(50) NOT NULL, idempotency_key varchar(255) NOT NULL,
      status varchar(20) NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0, last_error text,
      lease_token uuid, lease_expires_at timestamptz, delivered_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO invoices VALUES ('${invoiceId}', '${organizationId}', '${vendorId}');
    INSERT INTO vendors VALUES ('${vendorId}', '${organizationId}', 'Acme & Sons', '{}');
    INSERT INTO messages VALUES (
      '${messageId}', '${organizationId}', 'invoice', '${invoiceId}', 'AP <reviewer>', 'Please send <details>.'
    );
    INSERT INTO invoice_review_notification_intents (
      id, organization_id, case_id, intent_kind, message_id, action, idempotency_key
    ) VALUES (
      '${supplierIntentId}', '${organizationId}', '${caseId}', 'supplier_message_email', '${messageId}',
      'request_supplier_info', 'supplier-delivery'
    );
  `);
  return { database, db: drizzle(database, { schema }) };
}

function createDeliveries(
  db: Db,
  options: {
    settings?: Record<string, string>;
    getSettings?: () => Promise<Record<string, string>>;
    sendMail?: (
      options: { messageId?: string; html: string; subject: string },
      smtpConfig: SmtpConfig,
    ) => Promise<boolean>;
    mailService?: MailService;
    add?: (data: { intentId: string }) => Promise<void>;
    createNotification?: () => Promise<void>;
  } = {},
) {
  return new InvoiceReviewDeliveries(
    {
      add: async (_name: string, data: { intentId: string }) => options.add?.(data),
    } as never,
    db,
    { createIdempotent: async () => options.createNotification?.() } as never,
    {
      getAll: async () =>
        options.getSettings?.() ?? {
          smtp_host: 'smtp.example.test',
          smtp_port: '587',
          smtp_secure: 'false',
          smtp_user: '',
          smtp_pass: '',
          smtp_from: 'noreply@example.test',
          app_name: 'BetterSpend',
          ...options.settings,
        },
    } as never,
    options.mailService ??
      ({
        sendMail: async (
          config: SmtpConfig,
          mail: { messageId?: string; html: string; subject: string },
        ) => options.sendMail?.(mail, config) ?? true,
      } as never),
  );
}

test('supplier delivery opts tenant SMTP settings into the public-only target policy', async () => {
  const { database, db } = await createDatabase();
  try {
    await database.exec(
      `UPDATE vendors SET contact_info = '{"email":"supplier@example.test"}' WHERE id = '${vendorId}'`,
    );
    const smtpConfigs: SmtpConfig[] = [];
    const deliveries = createDeliveries(db as unknown as Db, {
      sendMail: async (_mail, smtpConfig) => {
        smtpConfigs.push(smtpConfig);
        return true;
      },
    });

    await deliveries.deliver(supplierIntentId);

    assert.equal(smtpConfigs.length, 1);
    assert.equal(smtpConfigs[0]?.targetPolicy, 'public-only');
    const intent = await database.query<{
      status: string;
      attempts: number;
      lastError: string | null;
      leaseToken: string | null;
      leaseExpiresAt: string | null;
      deliveredAt: string | null;
    }>(`
      SELECT status, attempts, last_error AS "lastError", lease_token AS "leaseToken",
        lease_expires_at AS "leaseExpiresAt", delivered_at AS "deliveredAt"
      FROM invoice_review_notification_intents WHERE id = '${supplierIntentId}'
    `);
    assert.deepEqual(
      intent.rows.map(({ deliveredAt: _deliveredAt, ...delivery }) => delivery),
      [
        {
          status: 'delivered',
          attempts: 1,
          lastError: null,
          leaseToken: null,
          leaseExpiresAt: null,
        },
      ],
    );
    assert.ok(intent.rows[0]?.deliveredAt);
  } finally {
    await database.close();
  }
});

test('a supplier SMTP deadline closes the transport and leaves the intent pending', async () => {
  const { database, db } = await createDatabase();
  try {
    await database.exec(
      `UPDATE vendors SET contact_info = '{"email":"supplier@example.test"}' WHERE id = '${vendorId}'`,
    );
    const transportOptions: SmtpTransportOptions[] = [];
    let closed = false;
    const mailService = new MailService({
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      publicOnlySendDeadlineMs: 5,
      createTransport: (options) => {
        transportOptions.push(options);
        return {
          sendMail: async () => {
            await new Promise((resolve) => setTimeout(resolve, 25));
            return { accepted: ['supplier@example.test'] };
          },
          close: () => {
            closed = true;
          },
        };
      },
    });
    const deliveries = createDeliveries(db as unknown as Db, { mailService });

    await assert.rejects(deliveries.deliver(supplierIntentId), /SMTP_DELIVERY_FAILED/);

    assert.equal(closed, true);
    assert.equal(transportOptions[0]?.requireTLS, true);
    assert.equal(transportOptions[0]?.socketTimeout, 5);
    assert.equal(transportOptions[0]?.socket?.destroyed, true);
    const intent = await database.query<{
      status: string;
      lastError: string;
      attempts: number;
      leaseToken: string | null;
      leaseExpiresAt: string | null;
    }>(`
      SELECT status, last_error AS "lastError", attempts, lease_token AS "leaseToken", lease_expires_at AS "leaseExpiresAt"
      FROM invoice_review_notification_intents
      WHERE id = '${supplierIntentId}'
    `);
    assert.deepEqual(intent.rows, [
      {
        status: 'pending',
        lastError: 'SMTP_DELIVERY_FAILED',
        attempts: 1,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    ]);
  } finally {
    await database.close();
  }
});

test('supplier delivery keeps missing contacts pending, then sends with the same Message-ID after SMTP retry', async () => {
  const { database, db } = await createDatabase();
  try {
    const sentMessageIds: string[] = [];
    let acceptSmtp = false;
    const deliveries = createDeliveries(db as unknown as Db, {
      sendMail: async (mail) => {
        sentMessageIds.push(mail.messageId ?? '');
        assert.match(mail.html, /AP &lt;reviewer&gt;/);
        assert.match(mail.html, /Acme &amp; Sons/);
        return acceptSmtp;
      },
    });

    await assert.rejects(deliveries.deliver(supplierIntentId), /SUPPLIER_CONTACT_MISSING/);
    await database.exec(
      `UPDATE vendors SET contact_info = '{"email":"supplier@example.test"}' WHERE id = '${vendorId}'`,
    );
    await assert.rejects(deliveries.deliver(supplierIntentId), /SMTP_DELIVERY_FAILED/);
    acceptSmtp = true;
    await deliveries.deliver(supplierIntentId);
    await deliveries.deliver(supplierIntentId);

    assert.deepEqual(sentMessageIds, [
      `invoice-review-delivery-${supplierIntentId}@betterspend.invalid`,
      `invoice-review-delivery-${supplierIntentId}@betterspend.invalid`,
    ]);
    const delivery = await database.query<{
      status: string;
      attempts: number;
      lastError: string | null;
    }>(
      `SELECT status, attempts, last_error AS "lastError" FROM invoice_review_notification_intents WHERE id = '${supplierIntentId}'`,
    );
    assert.deepEqual(delivery.rows, [{ status: 'delivered', attempts: 3, lastError: null }]);
  } finally {
    await database.close();
  }
});

test('supplier delivery retains a missing message as a retryable pending intent', async () => {
  const { database, db } = await createDatabase();
  try {
    await database.exec(`DELETE FROM messages WHERE id = '${messageId}'`);
    const deliveries = createDeliveries(db as unknown as Db);

    await assert.rejects(deliveries.deliver(supplierIntentId), /SUPPLIER_MESSAGE_MISSING/);

    const intent = await database.query<{ status: string; lastError: string; attempts: number }>(`
      SELECT status, last_error AS "lastError", attempts
      FROM invoice_review_notification_intents
      WHERE id = '${supplierIntentId}'
    `);
    assert.deepEqual(intent.rows, [
      { status: 'pending', lastError: 'SUPPLIER_MESSAGE_MISSING', attempts: 1 },
    ]);
  } finally {
    await database.close();
  }
});

test('supplier delivery never passes branding control characters into an SMTP subject', async () => {
  const { database, db } = await createDatabase();
  try {
    await database.exec(
      `UPDATE vendors SET contact_info = '{"email":"supplier@example.test"}' WHERE id = '${vendorId}'`,
    );
    const subjects: string[] = [];
    const deliveries = createDeliveries(db as unknown as Db, {
      settings: { app_name: 'BetterSpend\r\nBcc: attacker@example.test\u0000' },
      sendMail: async ({ subject }) => {
        subjects.push(subject);
        return true;
      },
    });

    await deliveries.deliver(supplierIntentId);

    assert.equal(subjects.length, 1);
    assert.doesNotMatch(subjects[0] ?? '', /[\u0000-\u001F\u007F]/);
  } finally {
    await database.close();
  }
});

test('internal notification failures remain pending with their own stable delivery error', async () => {
  const { database, db } = await createDatabase();
  try {
    await database.exec(`
      INSERT INTO invoice_review_notification_intents (
        id, organization_id, case_id, intent_kind, recipient_user_id, action, idempotency_key
      ) VALUES (
        '${internalIntentId}', '${organizationId}', '${caseId}', 'internal_notification',
        '00000000-0000-4000-8000-000000000008', 'claim', 'internal-delivery'
      )
    `);
    const deliveries = createDeliveries(db as unknown as Db, {
      createNotification: async () => {
        throw new Error('notification store unavailable');
      },
    });

    await assert.rejects(
      deliveries.deliver(internalIntentId),
      /INTERNAL_NOTIFICATION_DELIVERY_FAILED/,
    );

    const intent = await database.query<{ status: string; lastError: string; attempts: number }>(`
      SELECT status, last_error AS "lastError", attempts
      FROM invoice_review_notification_intents
      WHERE id = '${internalIntentId}'
    `);
    assert.deepEqual(intent.rows, [
      {
        status: 'pending',
        lastError: 'INTERNAL_NOTIFICATION_DELIVERY_FAILED',
        attempts: 1,
      },
    ]);
  } finally {
    await database.close();
  }
});

test('supplier delivery resolves current configuration and current invoice vendor at send time', async () => {
  const { database, db } = await createDatabase();
  try {
    await database.exec(`UPDATE vendors SET contact_info = '{"email":"supplier@example.test"}'`);
    const deliveriesWithoutSmtp = createDeliveries(db as unknown as Db, {
      settings: { smtp_host: '' },
    });
    await assert.rejects(deliveriesWithoutSmtp.deliver(supplierIntentId), /SMTP_NOT_CONFIGURED/);

    await database.exec(`UPDATE invoices SET vendor_id = '00000000-0000-4000-8000-000000000099'`);
    const deliveries = createDeliveries(db as unknown as Db);
    await assert.rejects(deliveries.deliver(supplierIntentId), /INVOICE_VENDOR_MISSING/);
    await database.exec(`UPDATE invoices SET vendor_id = NULL`);
    await assert.rejects(deliveries.deliver(supplierIntentId), /INVOICE_VENDOR_MISSING/);
  } finally {
    await database.close();
  }
});

test('one delivery lease permits a single active SMTP send and delivered intents are never mailed again', async () => {
  const { database, db } = await createDatabase();
  try {
    await database.exec(`UPDATE vendors SET contact_info = '{"email":"supplier@example.test"}'`);
    let releaseMail: (() => void) | undefined;
    const enteredMail = new Promise<void>((resolve) => {
      releaseMail = resolve;
    });
    let sends = 0;
    const deliveries = createDeliveries(db as unknown as Db, {
      sendMail: async () => {
        sends += 1;
        await enteredMail;
        return true;
      },
    });

    const first = deliveries.deliver(supplierIntentId);
    while (sends === 0) await new Promise((resolve) => setImmediate(resolve));
    const beforeRejectedClaim = await database.query<{
      status: string;
      attempts: number;
      lastError: string | null;
      leaseToken: string | null;
      leaseExpiresAt: string | null;
    }>(`
      SELECT status, attempts, last_error AS "lastError", lease_token AS "leaseToken", lease_expires_at AS "leaseExpiresAt"
      FROM invoice_review_notification_intents WHERE id = '${supplierIntentId}'
    `);
    assert.equal(await deliveries.deliver(supplierIntentId), undefined);
    const afterRejectedClaim = await database.query<{
      status: string;
      attempts: number;
      lastError: string | null;
      leaseToken: string | null;
      leaseExpiresAt: string | null;
    }>(`
      SELECT status, attempts, last_error AS "lastError", lease_token AS "leaseToken", lease_expires_at AS "leaseExpiresAt"
      FROM invoice_review_notification_intents WHERE id = '${supplierIntentId}'
    `);
    assert.deepEqual(afterRejectedClaim.rows, beforeRejectedClaim.rows);
    releaseMail?.();
    await first;
    await deliveries.deliver(supplierIntentId);

    assert.equal(sends, 1);
  } finally {
    await database.close();
  }
});

test('supplier delivery renews an exhausted lease before SMTP so another worker cannot start a duplicate send', async () => {
  const { database, db } = await createDatabase();
  try {
    await database.exec(`UPDATE vendors SET contact_info = '{"email":"supplier@example.test"}'`);
    let releaseMail: (() => void) | undefined;
    const enteredMail = new Promise<void>((resolve) => {
      releaseMail = resolve;
    });
    let sends = 0;
    const deliveries = createDeliveries(db as unknown as Db, {
      getSettings: async () => {
        // Simulate slow pre-send work consuming the original five-minute lease.
        await database.exec(
          `UPDATE invoice_review_notification_intents SET lease_expires_at = now() - interval '1 second' WHERE id = '${supplierIntentId}'`,
        );
        return {
          smtp_host: 'smtp.example.test',
          smtp_port: '587',
          smtp_secure: 'false',
          smtp_user: '',
          smtp_pass: '',
          smtp_from: 'noreply@example.test',
          app_name: 'BetterSpend',
        };
      },
      sendMail: async () => {
        sends += 1;
        if (sends === 1) await enteredMail;
        return true;
      },
    });

    const first = deliveries.deliver(supplierIntentId);
    while (sends === 0) await new Promise((resolve) => setImmediate(resolve));
    await deliveries.deliver(supplierIntentId);
    releaseMail?.();
    await first;

    assert.equal(sends, 1);
  } finally {
    await database.close();
  }
});

test('supplier delivery rejects cross-organization message, invoice, and vendor records without sending SMTP', async (t) => {
  for (const [name, statement, code] of [
    [
      'message',
      `UPDATE messages SET organization_id = '00000000-0000-4000-8000-000000000099' WHERE id = '${messageId}'`,
      'SUPPLIER_MESSAGE_MISSING',
    ],
    [
      'invoice',
      `UPDATE invoices SET organization_id = '00000000-0000-4000-8000-000000000099' WHERE id = '${invoiceId}'`,
      'INVOICE_VENDOR_MISSING',
    ],
    [
      'vendor',
      `UPDATE vendors SET organization_id = '00000000-0000-4000-8000-000000000099' WHERE id = '${vendorId}'`,
      'INVOICE_VENDOR_MISSING',
    ],
  ] as const) {
    await t.test(`cross-organization ${name}`, async () => {
      const { database, db } = await createDatabase();
      try {
        await database.exec(statement);
        let sends = 0;
        const deliveries = createDeliveries(db as unknown as Db, {
          sendMail: async () => {
            sends += 1;
            return true;
          },
        });

        await assert.rejects(deliveries.deliver(supplierIntentId), new RegExp(code));
        assert.equal(sends, 0);
        const intent = await database.query<{
          status: string;
          attempts: number;
          lastError: string;
          leaseToken: string | null;
          leaseExpiresAt: string | null;
        }>(`
          SELECT status, attempts, last_error AS "lastError", lease_token AS "leaseToken", lease_expires_at AS "leaseExpiresAt"
          FROM invoice_review_notification_intents WHERE id = '${supplierIntentId}'
        `);
        assert.deepEqual(intent.rows, [
          {
            status: 'pending',
            attempts: 1,
            lastError: code,
            leaseToken: null,
            leaseExpiresAt: null,
          },
        ]);
      } finally {
        await database.close();
      }
    });
  }
});

test('reconciliation enqueues pending internal and supplier intents once each', async () => {
  const { database, db } = await createDatabase();
  try {
    await database.exec(`
      INSERT INTO invoice_review_notification_intents (
        id, organization_id, case_id, intent_kind, recipient_user_id, action, idempotency_key
      ) VALUES (
        '${internalIntentId}', '${organizationId}', '${caseId}', 'internal_notification',
        '00000000-0000-4000-8000-000000000008', 'claim', 'internal-delivery'
      )
    `);
    const enqueued: string[] = [];
    const deliveries = createDeliveries(db as unknown as Db, {
      add: async ({ intentId }) => {
        enqueued.push(intentId);
      },
    });

    await deliveries.enqueuePending();

    assert.deepEqual(new Set(enqueued), new Set([supplierIntentId, internalIntentId]));
    assert.equal(enqueued.length, 2);
  } finally {
    await database.close();
  }
});
