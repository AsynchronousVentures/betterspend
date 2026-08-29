import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException } from '@nestjs/common';
import { artifactOperations } from '@betterspend/db';
import type { Db } from '@betterspend/db';
import {
  ArtifactIdempotencyService,
  type ArtifactOperationPlan,
} from './artifact-idempotency.service';

type OperationRow = typeof artifactOperations.$inferSelect;

class ArtifactOperationStore {
  readonly rows: OperationRow[] = [];

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

  private insertRow(table: unknown, values: Record<string, unknown>): OperationRow[] {
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
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rows.push(row);
    return [row];
  }

  private updateRows(values: Record<string, unknown>): OperationRow[] {
    const row = this.rows[0];
    if (!row) return [];
    for (const [key, value] of Object.entries(values)) {
      if (key === 'attempts') {
        row.attempts += 1;
      } else if (key in row) {
        (row as unknown as Record<string, unknown>)[key] = value;
      }
    }
    row.updatedAt = new Date();
    return [row];
  }

  readRows(table: unknown): OperationRow[] {
    return table === artifactOperations ? [...this.rows] : [];
  }

  writeRows(table: unknown, values: Record<string, unknown>): OperationRow[] {
    return table === artifactOperations ? this.updateRows(values) : [];
  }

  addRow(table: unknown, values: Record<string, unknown>): OperationRow[] {
    return this.insertRow(table, values);
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

  onConflictDoNothing() {
    return this;
  }

  returning() {
    return Promise.resolve(this.store.addRow(this.table, this.valuesToInsert));
  }
}

class SelectBuilder {
  private table: unknown;

  constructor(private readonly store: ArtifactOperationStore) {}

  from(table: unknown) {
    this.table = table;
    return this;
  }

  where(_condition: unknown) {
    return this;
  }

  limit(_limit: number) {
    return Promise.resolve(this.store.readRows(this.table));
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

  where(_condition: unknown) {
    return new UpdateResult(this.store, this.table, this.valuesToUpdate);
  }
}

class UpdateResult {
  constructor(
    private readonly store: ArtifactOperationStore,
    private readonly table: unknown,
    private readonly values: Record<string, unknown>,
  ) {}

  returning(_fields?: unknown) {
    return Promise.resolve(this.store.writeRows(this.table, this.values));
  }

  then<TResult>(
    onFulfilled?: (value: OperationRow[]) => TResult | PromiseLike<TResult>,
    onRejected?: (reason: unknown) => TResult | PromiseLike<TResult>,
  ) {
    return Promise.resolve(this.store.writeRows(this.table, this.values)).then(
      onFulfilled,
      onRejected,
    );
  }
}

function createPlan(
  store: ArtifactOperationStore,
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
  let failLink = true;
  const plan = createPlan(store, {
    create: async () => {
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
  });

  await assert.rejects(service.execute(plan), /link temporarily unavailable/);
  const resumed = await service.execute(plan);

  assert.deepEqual(resumed, { value: { id: 'message-1' }, replayed: true });
  assert.equal(createCalls, 1);
  assert.equal(linkCalls, 2);
  assert.equal(store.rows[0]?.status, 'completed');
  assert.equal(store.rows[0]?.artifactId, 'message-1');
});

test('completed operations return the original result without rerunning linkage', async () => {
  const store = new ArtifactOperationStore();
  const service = new ArtifactIdempotencyService(store as unknown as Db);
  let linkCalls = 0;
  let loadCalls = 0;
  const plan = createPlan(store, {
    link: async (artifact) => {
      linkCalls += 1;
      return { id: artifact.id };
    },
    load: async (artifact) => {
      loadCalls += 1;
      return { id: artifact.id };
    },
  });

  await service.execute(plan);
  const replay = await service.execute(plan);

  assert.deepEqual(replay, { value: { id: 'message-1' }, replayed: true });
  assert.equal(linkCalls, 1);
  assert.equal(loadCalls, 1);
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
