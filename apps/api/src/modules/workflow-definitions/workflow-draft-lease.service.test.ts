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
    const stored = this.values.get(key);
    const current = await this.get(key);

    if (script.includes('local prefix = ARGV[3]')) {
      const raw = String(args[1]);
      const ttl = Number(args[2]);
      const prefix = String(args[3]);
      if (!current || !current.startsWith(prefix)) return 0;
      this.values.set(key, { value: raw, expiresAt: Date.now() + ttl });
      return 1;
    }

    if (script.includes("local current = redis.call('GET'")) {
      const prefix = String(args[1]);
      if (!current || !current.startsWith(prefix)) return 0;
      this.values.delete(key);
      return 1;
    }

    const expected = String(args[1]);
    if (stored?.value === expected) {
      this.values.delete(key);
      return 1;
    }
    return 0;
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
    assert.ok(
      new Date(renewed.lease.expiresAt).getTime() >=
        new Date(acquired.lease.expiresAt).getTime(),
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
});
