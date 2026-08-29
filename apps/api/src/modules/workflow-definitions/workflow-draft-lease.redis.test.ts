import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import Redis from 'ioredis';
import {
  WORKFLOW_DRAFT_LEASE_TTL_MS,
  type WorkflowDraftLeaseRedis,
  WorkflowDraftLeaseService,
} from './workflow-draft-lease.service';

const redisUrl = process.env.REDIS_TEST_URL ?? process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

describe('WorkflowDraftLeaseService Redis integration', () => {
  it('runs the production Lua protocol atomically with TTL-backed takeover fencing', async (t) => {
    const redis = new Redis(redisUrl, {
      lazyConnect: true,
      connectTimeout: 750,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    redis.on('error', () => undefined);
    try {
      await redis.connect();
      await redis.ping();
    } catch (error) {
      redis.disconnect();
      if (process.env.REQUIRE_REDIS_TEST === 'true') {
        throw new Error(`Required Redis integration is unavailable at ${redisUrl}`, {
          cause: error,
        });
      }
      t.skip(
        `Redis is unavailable at ${redisUrl}; set REDIS_TEST_URL to run this integration test`,
      );
      return;
    }

    const organizationId = randomUUID();
    const definitionId = randomUUID();
    const firstUserId = randomUUID();
    const secondUserId = randomUUID();
    const thirdUserId = randomUUID();
    const firstEditorInstanceId = randomUUID();
    const secondEditorInstanceId = randomUUID();
    const thirdEditorInstanceId = randomUUID();
    const leaseKey = `workflow:draft-lease:${organizationId}:${definitionId}`;
    const fenceKey = `workflow:draft-lease-fence:${organizationId}:${definitionId}`;
    const service = new WorkflowDraftLeaseService(redis as unknown as WorkflowDraftLeaseRedis);

    try {
      const acquisitions = await Promise.all([
        service.acquire(
          definitionId,
          organizationId,
          firstUserId,
          firstEditorInstanceId,
          'First editor',
        ),
        service.acquire(
          definitionId,
          organizationId,
          secondUserId,
          secondEditorInstanceId,
          'Second editor',
        ),
      ]);
      assert.equal(
        acquisitions.filter((status) => status.state === 'owned').length,
        1,
        'SET/INCR Lua acquire must produce one owner',
      );
      assert.equal(acquisitions.filter((status) => status.state === 'held').length, 1);

      const firstOwner = acquisitions.find((status) => status.state === 'owned');
      assert.ok(firstOwner?.state === 'owned');
      const sameUserOtherTab = await service.acquire(
        definitionId,
        organizationId,
        firstOwner.lease.holderUserId,
        randomUUID(),
        'Same user, other tab',
      );
      assert.equal(sameUserOtherTab.state, 'held');
      assert.equal('leaseToken' in sameUserOtherTab, false);
      const ttl = await redis.pttl(leaseKey);
      assert.ok(ttl > 0 && ttl <= WORKFLOW_DRAFT_LEASE_TTL_MS);

      const [secondTakeover, thirdTakeover] = await Promise.all([
        service.takeover(
          definitionId,
          organizationId,
          secondUserId,
          secondEditorInstanceId,
          'Second editor',
        ),
        service.takeover(
          definitionId,
          organizationId,
          thirdUserId,
          thirdEditorInstanceId,
          'Third editor',
        ),
      ]);
      assert.equal(secondTakeover.state, 'owned');
      assert.equal(thirdTakeover.state, 'owned');
      if (secondTakeover.state !== 'owned' || thirdTakeover.state !== 'owned') return;
      assert.notEqual(secondTakeover.lease.fence, thirdTakeover.lease.fence);
      assert.ok(secondTakeover.lease.fence > firstOwner.lease.fence);
      assert.ok(thirdTakeover.lease.fence > firstOwner.lease.fence);

      const secondStatus = await service.status(
        definitionId,
        organizationId,
        secondUserId,
        secondEditorInstanceId,
      );
      const thirdStatus = await service.status(
        definitionId,
        organizationId,
        thirdUserId,
        thirdEditorInstanceId,
      );
      assert.equal(
        [secondStatus, thirdStatus].filter((status) => status.state === 'owned').length,
        1,
        'concurrent takeovers must leave one final owner',
      );

      const staleRenewal = await service.renew(
        definitionId,
        organizationId,
        firstOwner.lease.holderUserId,
        firstOwner.lease.editorInstanceId,
        firstOwner.leaseToken,
      );
      assert.equal(staleRenewal.state, 'held');
    } finally {
      await redis.del(leaseKey, fenceKey);
      redis.disconnect();
    }
  });
});
