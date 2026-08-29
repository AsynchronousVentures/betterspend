import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { WorkflowDraftLeaseRedis } from './workflow-draft-lease.service';
import {
  createWorkflowDraftLeaseRedis,
  WORKFLOW_DRAFT_LEASE_LUA,
  WORKFLOW_DRAFT_LEASE_REDIS_TIMEOUT_MS,
  WorkflowDraftLeaseService,
} from './workflow-draft-lease.service';

const organizationId = '00000000-0000-4000-8000-000000000001';
const otherOrganizationId = '00000000-0000-4000-8000-000000000002';
const definitionId = '00000000-0000-4000-8000-000000000003';
const firstUserId = '00000000-0000-4000-8000-000000000004';
const secondUserId = '00000000-0000-4000-8000-000000000005';
const firstEditorInstanceId = '00000000-0000-4000-8000-000000000006';
const secondEditorInstanceId = '00000000-0000-4000-8000-000000000007';

type StoredValue = { value: string; expiresAt: number };

class FakeRedis implements WorkflowDraftLeaseRedis {
  readonly values = new Map<string, StoredValue>();
  readonly sequences = new Map<string, number>();
  failAfterMutationFor: keyof typeof WORKFLOW_DRAFT_LEASE_LUA | null = null;
  deleteLeaseBeforeFailure = false;

  async get(key: string): Promise<string | null> {
    const stored = this.values.get(key);
    if (!stored || stored.expiresAt <= Date.now()) {
      this.values.delete(key);
      return null;
    }
    return stored.value;
  }

  async set(key: string, value: string, ...args: Array<string | number>): Promise<string | null> {
    const existing = await this.get(key);
    if (args.includes('NX') && existing !== null) return null;
    const ttlIndex = args.findIndex((arg) => arg === 'PX');
    const ttl = ttlIndex >= 0 ? Number(args[ttlIndex + 1]) : 0;
    this.values.set(key, { value, expiresAt: Date.now() + ttl });
    return 'OK';
  }

  async eval(
    script: string,
    _numberOfKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown> {
    const key = String(args[0]);
    const current = this.current(key);

    if (script === WORKFLOW_DRAFT_LEASE_LUA.acquire) {
      const counterKey = String(args[1]);
      if (current) return [0, current.value];
      const recoveryKey = String(args[2]);
      const prefix = String(args[3]);
      const document = String(args[4]);
      const ttl = Number(args[5]);
      const minimumFence = Number(args[6]);
      const fence = Math.max(this.sequences.get(counterKey) ?? 0, minimumFence) + 1;
      this.sequences.set(counterKey, fence);
      const value = `${prefix}${fence}|${document}`;
      this.values.set(recoveryKey, { value: '0\n', expiresAt: Date.now() + ttl });
      this.values.set(key, { value, expiresAt: Date.now() + ttl });
      if (this.failAfterMutationFor === 'acquire') {
        this.failAfterMutationFor = null;
        if (this.deleteLeaseBeforeFailure) this.values.delete(key);
        throw new Error('Redis command timed out after execution');
      }
      return [1, value];
    }

    if (script === WORKFLOW_DRAFT_LEASE_LUA.takeover) {
      const counterKey = String(args[1]);
      const previous = current?.value ?? '';
      const previousTtl = current ? current.expiresAt - Date.now() : -1;
      const recoveryKey = String(args[2]);
      const prefix = String(args[3]);
      const document = String(args[4]);
      const ttl = Number(args[5]);
      const minimumFence = Number(args[6]);
      const previousFence = previous ? Number(previous.split('|', 5)[3]) : 0;
      const fence = Math.max(this.sequences.get(counterKey) ?? 0, minimumFence, previousFence) + 1;
      this.sequences.set(counterKey, fence);
      const value = `${prefix}${fence}|${document}`;
      const previousExpiresAt = previousTtl > 0 ? Date.now() + previousTtl : 0;
      this.values.set(recoveryKey, {
        value: `${previousExpiresAt}\n${previous}`,
        expiresAt: Date.now() + ttl,
      });
      this.values.set(key, { value, expiresAt: Date.now() + ttl });
      if (this.failAfterMutationFor === 'takeover') {
        this.failAfterMutationFor = null;
        throw new Error('Redis command timed out after execution');
      }
      return [previous, previousTtl, value];
    }

    if (script === WORKFLOW_DRAFT_LEASE_LUA.reconcileAttempt) {
      const recoveryKey = String(args[1]);
      const prefix = String(args[2]);
      const recovery = this.current(recoveryKey);
      if (!recovery) return 0;
      if (!current) {
        this.values.delete(recoveryKey);
        return 0;
      }
      if (!current.value.startsWith(prefix)) {
        this.values.delete(recoveryKey);
        return 0;
      }
      const separator = recovery.value.indexOf('\n');
      if (separator < 0) return 0;
      const previousExpiresAt = Number(recovery.value.slice(0, separator));
      const previous = recovery.value.slice(separator + 1);
      const remainingTtl = previousExpiresAt - Date.now();
      if (!previous || remainingTtl <= 0) {
        this.values.delete(key);
      } else {
        this.values.set(key, { value: previous, expiresAt: Date.now() + remainingTtl });
      }
      this.values.delete(recoveryKey);
      return 1;
    }

    if (script === WORKFLOW_DRAFT_LEASE_LUA.acknowledgeAttempt) {
      return this.values.delete(key) ? 1 : 0;
    }

    if (script === WORKFLOW_DRAFT_LEASE_LUA.restore) {
      const expected = String(args[1]);
      if (current?.value !== expected) return 0;
      const previous = String(args[2]);
      const ttl = Number(args[3]);
      if (!previous || ttl <= 0) {
        this.values.delete(key);
      } else {
        this.values.set(key, { value: previous, expiresAt: Date.now() + ttl });
      }
      return 1;
    }

    if (script === WORKFLOW_DRAFT_LEASE_LUA.renew) {
      const raw = String(args[1]);
      const ttl = Number(args[2]);
      const prefix = String(args[3]);
      if (!current || !current.value.startsWith(prefix)) return 0;
      this.values.set(key, { value: raw, expiresAt: Date.now() + ttl });
      return 1;
    }

    if (script === WORKFLOW_DRAFT_LEASE_LUA.release) {
      const prefix = String(args[1]);
      if (!current || !current.value.startsWith(prefix)) return 0;
      this.values.delete(key);
      return 1;
    }

    if (script === WORKFLOW_DRAFT_LEASE_LUA.deleteIfUnchanged) {
      const expected = String(args[1]);
      if (current?.value === expected) {
        this.values.delete(key);
        return 1;
      }
      return 0;
    }
    throw new Error('FakeRedis received an unknown workflow lease script');
  }

  private current(key: string): StoredValue | null {
    const stored = this.values.get(key);
    if (!stored || stored.expiresAt <= Date.now()) {
      this.values.delete(key);
      return null;
    }
    return stored;
  }

  disconnect(): void {}

  recoveryKeys(): string[] {
    return [...this.values.keys()].filter((key) =>
      key.startsWith('workflow:draft-lease-recovery:'),
    );
  }
}

describe('WorkflowDraftLeaseService', () => {
  it('bounds Redis operations that can run while a workflow row is locked', () => {
    const redis = createWorkflowDraftLeaseRedis() as WorkflowDraftLeaseRedis & {
      options: {
        connectTimeout: number;
        commandTimeout: number;
        maxRetriesPerRequest: number;
      };
    };
    assert.equal(redis.options.connectTimeout, WORKFLOW_DRAFT_LEASE_REDIS_TIMEOUT_MS);
    assert.equal(redis.options.commandTimeout, WORKFLOW_DRAFT_LEASE_REDIS_TIMEOUT_MS);
    assert.equal(redis.options.maxRetriesPerRequest, 1);
    redis.disconnect();
  });

  it('rejects unknown Lua scripts instead of guessing their behavior', async () => {
    const redis = new FakeRedis();
    await assert.rejects(redis.eval('unknown script', 1, 'key'), /unknown workflow lease script/);
  });

  it('atomically owns a lease, hides another holder token, and scopes keys by organization', async () => {
    const redis = new FakeRedis();
    const service = new WorkflowDraftLeaseService(redis);

    const first = await service.acquire(
      definitionId,
      organizationId,
      firstUserId,
      firstEditorInstanceId,
      'First editor',
    );
    assert.equal(first.state, 'owned');
    if (first.state !== 'owned') return;
    assert.deepEqual(redis.recoveryKeys(), []);
    assert.equal(first.lease.fence, 1);

    const refreshed = await service.acquire(
      definitionId,
      organizationId,
      firstUserId,
      firstEditorInstanceId,
      'First editor',
    );
    assert.equal(refreshed.state, 'owned');
    if (refreshed.state !== 'owned') return;
    assert.equal(refreshed.lease.fence, first.lease.fence);
    assert.equal(refreshed.leaseToken, first.leaseToken);

    const sameUserOtherTab = await service.status(
      definitionId,
      organizationId,
      firstUserId,
      secondEditorInstanceId,
    );
    assert.equal(sameUserOtherTab.state, 'held');
    assert.equal('leaseToken' in sameUserOtherTab, false);
    if (sameUserOtherTab.state === 'held') {
      assert.equal('editorInstanceId' in sameUserOtherTab.lease, false);
    }
    const sameUserOtherTabAcquire = await service.acquire(
      definitionId,
      organizationId,
      firstUserId,
      secondEditorInstanceId,
      'First editor',
    );
    assert.equal(sameUserOtherTabAcquire.state, 'held');
    assert.equal('leaseToken' in sameUserOtherTabAcquire, false);

    const second = await service.status(
      definitionId,
      organizationId,
      secondUserId,
      secondEditorInstanceId,
    );
    assert.equal(second.state, 'held');
    if (second.state !== 'held') return;
    assert.equal('leaseToken' in second, false);

    const otherOrganization = await service.acquire(
      definitionId,
      otherOrganizationId,
      secondUserId,
      secondEditorInstanceId,
      'Second editor',
    );
    assert.equal(otherOrganization.state, 'owned');
  });

  it('renews and releases only with the matching user and token', async () => {
    const redis = new FakeRedis();
    const service = new WorkflowDraftLeaseService(redis);
    const acquired = await service.acquire(
      definitionId,
      organizationId,
      firstUserId,
      firstEditorInstanceId,
      'First editor',
    );
    assert.equal(acquired.state, 'owned');
    if (acquired.state !== 'owned') return;

    const wrongUserRelease = await service.release(
      definitionId,
      organizationId,
      secondUserId,
      secondEditorInstanceId,
      acquired.leaseToken,
    );
    assert.equal(wrongUserRelease.state, 'held');

    const wrongInstanceRenew = await service.renew(
      definitionId,
      organizationId,
      firstUserId,
      secondEditorInstanceId,
      acquired.leaseToken,
    );
    assert.equal(wrongInstanceRenew.state, 'held');

    const wrongInstanceRelease = await service.release(
      definitionId,
      organizationId,
      firstUserId,
      secondEditorInstanceId,
      acquired.leaseToken,
    );
    assert.equal(wrongInstanceRelease.state, 'held');

    const renewed = await service.renew(
      definitionId,
      organizationId,
      firstUserId,
      firstEditorInstanceId,
      acquired.leaseToken,
    );
    assert.equal(renewed.state, 'owned');
    if (renewed.state !== 'owned') return;
    assert.equal(renewed.lease.fence, acquired.lease.fence);
    assert.ok(
      new Date(renewed.lease.expiresAt).getTime() >= new Date(acquired.lease.expiresAt).getTime(),
    );

    const released = await service.release(
      definitionId,
      organizationId,
      firstUserId,
      firstEditorInstanceId,
      renewed.leaseToken,
    );
    assert.deepEqual(released, { state: 'available' });
  });

  it('treats an expired Redis lease as available and takeover invalidates the old token', async () => {
    const redis = new FakeRedis();
    const service = new WorkflowDraftLeaseService(redis);
    const acquired = await service.acquire(
      definitionId,
      organizationId,
      firstUserId,
      firstEditorInstanceId,
      'First editor',
    );
    assert.equal(acquired.state, 'owned');
    if (acquired.state !== 'owned') return;

    const key = `workflow:draft-lease:${organizationId}:${definitionId}`;
    redis.values.get(key)!.expiresAt = Date.now() - 1;
    assert.deepEqual(
      await service.status(definitionId, organizationId, firstUserId, firstEditorInstanceId),
      {
        state: 'available',
      },
    );

    const reacquired = await service.acquire(
      definitionId,
      organizationId,
      firstUserId,
      firstEditorInstanceId,
      'First editor',
    );
    assert.equal(reacquired.state, 'owned');
    if (reacquired.state !== 'owned') return;

    const takenOver = await service.takeover(
      definitionId,
      organizationId,
      secondUserId,
      secondEditorInstanceId,
      'Second editor',
    );
    assert.equal(takenOver.state, 'owned');
    if (takenOver.state !== 'owned') return;
    assert.notEqual(takenOver.leaseToken, reacquired.leaseToken);

    const oldTokenRenewal = await service.renew(
      definitionId,
      organizationId,
      firstUserId,
      firstEditorInstanceId,
      reacquired.leaseToken,
    );
    assert.equal(oldTokenRenewal.state, 'held');
  });

  it('atomically reports each takeover predecessor and can restore its predecessor', async () => {
    const redis = new FakeRedis();
    const service = new WorkflowDraftLeaseService(redis);
    const first = await service.acquire(
      definitionId,
      organizationId,
      firstUserId,
      firstEditorInstanceId,
      'First editor',
    );
    assert.equal(first.state, 'owned');
    if (first.state !== 'owned') return;

    const [second, third] = await Promise.all([
      service.takeoverWithResult(
        definitionId,
        organizationId,
        secondUserId,
        secondEditorInstanceId,
        'Second editor',
      ),
      service.takeoverWithResult(
        definitionId,
        organizationId,
        '00000000-0000-4000-8000-000000000006',
        '00000000-0000-4000-8000-000000000008',
        'Third editor',
      ),
    ]);

    assert.equal(second.previous?.holderUserId, firstUserId);
    assert.equal(third.previous?.holderUserId, secondUserId);
    assert.deepEqual(redis.recoveryKeys(), []);
    assert.ok(second.status.lease.fence > first.lease.fence);
    assert.ok(third.status.lease.fence > second.status.lease.fence);

    assert.equal(await second.restore(), false);
    assert.equal(await third.restore(), true);
    assert.equal(await second.restore(), true);
    const restored = await service.status(
      definitionId,
      organizationId,
      firstUserId,
      firstEditorInstanceId,
    );
    assert.equal(restored.state, 'owned');
    if (restored.state !== 'owned') return;
    assert.equal(restored.lease.fence, first.lease.fence);
  });

  it('removes an acquired lease when Redis times out after executing the mutation', async () => {
    const redis = new FakeRedis();
    const service = new WorkflowDraftLeaseService(redis);
    redis.failAfterMutationFor = 'acquire';
    redis.deleteLeaseBeforeFailure = true;

    await assert.rejects(
      service.acquireWithResult(
        definitionId,
        organizationId,
        firstUserId,
        firstEditorInstanceId,
        'First editor',
      ),
      /storage is unavailable/,
    );

    assert.deepEqual(
      await service.status(definitionId, organizationId, firstUserId, firstEditorInstanceId),
      { state: 'available' },
    );
    assert.deepEqual(redis.recoveryKeys(), []);
  });

  it('restores the displaced holder when Redis times out after executing takeover', async () => {
    const redis = new FakeRedis();
    const service = new WorkflowDraftLeaseService(redis);
    const first = await service.acquire(
      definitionId,
      organizationId,
      firstUserId,
      firstEditorInstanceId,
      'First editor',
    );
    assert.equal(first.state, 'owned');
    redis.failAfterMutationFor = 'takeover';

    await assert.rejects(
      service.takeoverWithResult(
        definitionId,
        organizationId,
        secondUserId,
        secondEditorInstanceId,
        'Second editor',
      ),
      /storage is unavailable/,
    );

    const restored = await service.status(
      definitionId,
      organizationId,
      firstUserId,
      firstEditorInstanceId,
    );
    assert.equal(restored.state, 'owned');
    if (restored.state !== 'owned' || first.state !== 'owned') return;
    assert.equal(restored.leaseToken, first.leaseToken);
    assert.equal(restored.lease.fence, first.lease.fence);
    assert.deepEqual(redis.recoveryKeys(), []);
  });
});
