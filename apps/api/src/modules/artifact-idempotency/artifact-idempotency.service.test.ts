import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import { artifactNotificationDeliveries, artifactOperations } from '@betterspend/db';
import type { Db } from '@betterspend/db';
import {
  ArtifactIdempotencyService,
  type ArtifactOperationPlan,
} from './artifact-idempotency.service';

type OperationRow = typeof artifactOperations.$inferSelect;
type DeliveryRow = typeof artifactNotificationDeliveries.$inferSelect;
type StoreRow = OperationRow | DeliveryRow;

/**
 * A small Drizzle adapter that evaluates the actual where clauses produced by
 * the coordinator. It keeps the tests at the service seam while preserving
 * status, lease, and operation guards instead of returning the first row.
 */
class ArtifactOperationStore {
  readonly rows: OperationRow[] = [];
  readonly deliveries: DeliveryRow[] = [];
  readonly conflictTargets: Array<{ table: unknown; target: unknown[] | undefined }> = [];
  beforeUpdate?: (row: StoreRow, values: Record<string, unknown>) => void;

  async transaction<TResult>(callback: (tx: ArtifactOperationStore) => Promise<TResult>) {
    return callback(this);
  }

  insert(table: unknown) {
    return new InsertBuilder(this, table);
  }

  select() {
    return new SelectBuilder(this);
  }

  update(table: unknown) {
    return new UpdateBuilder(this, table);
  }

  addRow(table: unknown, values: Record<string, unknown>): StoreRow[] {
    if (table === artifactNotificationDeliveries) {
      const organizationId = String(values.organizationId);
      const operationId = String(values.operationId);
      const deliveryKey = String(values.deliveryKey);
      if (
        this.deliveries.some(
          (row) => row.operationId === operationId && row.deliveryKey === deliveryKey,
        )
      ) {
        return [];
      }
      const now = new Date();
      const row: DeliveryRow = {
        id: `delivery-${this.deliveries.length + 1}`,
        organizationId,
        operationId,
        deliveryKey,
        status: 'pending',
        attempts: 0,
        lastError: null,
        leaseToken: null,
        leaseExpiresAt: null,
        deliveredAt: null,
        createdAt: now,
        updatedAt: now,
      };
      this.deliveries.push(row);
      return [row];
    }
    if (table !== artifactOperations) return [];
    const organizationId = String(values.organizationId);
    const idempotencyKey = String(values.idempotencyKey);
    if (
      this.rows.some(
        (row) => row.organizationId === organizationId && row.idempotencyKey === idempotencyKey,
      )
    ) {
      return [];
    }

    const now = new Date();
    const row: OperationRow = {
      id: `operation-${this.rows.length + 1}`,
      organizationId,
      operationType: String(values.operationType),
      idempotencyKey,
      requestHash: String(values.requestHash),
      status: 'pending',
      artifactKind: null,
      artifactId: null,
      artifactNumber: null,
      attempts: 0,
      lastError: null,
      leaseToken: null,
      leaseExpiresAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(row);
    return [row];
  }

  readRows(table: unknown, condition?: unknown): StoreRow[] {
    const rows = table === artifactOperations ? this.rows : this.deliveries;
    return rows.filter((row) => evaluateCondition(condition, row));
  }

  writeRows(table: unknown, values: Record<string, unknown>, condition?: unknown): StoreRow[] {
    const rows = table === artifactOperations ? this.rows : this.deliveries;
    const updated: StoreRow[] = [];
    for (const row of rows) {
      if (!evaluateCondition(condition, row)) continue;
      this.beforeUpdate?.(row, values);
      if (!evaluateCondition(condition, row)) continue;
      for (const [key, value] of Object.entries(values)) {
        if (key === 'attempts') {
          row.attempts += 1;
        } else if (key in row) {
          (row as unknown as Record<string, unknown>)[key] = value;
        }
      }
      row.updatedAt = new Date();
      updated.push(row);
    }
    return updated;
  }
}

class InsertBuilder {
  private valuesToInsert: Record<string, unknown> = {};

  constructor(
    private readonly store: ArtifactOperationStore,
    private readonly table: unknown,
  ) {}

  values(values: Record<string, unknown>) {
    this.valuesToInsert = values;
    return this;
  }

  onConflictDoNothing(config?: { target?: unknown[] }) {
    this.store.conflictTargets.push({ table: this.table, target: config?.target });
    return this;
  }

  returning() {
    return Promise.resolve(this.store.addRow(this.table, this.valuesToInsert));
  }
}

class SelectBuilder {
  private table: unknown;
  private condition?: unknown;

  constructor(private readonly store: ArtifactOperationStore) {}

  from(table: unknown) {
    this.table = table;
    return this;
  }

  where(condition: unknown) {
    this.condition = condition;
    return this;
  }

  limit(limit: number) {
    return Promise.resolve(this.store.readRows(this.table, this.condition).slice(0, limit));
  }
}

class UpdateBuilder {
  private valuesToUpdate: Record<string, unknown> = {};

  constructor(
    private readonly store: ArtifactOperationStore,
    private readonly table: unknown,
  ) {}

  set(values: Record<string, unknown>) {
    this.valuesToUpdate = values;
    return this;
  }

  where(condition: unknown) {
    return new UpdateResult(this.store, this.table, this.valuesToUpdate, condition);
  }
}

class UpdateResult {
  constructor(
    private readonly store: ArtifactOperationStore,
    private readonly table: unknown,
    private readonly values: Record<string, unknown>,
    private readonly condition: unknown,
  ) {}

  returning(_fields?: unknown) {
    return Promise.resolve(this.store.writeRows(this.table, this.values, this.condition));
  }

  then<TResult>(
    onFulfilled?: (value: StoreRow[]) => TResult | PromiseLike<TResult>,
    onRejected?: (reason: unknown) => TResult | PromiseLike<TResult>,
  ) {
    return Promise.resolve(this.store.writeRows(this.table, this.values, this.condition)).then(
      onFulfilled,
      onRejected,
    );
  }
}

function createPlan(
  _store: ArtifactOperationStore,
  overrides: Partial<ArtifactOperationPlan<{ id: string }>> = {},
): ArtifactOperationPlan<{ id: string }> {
  return {
    organizationId: 'org-1',
    operationType: 'message_post',
    idempotencyKey: 'message:user:request-1',
    fingerprint: 'message-intent-1',
    findExisting: async () => null,
    create: async () => ({ kind: 'message', id: 'message-1' }),
    link: async (artifact) => ({ id: artifact.id }),
    load: async (artifact) => ({ id: artifact.id }),
    ...overrides,
  };
}

test('artifact operation resumes linkage without creating a second artifact', async () => {
  const store = new ArtifactOperationStore();
  const service = new ArtifactIdempotencyService(store as unknown as Db);
  let createCalls = 0;
  let linkCalls = 0;
  let notifyCalls = 0;
  let failLink = true;
  let ownerIdempotencyKey: string | undefined;
  const plan = createPlan(store, {
    findExisting: async (key) => {
      ownerIdempotencyKey = key;
      return null;
    },
    create: async (key) => {
      ownerIdempotencyKey = key;
      createCalls += 1;
      return { kind: 'message', id: 'message-1' };
    },
    link: async (artifact) => {
      linkCalls += 1;
      if (failLink) {
        failLink = false;
        throw new Error('link temporarily unavailable');
      }
      return { id: artifact.id };
    },
    notify: async () => {
      notifyCalls += 1;
    },
  });

  await assert.rejects(service.execute(plan), /link temporarily unavailable/);
  const resumed = await service.execute(plan);

  assert.deepEqual(resumed, {
    value: { id: 'message-1' },
    replayed: false,
    resumed: true,
  });
  assert.equal(createCalls, 1);
  assert.equal(linkCalls, 2);
  assert.equal(notifyCalls, 1);
  assert.equal(ownerIdempotencyKey, 'artifact-operation:operation-1');
  assert.equal(store.rows[0]?.status, 'completed');
  assert.equal(store.rows[0]?.artifactId, 'message-1');
});

test('reservations target only their organization-scoped idempotency constraints', async () => {
  const store = new ArtifactOperationStore();
  const service = new ArtifactIdempotencyService(store as unknown as Db);
  const plan = createPlan(store, {
    notify: async (_value, delivery) =>
      delivery.once('vendor-email:vendor-1', async () => undefined),
  });

  await service.execute(plan);
  const replay = await service.execute(plan);

  assert.equal(replay.replayed, true);
  assert.deepEqual(store.conflictTargets, [
    {
      table: artifactOperations,
      target: [artifactOperations.organizationId, artifactOperations.idempotencyKey],
    },
    {
      table: artifactNotificationDeliveries,
      target: [
        artifactNotificationDeliveries.operationId,
        artifactNotificationDeliveries.deliveryKey,
      ],
    },
    {
      table: artifactOperations,
      target: [artifactOperations.organizationId, artifactOperations.idempotencyKey],
    },
  ]);
  assert.equal(store.rows.length, 1);
  assert.equal(store.deliveries.length, 1);
});

test('completed operations return the original result without rerunning linkage', async () => {
  const store = new ArtifactOperationStore();
  const service = new ArtifactIdempotencyService(store as unknown as Db);
  let linkCalls = 0;
  let loadCalls = 0;
  let notifyCalls = 0;
  const plan = createPlan(store, {
    link: async (artifact) => {
      linkCalls += 1;
      return { id: artifact.id };
    },
    load: async (artifact) => {
      loadCalls += 1;
      return { id: artifact.id };
    },
    notify: async () => {
      notifyCalls += 1;
    },
  });

  await service.execute(plan);
  const replay = await service.execute(plan);

  assert.deepEqual(replay, {
    value: { id: 'message-1' },
    replayed: true,
    resumed: false,
  });
  assert.equal(linkCalls, 1);
  assert.equal(loadCalls, 1);
  assert.equal(notifyCalls, 1);
});

test('notification failure leaves a created artifact retryable', async () => {
  const store = new ArtifactOperationStore();
  const service = new ArtifactIdempotencyService(store as unknown as Db);
  let createCalls = 0;
  let notifyCalls = 0;
  let failNotification = true;
  const plan = createPlan(store, {
    create: async () => {
      createCalls += 1;
      return { kind: 'message', id: 'message-1' };
    },
    notify: async () => {
      notifyCalls += 1;
      if (failNotification) {
        failNotification = false;
        throw new Error('notification temporarily unavailable');
      }
    },
  });

  await assert.rejects(service.execute(plan), /notification temporarily unavailable/);
  const resumed = await service.execute(plan);

  assert.deepEqual(resumed, {
    value: { id: 'message-1' },
    replayed: false,
    resumed: true,
  });
  assert.equal(createCalls, 1);
  assert.equal(notifyCalls, 2);
  assert.equal(store.rows[0]?.status, 'completed');
});

test('successful recipients are not redelivered when a later recipient fails', async () => {
  const store = new ArtifactOperationStore();
  const service = new ArtifactIdempotencyService(store as unknown as Db);
  let firstRecipientCalls = 0;
  let secondRecipientCalls = 0;
  let failSecondRecipient = true;
  const plan = createPlan(store, {
    notify: async (_value, delivery) => {
      await delivery.once('vendor-email:vendor-1', async () => {
        firstRecipientCalls += 1;
      });
      await delivery.once('vendor-email:vendor-2', async () => {
        secondRecipientCalls += 1;
        if (failSecondRecipient) {
          failSecondRecipient = false;
          throw new Error('second recipient temporarily unavailable');
        }
      });
    },
  });

  await assert.rejects(service.execute(plan), /second recipient temporarily unavailable/);
  await service.execute(plan);

  assert.equal(firstRecipientCalls, 1);
  assert.equal(secondRecipientCalls, 2);
  assert.deepEqual(
    store.deliveries.map(({ organizationId, deliveryKey, status }) => ({
      organizationId,
      deliveryKey,
      status,
    })),
    [
      { organizationId: 'org-1', deliveryKey: 'vendor-email:vendor-1', status: 'delivered' },
      { organizationId: 'org-1', deliveryKey: 'vendor-email:vendor-2', status: 'delivered' },
    ],
  );
});

test('a completed delivery is skipped when operation completion must retry', async () => {
  const store = new ArtifactOperationStore();
  const service = new ArtifactIdempotencyService(store as unknown as Db);
  let notifyCalls = 0;
  let rejectCompletion = true;
  store.beforeUpdate = (row, values) => {
    if ('operationType' in row && values.status === 'completed' && rejectCompletion) {
      rejectCompletion = false;
      row.leaseToken = 'lease-stolen';
    }
  };
  const plan = createPlan(store, {
    notify: async (_value, delivery) =>
      delivery.once('vendor-email:vendor-1', async () => {
        notifyCalls += 1;
      }),
  });

  await assert.rejects(service.execute(plan), /lease was lost after linkage/);
  store.rows[0]!.leaseExpiresAt = new Date(0);
  await service.execute(plan);

  assert.equal(notifyCalls, 1);
  assert.equal(store.rows[0]?.status, 'completed');
});

test('delivery retries reuse the same downstream identity after status persistence fails', async () => {
  const store = new ArtifactOperationStore();
  const service = new ArtifactIdempotencyService(store as unknown as Db);
  const identities: string[] = [];
  let rejectDeliveredStatus = true;
  store.beforeUpdate = (row, values) => {
    if ('deliveryKey' in row && values.status === 'delivered' && rejectDeliveredStatus) {
      rejectDeliveredStatus = false;
      row.organizationId = 'org-2';
    }
  };
  const plan = createPlan(store, {
    notify: async (_value, delivery) =>
      delivery.once('vendor-email:vendor-1', async (identity) => {
        identities.push(identity);
      }),
  });

  await assert.rejects(service.execute(plan), /Notification delivery lease was lost/);
  assert.equal(store.deliveries[0]?.status, 'pending');
  store.deliveries[0]!.organizationId = 'org-1';
  store.deliveries[0]!.leaseExpiresAt = new Date(0);
  await service.execute(plan);

  assert.equal(identities.length, 2);
  assert.equal(identities[0], identities[1]);
  assert.match(identities[0]!, /^artifact-[a-f0-9]{64}@betterspend\.local$/);
});

test('delivery recovery never loads a reservation from another organization', async () => {
  const store = new ArtifactOperationStore();
  const service = new ArtifactIdempotencyService(store as unknown as Db);
  let failDelivery = true;
  const plan = createPlan(store, {
    notify: async (_value, delivery) =>
      delivery.once('vendor-email:vendor-1', async () => {
        if (failDelivery) {
          failDelivery = false;
          throw new Error('delivery temporarily unavailable');
        }
      }),
  });

  await assert.rejects(service.execute(plan), /delivery temporarily unavailable/);
  store.rows[0]!.leaseExpiresAt = new Date(0);
  store.deliveries[0]!.organizationId = 'org-2';

  await assert.rejects(
    service.execute(plan),
    /Artifact notification delivery reservation was not found/,
  );
});

test('an idempotency key cannot be reused for a different request', async () => {
  const store = new ArtifactOperationStore();
  const service = new ArtifactIdempotencyService(store as unknown as Db);
  const plan = createPlan(store);
  await service.execute(plan);

  await assert.rejects(
    service.execute({ ...plan, fingerprint: 'different-message-intent' }),
    (error: unknown) => error instanceof ConflictException,
  );
});

test('a live lease rejects a second caller before artifact creation', async () => {
  const store = new ArtifactOperationStore();
  const now = new Date();
  store.rows.push({
    id: 'operation-live',
    organizationId: 'org-1',
    operationType: 'message_post',
    idempotencyKey: 'message:user:request-1',
    requestHash: 'message-intent-1',
    status: 'pending',
    artifactKind: null,
    artifactId: null,
    artifactNumber: null,
    attempts: 1,
    lastError: null,
    leaseToken: 'lease-live',
    leaseExpiresAt: new Date(now.getTime() + 60_000),
    createdAt: now,
    updatedAt: now,
  });
  const service = new ArtifactIdempotencyService(store as unknown as Db);
  let createCalls = 0;

  await assert.rejects(
    service.execute(
      createPlan(store, {
        create: async () => {
          createCalls += 1;
          return { kind: 'message', id: 'message-2' };
        },
      }),
    ),
    (error: unknown) => error instanceof ConflictException,
  );
  assert.equal(createCalls, 0);
  assert.equal(store.rows[0]?.leaseToken, 'lease-live');
});

test('a lost lease rejects artifact recording and does not claim the operation', async () => {
  const store = new ArtifactOperationStore();
  store.beforeUpdate = (row, values) => {
    if ('artifactKind' in values) row.leaseToken = 'lease-stolen';
  };
  const service = new ArtifactIdempotencyService(store as unknown as Db);

  await assert.rejects(
    service.execute(createPlan(store)),
    (error: unknown) => error instanceof ConflictException,
  );
  assert.equal(store.rows[0]?.status, 'pending');
  assert.equal(store.rows[0]?.artifactId, null);
  assert.equal(store.rows[0]?.leaseToken, 'lease-stolen');
});

function evaluateCondition(condition: unknown, row: StoreRow): boolean {
  if (!condition) return true;
  const query = new PgDialect().sqlToQuery(condition as never);
  return new ConditionParser(tokenize(query.sql), query.params, row).parse();
}

function tokenize(sql: string): string[] {
  return (
    sql.match(
      /"[^"]+"\."[^"]+"|"[^"]+"|\$\d+|<>|<=|>=|=|<|>|\(|\)|\bAND\b|\bOR\b|\bIS\b|\bNULL\b/gi,
    ) ?? []
  );
}

class ConditionParser {
  private index = 0;

  constructor(
    private readonly tokens: string[],
    private readonly params: unknown[],
    private readonly row: StoreRow,
  ) {}

  parse(): boolean {
    return this.parseOr();
  }

  private parseOr(): boolean {
    let result = this.parseAnd();
    while (this.peekLower() === 'or') {
      this.index += 1;
      result = this.parseAnd() || result;
    }
    return result;
  }

  private parseAnd(): boolean {
    let result = this.parsePrimary();
    while (this.peekLower() === 'and') {
      this.index += 1;
      result = this.parsePrimary() && result;
    }
    return result;
  }

  private parsePrimary(): boolean {
    if (this.peek() === '(') {
      this.index += 1;
      const result = this.parseOr();
      this.expect(')');
      return result;
    }
    return this.parseComparison();
  }

  private parseComparison(): boolean {
    const column = this.next();
    const operator = this.next().toLowerCase();
    const key = columnName(column);
    const actual = (this.row as unknown as Record<string, unknown>)[key];

    if (operator === 'is') {
      this.expect('null');
      return actual == null;
    }

    const parameter = this.next();
    const expected = this.params[Number(parameter.slice(1)) - 1];
    return compareValues(actual, expected, operator);
  }

  private peek() {
    return this.tokens[this.index] ?? '';
  }

  private peekLower() {
    return this.peek().toLowerCase();
  }

  private next() {
    const token = this.peek();
    this.index += 1;
    return token;
  }

  private expect(expected: string) {
    const token = this.next().toLowerCase();
    assert.equal(token, expected.toLowerCase());
  }
}

function columnName(token: string): keyof (OperationRow & DeliveryRow) {
  const name = token.split('.').at(-1)?.replaceAll('"', '');
  const columnMap: Record<string, keyof (OperationRow & DeliveryRow)> = {
    id: 'id',
    organization_id: 'organizationId',
    operation_type: 'operationType',
    idempotency_key: 'idempotencyKey',
    request_hash: 'requestHash',
    status: 'status',
    artifact_kind: 'artifactKind',
    artifact_id: 'artifactId',
    artifact_number: 'artifactNumber',
    attempts: 'attempts',
    last_error: 'lastError',
    lease_token: 'leaseToken',
    lease_expires_at: 'leaseExpiresAt',
    created_at: 'createdAt',
    updated_at: 'updatedAt',
    operation_id: 'operationId',
    delivery_key: 'deliveryKey',
    delivered_at: 'deliveredAt',
  };
  const result = name ? columnMap[name] : undefined;
  if (!result) throw new Error(`Unknown artifact operation column ${name}`);
  return result;
}

function compareValues(actual: unknown, expected: unknown, operator: string): boolean {
  if (operator === '=' || operator === '<>') {
    const equal = String(actual) === String(expected);
    return operator === '=' ? equal : !equal;
  }

  const actualComparable = comparable(actual);
  const expectedComparable = comparable(expected);
  if (typeof actualComparable === 'number' && typeof expectedComparable === 'number') {
    return operator === '<'
      ? actualComparable < expectedComparable
      : actualComparable > expectedComparable;
  }
  return operator === '<'
    ? String(actualComparable) < String(expectedComparable)
    : String(actualComparable) > String(expectedComparable);
}

function comparable(value: unknown): number | string | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' && value.includes('T')) {
    const timestamp = Date.parse(value);
    if (!Number.isNaN(timestamp)) return timestamp;
  }
  return value == null ? null : String(value);
}
