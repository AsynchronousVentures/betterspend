import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '@betterspend/db';
import type { Db } from '@betterspend/db';
import { InvoiceReviewCommands } from './invoice-review-commands';
import { InvoiceReviewNotificationsService } from './invoice-review-notifications.service';

const organizationId = '00000000-0000-4000-8000-000000000001';
const invoiceId = '00000000-0000-4000-8000-000000000002';
const actorId = '00000000-0000-4000-8000-000000000003';
const signalId = '00000000-0000-4000-8000-000000000004';

async function createDatabase(status = 'approved') {
  const database = new PGlite();
  await database.exec(`
    CREATE TABLE organizations (id uuid PRIMARY KEY);
    CREATE TABLE users (id uuid PRIMARY KEY, organization_id uuid NOT NULL, name varchar(255) NOT NULL, is_active boolean NOT NULL DEFAULT true);
    CREATE TABLE invoices (
      id uuid PRIMARY KEY, organization_id uuid NOT NULL, entity_id uuid, purchase_order_id uuid,
      status varchar(30) NOT NULL, paid_at timestamptz, created_by uuid
    );
    CREATE TABLE purchase_orders (id uuid PRIMARY KEY, requisition_id uuid);
    CREATE TABLE requisitions (id uuid PRIMARY KEY, department_id uuid, project_id uuid);
    CREATE TABLE spend_guard_alerts (id uuid PRIMARY KEY, org_id uuid NOT NULL, record_type varchar(50) NOT NULL, record_id uuid NOT NULL);
    CREATE TABLE ocr_jobs (id uuid PRIMARY KEY, organization_id uuid NOT NULL, invoice_id uuid);
    CREATE TABLE email_intake_items (id uuid PRIMARY KEY, organization_id uuid NOT NULL, created_draft_type varchar(30), created_draft_id uuid);
    CREATE TABLE invoice_review_cases (
      id uuid PRIMARY KEY, organization_id uuid NOT NULL, invoice_id uuid NOT NULL, state varchar(30) NOT NULL,
      owner_id uuid, version integer NOT NULL, opened_at timestamptz NOT NULL, resolved_at timestamptz,
      created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
    );
    CREATE TABLE invoice_review_signals (
      id uuid PRIMARY KEY, organization_id uuid NOT NULL, case_id uuid NOT NULL, signal_type varchar(50) NOT NULL,
      source_module varchar(50) NOT NULL, source_record_id varchar(255) NOT NULL, severity varchar(20) NOT NULL,
      status varchar(20) NOT NULL, summary text NOT NULL, details jsonb NOT NULL DEFAULT '{}'::jsonb,
      first_seen_at timestamptz NOT NULL, last_seen_at timestamptz NOT NULL, resolution_actor_id uuid,
      resolution_command varchar(50), resolution_reason text, resolved_at timestamptz,
      created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
    );
    CREATE TABLE messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, thread_type varchar(20) NOT NULL,
      thread_id uuid NOT NULL, sender_type varchar(10) NOT NULL, sender_id uuid, vendor_id uuid,
      recipient_vendor_id uuid, author_name varchar(255) NOT NULL, body text NOT NULL, attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(), idempotency_key varchar(255)
    );
    CREATE TABLE audit_log (
      id uuid PRIMARY KEY, organization_id uuid NOT NULL, user_id uuid, entity_type varchar(50) NOT NULL,
      entity_id uuid NOT NULL, action varchar(50) NOT NULL, changes jsonb, metadata jsonb,
      prev_hash varchar(64), entry_hash varchar(64), created_at timestamptz NOT NULL
    );
    CREATE TABLE audit_idempotency_keys (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, action varchar(50) NOT NULL,
      idempotency_key varchar(255) NOT NULL, audit_log_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (organization_id, action, idempotency_key)
    );
    CREATE TABLE invoice_review_notification_intents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, case_id uuid NOT NULL,
      recipient_user_id uuid NOT NULL, action varchar(50) NOT NULL, idempotency_key varchar(255) NOT NULL,
      status varchar(20) NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0, last_error text,
      delivered_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (organization_id, idempotency_key)
    );
    INSERT INTO organizations VALUES ('${organizationId}');
    INSERT INTO users (id, organization_id, name) VALUES ('${actorId}', '${organizationId}', 'AP reviewer');
    INSERT INTO invoices (id, organization_id, status) VALUES ('${invoiceId}', '${organizationId}', '${status}');
    INSERT INTO invoice_review_cases VALUES (
      '00000000-0000-4000-8000-000000000005', '${organizationId}', '${invoiceId}', 'open', NULL, 1,
      '2026-08-01T00:00:00Z', NULL, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'
    );
  `);
  return { database, db: drizzle(database, { schema }) };
}

function createCommands(
  db: Db,
  options: {
    createIntent?: () => Promise<string>;
    resolvePolicy?: () => Promise<{ policy: unknown }>;
  } = {},
) {
  const scheduled: string[][] = [];
  const notifications = {
    createIntent: options.createIntent ?? (async () => '00000000-0000-4000-8000-000000000006'),
    enqueue: async (ids: string[]) => scheduled.push(ids),
  };
  const policies = {
    resolve:
      options.resolvePolicy ??
      (async () => ({
        policy: {
          can: () => true,
          scopeFor: () => ({
            unrestricted: true,
            ownOnly: false,
            entityIds: [],
            departmentIds: [],
            projectIds: [],
          }),
          isGlobalBuiltInAdmin: () => true,
          toDocument: () => ({ permissions: [], scopes: {} }),
        },
      })),
  };
  return {
    commands: new InvoiceReviewCommands(db, notifications as never, policies as never),
    scheduled,
  };
}

test('claim is a serialized command that advances the aggregate version once', async () => {
  const { database, db } = await createDatabase();
  try {
    const { commands, scheduled } = createCommands(db as unknown as Db);
    const result = await commands.apply({ id: actorId, organizationId }, invoiceId, {
      action: 'claim',
      expectedVersion: 1,
    });

    assert.deepEqual(result.case, {
      id: '00000000-0000-4000-8000-000000000005',
      invoiceId,
      state: 'open',
      ownerId: actorId,
      version: 2,
      resolvedAt: null,
    });
    assert.deepEqual(scheduled, [['00000000-0000-4000-8000-000000000006']]);
  } finally {
    await database.close();
  }
});

test('match signals cannot be resolved or waived without changing their producer signal', async () => {
  const { database, db } = await createDatabase();
  try {
    await database.exec(`
      INSERT INTO invoice_review_signals VALUES (
        '${signalId}', '${organizationId}', '00000000-0000-4000-8000-000000000005', 'match_exception',
        'matching', '${invoiceId}', 'blocking', 'open', 'Match exception', '{}',
        now(), now(), NULL, NULL, NULL, NULL, now(), now()
      );
      UPDATE invoice_review_cases SET owner_id = '${actorId}' WHERE invoice_id = '${invoiceId}';
    `);
    const { commands } = createCommands(db as unknown as Db);
    for (const action of [
      { action: 'resolve_signal' as const, expectedVersion: 1, signalId },
      {
        action: 'waive_signal' as const,
        expectedVersion: 1,
        signalId,
        reason: 'Supplier contract permits this variance',
      },
    ]) {
      await assert.rejects(
        commands.apply({ id: actorId, organizationId }, invoiceId, action),
        (error: unknown) =>
          typeof error === 'object' &&
          error !== null &&
          'getResponse' in error &&
          typeof error.getResponse === 'function' &&
          (error.getResponse() as { code?: string }).code === 'MATCH_WAIVER_REJECTED',
      );
    }
    const result = await database.query<{ status: string; resolutionCommand: string | null }>(
      `SELECT status, resolution_command AS "resolutionCommand" FROM invoice_review_signals WHERE id = '${signalId}'`,
    );
    assert.deepEqual(result.rows, [{ status: 'open', resolutionCommand: null }]);
  } finally {
    await database.close();
  }
});

test('resolving one blocker keeps the case active until the final blocker is resolved', async () => {
  const secondSignalId = '00000000-0000-4000-8000-000000000007';
  const { database, db } = await createDatabase();
  try {
    await database.exec(`
      INSERT INTO invoice_review_signals VALUES
        ('${signalId}', '${organizationId}', '00000000-0000-4000-8000-000000000005', 'duplicate_risk',
         'spend_guard', '00000000-0000-4000-8000-000000000008', 'blocking', 'open', 'Duplicate risk', '{}', now(), now(), NULL, NULL, NULL, NULL, now(), now()),
        ('${secondSignalId}', '${organizationId}', '00000000-0000-4000-8000-000000000005', 'sender_risk',
         'spend_guard', '00000000-0000-4000-8000-000000000009', 'blocking', 'open', 'Sender risk', '{}', now(), now(), NULL, NULL, NULL, NULL, now(), now());
      UPDATE invoice_review_cases SET owner_id = '${actorId}' WHERE invoice_id = '${invoiceId}';
      INSERT INTO spend_guard_alerts VALUES ('00000000-0000-4000-8000-000000000008', '${organizationId}', 'invoice', '${invoiceId}');
      INSERT INTO spend_guard_alerts VALUES ('00000000-0000-4000-8000-000000000009', '${organizationId}', 'invoice', '${invoiceId}');
    `);
    const { commands } = createCommands(db as unknown as Db);
    const first = await commands.apply({ id: actorId, organizationId }, invoiceId, {
      action: 'resolve_signal',
      expectedVersion: 1,
      signalId,
    });
    assert.equal(first.case.state, 'open');

    const final = await commands.apply({ id: actorId, organizationId }, invoiceId, {
      action: 'resolve_signal',
      expectedVersion: 2,
      signalId: secondSignalId,
    });
    assert.equal(final.case.state, 'resolved');
  } finally {
    await database.close();
  }
});

test('financially final invoices reject review commands before a case mutation', async () => {
  const { database, db } = await createDatabase('paid');
  try {
    const { commands } = createCommands(db as unknown as Db);
    await assert.rejects(
      commands.apply({ id: actorId, organizationId }, invoiceId, {
        action: 'claim',
        expectedVersion: 1,
      }),
      (error: unknown) =>
        typeof error === 'object' &&
        error !== null &&
        'getResponse' in error &&
        typeof error.getResponse === 'function' &&
        (error.getResponse() as { code?: string }).code === 'INVOICE_PAID',
    );
    const result = await database.query<{ ownerId: string | null; version: number }>(
      `SELECT owner_id AS "ownerId", version FROM invoice_review_cases WHERE invoice_id = '${invoiceId}'`,
    );
    assert.deepEqual(result.rows, [{ ownerId: null, version: 1 }]);
  } finally {
    await database.close();
  }
});

test('every command rejects paid and cancelled invoices without mutating the review case', async () => {
  const actions = [
    { action: 'claim', expectedVersion: 1 },
    { action: 'release', expectedVersion: 1 },
    { action: 'reassign', expectedVersion: 1, assigneeId: actorId, reason: 'Workload balance' },
    { action: 'request_supplier_info', expectedVersion: 1, message: 'Please clarify the invoice.' },
    { action: 'mark_info_received', expectedVersion: 1 },
    { action: 'resolve_signal', expectedVersion: 1, signalId },
    { action: 'waive_signal', expectedVersion: 1, signalId, reason: 'Approved exception' },
  ] as const;
  for (const [status, code] of [
    ['paid', 'INVOICE_PAID'],
    ['cancelled', 'INVOICE_CANCELLED'],
  ] as const) {
    const { database, db } = await createDatabase(status);
    try {
      const { commands } = createCommands(db as unknown as Db);
      for (const action of actions) {
        await assert.rejects(
          commands.apply({ id: actorId, organizationId }, invoiceId, action),
          (error: unknown) =>
            typeof error === 'object' &&
            error !== null &&
            'getResponse' in error &&
            typeof error.getResponse === 'function' &&
            (error.getResponse() as { code?: string }).code === code,
        );
      }
    } finally {
      await database.close();
    }
  }
});

test('stale, hidden, and ineligible commands return stable contract errors', async () => {
  const { database, db } = await createDatabase();
  try {
    const { commands: permittedCommands } = createCommands(db as unknown as Db);
    const { commands } = createCommands(db as unknown as Db, {
      resolvePolicy: async () => ({
        policy: {
          can: () => false,
          scopeFor: () => ({
            unrestricted: false,
            ownOnly: false,
            entityIds: [],
            departmentIds: [],
            projectIds: [],
          }),
        },
      }),
    });
    await assert.rejects(
      permittedCommands.apply({ id: actorId, organizationId }, invoiceId, {
        action: 'claim',
        expectedVersion: 2,
      }),
      /REVIEW STALE VERSION/,
    );
    const noAccess = {
      can: () => false,
      scopeFor: () => ({
        unrestricted: false,
        ownOnly: false,
        entityIds: [],
        departmentIds: [],
        projectIds: [],
      }),
      isGlobalBuiltInAdmin: () => false,
      toDocument: () => ({ permissions: [], scopes: {} }),
    };
    await assert.rejects(
      commands.apply({ id: actorId, organizationId, access: noAccess as never }, invoiceId, {
        action: 'claim',
        expectedVersion: 1,
      }),
      /REVIEW NOT FOUND/,
    );
    const globalAdmin = {
      can: () => true,
      scopeFor: () => ({
        unrestricted: true,
        ownOnly: false,
        entityIds: [],
        departmentIds: [],
        projectIds: [],
      }),
      isGlobalBuiltInAdmin: () => true,
      toDocument: () => ({ permissions: [], scopes: {} }),
    };
    await assert.rejects(
      commands.apply({ id: actorId, organizationId, access: globalAdmin as never }, invoiceId, {
        action: 'reassign',
        expectedVersion: 1,
        assigneeId: actorId,
        reason: 'Rotate the queue',
      }),
      /INVALID ASSIGNEE/,
    );
  } finally {
    await database.close();
  }
});

test('supplier messages roll back when durable notification intent persistence fails', async () => {
  const { database, db } = await createDatabase();
  try {
    await database.exec(
      `UPDATE invoice_review_cases SET owner_id = '${actorId}' WHERE invoice_id = '${invoiceId}'`,
    );
    const { commands } = createCommands(db as unknown as Db, {
      createIntent: async () => {
        throw new Error('intent persistence unavailable');
      },
    });
    await assert.rejects(
      commands.apply({ id: actorId, organizationId }, invoiceId, {
        action: 'request_supplier_info',
        expectedVersion: 1,
        message: 'Please send the remittance reference.',
      }),
      /intent persistence unavailable/,
    );
    const rows = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM messages',
    );
    assert.equal(rows.rows[0]?.count, '0');
  } finally {
    await database.close();
  }
});

test('two simultaneous claims produce one success and one stale-version result', async () => {
  const { database, db } = await createDatabase();
  try {
    const { commands } = createCommands(db as unknown as Db);
    const command = { action: 'claim' as const, expectedVersion: 1 };
    const results = await Promise.allSettled([
      commands.apply({ id: actorId, organizationId }, invoiceId, command),
      commands.apply({ id: actorId, organizationId }, invoiceId, command),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = results.find((result) => result.status === 'rejected');
    assert.match(String(rejected?.reason), /REVIEW STALE VERSION|INVALID TRANSITION/);
  } finally {
    await database.close();
  }
});

test('durable notification intent retries after failure and delivers once', async () => {
  const { database, db } = await createDatabase();
  try {
    await database.exec(`
      INSERT INTO invoice_review_notification_intents (
        id, organization_id, case_id, recipient_user_id, action, idempotency_key, status
      ) VALUES (
        '00000000-0000-4000-8000-000000000006', '${organizationId}',
        '00000000-0000-4000-8000-000000000005', '${actorId}', 'claim', 'case:2:claim:${actorId}', 'pending'
      );
    `);
    let calls = 0;
    const service = new InvoiceReviewNotificationsService(
      { add: async () => undefined } as never,
      db as unknown as Db,
      {
        createIdempotent: async () => {
          calls += 1;
          if (calls === 1) throw new Error('notification store unavailable');
        },
      } as never,
    );
    await assert.rejects(service.deliver('00000000-0000-4000-8000-000000000006'));
    await service.deliver('00000000-0000-4000-8000-000000000006');
    await service.deliver('00000000-0000-4000-8000-000000000006');
    assert.equal(calls, 2);
    const row = await database.query<{ status: string; attempts: number }>(
      `SELECT status, attempts FROM invoice_review_notification_intents WHERE id = '00000000-0000-4000-8000-000000000006'`,
    );
    assert.deepEqual(row.rows, [{ status: 'delivered', attempts: 2 }]);
  } finally {
    await database.close();
  }
});

test('notification reconciliation keysets past rows delivered from an earlier page', async () => {
  const { database, db } = await createDatabase();
  try {
    const intents = Array.from({ length: 101 }, (_, index) => {
      const id = `00000000-0000-4000-8000-${(index + 100).toString(16).padStart(12, '0')}`;
      return `('${id}', '${organizationId}', '00000000-0000-4000-8000-000000000005', '${actorId}', 'claim', 'reconcile-${index}', 'pending', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z')`;
    });
    await database.exec(`
      INSERT INTO invoice_review_notification_intents (
        id, organization_id, case_id, recipient_user_id, action, idempotency_key, status, created_at, updated_at
      ) VALUES ${intents.join(',')};
    `);
    const queued: string[] = [];
    const service = new InvoiceReviewNotificationsService(
      {
        add: async (_name: string, data: { intentId: string }) => {
          queued.push(data.intentId);
          await database.exec(
            `UPDATE invoice_review_notification_intents SET status = 'delivered' WHERE id = '${data.intentId}'`,
          );
        },
      } as never,
      db as unknown as Db,
      { createIdempotent: async () => undefined } as never,
    );

    await service.enqueuePending(100);

    assert.equal(queued.length, 101);
    assert.equal(new Set(queued).size, 101);
  } finally {
    await database.close();
  }
});

test('notification reconciliation preserves microsecond cursor precision without duplicate enqueues', async () => {
  const { database, db } = await createDatabase();
  try {
    const intents = Array.from({ length: 101 }, (_, index) => {
      const id = `00000000-0000-4000-8000-${(index + 300).toString(16).padStart(12, '0')}`;
      const createdAt = `2026-08-01T00:00:00.${(index + 1).toString().padStart(6, '0')}Z`;
      return `('${id}', '${organizationId}', '00000000-0000-4000-8000-000000000005', '${actorId}', 'claim', 'microsecond-${index}', 'pending', '${createdAt}', '${createdAt}')`;
    });
    await database.exec(`
      INSERT INTO invoice_review_notification_intents (
        id, organization_id, case_id, recipient_user_id, action, idempotency_key, status, created_at, updated_at
      ) VALUES ${intents.join(',')};
    `);
    const queued: string[] = [];
    const service = new InvoiceReviewNotificationsService(
      {
        add: async (_name: string, data: { intentId: string }) => {
          queued.push(data.intentId);
          if (queued.length === 200) {
            await database.exec(
              "UPDATE invoice_review_notification_intents SET status = 'delivered' WHERE status = 'pending'",
            );
          }
        },
      } as never,
      db as unknown as Db,
      { createIdempotent: async () => undefined } as never,
    );

    await service.enqueuePending(100);

    assert.equal(queued.length, 101);
    assert.equal(new Set(queued).size, 101);
  } finally {
    await database.close();
  }
});

test('signal source validation checks durable producers and preserves manual or unknown sources', async () => {
  const sources: ReadonlyArray<{
    name: string;
    module: string;
    recordId: string;
    sourceSql: string;
    code?: 'SOURCE_MISSING';
  }> = [
    {
      name: 'matching identity mismatch',
      module: 'matching',
      recordId: '00000000-0000-4000-8000-000000000099',
      sourceSql: '',
      code: 'SOURCE_MISSING',
    },
    {
      name: 'missing spend guard alert',
      module: 'spend_guard',
      recordId: '00000000-0000-4000-8000-000000000010',
      sourceSql: '',
      code: 'SOURCE_MISSING',
    },
    {
      name: 'spend guard alert for another record type',
      module: 'spend_guard',
      recordId: '00000000-0000-4000-8000-000000000011',
      sourceSql: `INSERT INTO spend_guard_alerts VALUES ('00000000-0000-4000-8000-000000000011', '${organizationId}', 'requisition', '${invoiceId}');`,
      code: 'SOURCE_MISSING',
    },
    {
      name: 'valid spend guard invoice alert',
      module: 'spend_guard',
      recordId: '00000000-0000-4000-8000-000000000012',
      sourceSql: `INSERT INTO spend_guard_alerts VALUES ('00000000-0000-4000-8000-000000000012', '${organizationId}', 'invoice', '${invoiceId}');`,
    },
    {
      name: 'missing OCR job',
      module: 'ocr',
      recordId: '00000000-0000-4000-8000-000000000013',
      sourceSql: '',
      code: 'SOURCE_MISSING',
    },
    {
      name: 'valid OCR job',
      module: 'OCR',
      recordId: '00000000-0000-4000-8000-000000000014',
      sourceSql: `INSERT INTO ocr_jobs VALUES ('00000000-0000-4000-8000-000000000014', '${organizationId}', '${invoiceId}');`,
    },
    {
      name: 'missing email intake item',
      module: 'email_intake',
      recordId: '00000000-0000-4000-8000-000000000015',
      sourceSql: '',
      code: 'SOURCE_MISSING',
    },
    {
      name: 'email intake item for another draft type',
      module: 'email_intake',
      recordId: '00000000-0000-4000-8000-000000000016',
      sourceSql: `INSERT INTO email_intake_items VALUES ('00000000-0000-4000-8000-000000000016', '${organizationId}', 'requisition', '${invoiceId}');`,
      code: 'SOURCE_MISSING',
    },
    {
      name: 'valid email intake invoice draft',
      module: 'email_intake',
      recordId: '00000000-0000-4000-8000-000000000017',
      sourceSql: `INSERT INTO email_intake_items VALUES ('00000000-0000-4000-8000-000000000017', '${organizationId}', 'invoice', '${invoiceId}');`,
    },
    { name: 'valid matching identity', module: 'matching', recordId: invoiceId, sourceSql: '' },
    { name: 'manual source', module: 'manual', recordId: 'manual-correction-1', sourceSql: '' },
    { name: 'unknown legacy source', module: 'legacy_import', recordId: 'legacy-1', sourceSql: '' },
  ];

  for (const source of sources) {
    const { database, db } = await createDatabase();
    try {
      await database.exec(`
        INSERT INTO invoice_review_signals VALUES (
          '${signalId}', '${organizationId}', '00000000-0000-4000-8000-000000000005', 'duplicate_risk',
          '${source.module}', '${source.recordId}', 'blocking', 'open', 'Source validation', '{}',
          now(), now(), NULL, NULL, NULL, NULL, now(), now()
        );
        UPDATE invoice_review_cases SET owner_id = '${actorId}' WHERE invoice_id = '${invoiceId}';
        ${source.sourceSql}
      `);
      const { commands } = createCommands(db as unknown as Db);
      const action = { action: 'resolve_signal' as const, expectedVersion: 1, signalId };
      if (source.code) {
        await assert.rejects(
          commands.apply({ id: actorId, organizationId }, invoiceId, action),
          (error: unknown) =>
            typeof error === 'object' &&
            error !== null &&
            'getResponse' in error &&
            typeof error.getResponse === 'function' &&
            (error.getResponse() as { code?: string }).code === source.code,
          source.name,
        );
      } else {
        const result = await commands.apply({ id: actorId, organizationId }, invoiceId, action);
        assert.equal(result.case.version, 2, source.name);
      }
    } finally {
      await database.close();
    }
  }
});
