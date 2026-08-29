import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { WorkflowDraftLeaseRedis } from './workflow-draft-lease.service';
import { WorkflowDraftLeaseService } from './workflow-draft-lease.service';

const organizationId = '00000000-0000-4000-8000-000000000001';
const otherOrganizationId = '00000000-0000-4000-8000-000000000002';
const definitionId = '00000000-0000-4000-8000-000000000003';
const firstUserId = '00000000-0000-4000-8000-000000000004';
const secondUserId = '00000000-0000-4000-8000-000000000005';

type StoredValue = { value: string; expiresAt: number };

class FakeRedis implements WorkflowDraftLeaseRedis {
  readonly values = new Map<string, StoredValue>();
  readonly sequences = new Map<string, number>();

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

    if (script.includes('return {1, raw}')) {
      const counterKey = String(args[1]);
      if (current) return [0, current.value];
      const prefix = String(args[2]);
      const document = String(args[3]);
      const ttl = Number(args[4]);
      const minimumFence = Number(args[5]);
      const fence = Math.max(this.sequences.get(counterKey) ?? 0, minimumFence) + 1;
      this.sequences.set(counterKey, fence);
      const value = `${prefix}${fence}|${document}`;
      this.values.set(key, { value, expiresAt: Date.now() + ttl });
      return [1, value];
    }

    if (script.includes('return {previous, previousTtl, raw}')) {
      const counterKey = String(args[1]);
      const previous = current?.value ?? '';
      const previousTtl = current ? current.expiresAt - Date.now() : -1;
      const prefix = String(args[2]);
      const document = String(args[3]);
      const ttl = Number(args[4]);
      const minimumFence = Number(args[5]);
      const previousFence = previous ? Number(previous.split('|', 4)[2]) : 0;
      const fence = Math.max(this.sequences.get(counterKey) ?? 0, minimumFence, previousFence) + 1;
      this.sequences.set(counterKey, fence);
      const value = `${prefix}${fence}|${document}`;
      this.values.set(key, { value, expiresAt: Date.now() + ttl });
      return [previous, previousTtl, value];
    }

    if (script.includes("if ARGV[2] == ''")) {
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

    if (script.includes('local prefix = ARGV[3]')) {
      const raw = String(args[1]);
      const ttl = Number(args[2]);
      const prefix = String(args[3]);
      if (!current || !current.value.startsWith(prefix)) return 0;
      this.values.set(key, { value: raw, expiresAt: Date.now() + ttl });
      return 1;
    }

    if (script.includes("local current = redis.call('GET'")) {
      const prefix = String(args[1]);
      if (!current || !current.value.startsWith(prefix)) return 0;
      this.values.delete(key);
      return 1;
    }

    const expected = String(args[1]);
    if (current?.value === expected) {
      this.values.delete(key);
      return 1;
    }
    return 0;
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
}

describe('WorkflowDraftLeaseService', () => {
  it('atomically owns a lease, hides another holder token, and scopes keys by organization', async () => {
    const redis = new FakeRedis();
    const service = new WorkflowDraftLeaseService(redis);

    const first = await service.acquire(definitionId, organizationId, firstUserId, 'First editor');
    assert.equal(first.state, 'owned');
    if (first.state !== 'owned') return;
    assert.equal(first.lease.fence, 1);

    const refreshed = await service.acquire(
      definitionId,
      organizationId,
      firstUserId,
      'First editor',
    );
    assert.equal(refreshed.state, 'owned');
    if (refreshed.state !== 'owned') return;
    assert.equal(refreshed.lease.fence, first.lease.fence);
    assert.equal(refreshed.leaseToken, first.leaseToken);

    const second = await service.status(definitionId, organizationId, secondUserId);
    assert.equal(second.state, 'held');
    if (second.state !== 'held') return;
    assert.equal('leaseToken' in second, false);

    const otherOrganization = await service.acquire(
      definitionId,
      otherOrganizationId,
      secondUserId,
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
      'First editor',
    );
    assert.equal(acquired.state, 'owned');
    if (acquired.state !== 'owned') return;

    const wrongUserRelease = await service.release(
      definitionId,
      organizationId,
      secondUserId,
      acquired.leaseToken,
    );
    assert.equal(wrongUserRelease.state, 'held');

    const renewed = await service.renew(
      definitionId,
      organizationId,
      firstUserId,
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
      'First editor',
    );
    assert.equal(acquired.state, 'owned');
    if (acquired.state !== 'owned') return;

    const key = `workflow:draft-lease:${organizationId}:${definitionId}`;
    redis.values.get(key)!.expiresAt = Date.now() - 1;
    assert.deepEqual(await service.status(definitionId, organizationId, firstUserId), {
      state: 'available',
    });

    const reacquired = await service.acquire(
      definitionId,
      organizationId,
      firstUserId,
      'First editor',
    );
    assert.equal(reacquired.state, 'owned');
    if (reacquired.state !== 'owned') return;

    const takenOver = await service.takeover(
      definitionId,
      organizationId,
      secondUserId,
      'Second editor',
    );
    assert.equal(takenOver.state, 'owned');
    if (takenOver.state !== 'owned') return;
    assert.notEqual(takenOver.leaseToken, reacquired.leaseToken);

    const oldTokenRenewal = await service.renew(
      definitionId,
      organizationId,
      firstUserId,
      reacquired.leaseToken,
    );
    assert.equal(oldTokenRenewal.state, 'held');
  });

  it('atomically reports each takeover predecessor and can restore its predecessor', async () => {
    const redis = new FakeRedis();
    const service = new WorkflowDraftLeaseService(redis);
    const first = await service.acquire(definitionId, organizationId, firstUserId, 'First editor');
    assert.equal(first.state, 'owned');
    if (first.state !== 'owned') return;

    const [second, third] = await Promise.all([
      service.takeoverWithResult(definitionId, organizationId, secondUserId, 'Second editor'),
      service.takeoverWithResult(
        definitionId,
        organizationId,
        '00000000-0000-4000-8000-000000000006',
        'Third editor',
      ),
    ]);

    assert.equal(second.previous?.holderUserId, firstUserId);
    assert.equal(third.previous?.holderUserId, secondUserId);
    assert.ok(second.status.lease.fence > first.lease.fence);
    assert.ok(third.status.lease.fence > second.status.lease.fence);

    assert.equal(await second.restore(), false);
    assert.equal(await third.restore(), true);
    assert.equal(await second.restore(), true);
    const restored = await service.status(definitionId, organizationId, firstUserId);
    assert.equal(restored.state, 'owned');
    if (restored.state !== 'owned') return;
    assert.equal(restored.lease.fence, first.lease.fence);
  });
});
