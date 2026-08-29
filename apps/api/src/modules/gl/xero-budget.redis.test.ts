import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import Redis from 'ioredis';
import {
  OAuthRedisService,
  type XeroDailyBudgetConsumeInput,
  type XeroDailyBudgetReconcileInput,
} from './oauth-redis.service';

const redisUrl = process.env.REDIS_TEST_URL ?? process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

describe('Xero daily budget Redis integration', () => {
  it('enforces the reserve atomically across independent stores and reconciles provider usage', async (t) => {
    const probe = new Redis(redisUrl, {
      lazyConnect: true,
      connectTimeout: 750,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    probe.on('error', () => undefined);

    try {
      await probe.connect();
      await probe.ping();
    } catch (error) {
      probe.disconnect();
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

    const previousRedisUrl = process.env.REDIS_URL;
    process.env.REDIS_URL = redisUrl;
    const tenantId = `budget-${randomUUID()}`;
    const reconciledTenantId = `reconciled-${randomUUID()}`;
    const date = '2099-01-01';
    const stores = [new OAuthRedisService(), new OAuthRedisService()];
    const input: XeroDailyBudgetConsumeInput = {
      tenantId,
      date,
      limit: 10,
      backgroundLimit: 8,
      priority: 'background',
      ttlSeconds: 60,
    };

    try {
      const results = await Promise.all(
        Array.from({ length: 40 }, (_, index) =>
          stores[index % stores.length]!.consumeXeroDailyBudget(input),
        ),
      );
      assert.equal(results.filter((result) => result.allowed).length, 8);
      assert.equal(results.filter((result) => !result.allowed).length, 32);

      const interactiveResults = await Promise.all(
        Array.from({ length: 4 }, (_, index) =>
          stores[index % stores.length]!.consumeXeroDailyBudget({
            ...input,
            priority: 'interactive',
          }),
        ),
      );
      assert.equal(interactiveResults.filter((result) => result.allowed).length, 2);
      assert.equal(await stores[0]!.getXeroDailyBudget(tenantId, date), 10);

      const reconciliation: XeroDailyBudgetReconcileInput = {
        tenantId: reconciledTenantId,
        date,
        limit: 10,
        providerRemaining: 4,
        ttlSeconds: 60,
      };
      assert.equal(await stores[0]!.reconcileXeroDailyBudget(reconciliation), 6);
      assert.equal(await stores[1]!.getXeroDailyBudget(reconciledTenantId, date), 6);
      assert.equal(
        await stores[1]!.reconcileXeroDailyBudget({ ...reconciliation, providerRemaining: 8 }),
        6,
        'provider increases must not lower a locally observed usage count',
      );
    } finally {
      for (const store of stores) store.onModuleDestroy();
      process.env.REDIS_URL = previousRedisUrl;
      const keys = await probe.keys(`oauth:xero-budget:${encodeURIComponent(tenantId)}:*`);
      const reconciledKeys = await probe.keys(
        `oauth:xero-budget:${encodeURIComponent(reconciledTenantId)}:*`,
      );
      await probe.del(...keys, ...reconciledKeys);
      probe.disconnect();
    }
  });
});
