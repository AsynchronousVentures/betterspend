import assert from 'node:assert/strict';
import test from 'node:test';
import Redis from 'ioredis';
import { getRedisConnection } from './redis-connection';
import { resolveAuthSecret } from '../auth/auth-secret';

test('production auth rejects absent and checked-in secrets without exposing values', () => {
  for (const value of [
    undefined,
    '',
    ' ',
    'short',
    'betterspend-dev-secret-change-in-prod',
    'change-me-use-openssl-rand-hex-32',
    'change-me-in-production-use-openssl-rand-hex-32',
  ]) {
    assert.throws(
      () => resolveAuthSecret({ NODE_ENV: 'production', BETTER_AUTH_SECRET: value }),
      /Production requires/,
    );
  }
  const valid = 'synthetic-config-test-key-not-for-deployment-012345';
  assert.equal(resolveAuthSecret({ NODE_ENV: 'production', BETTER_AUTH_SECRET: valid }), valid);
  assert.ok(resolveAuthSecret({ NODE_ENV: 'development' }));
});

test('Redis URLs preserve TLS, credentials and database with consistent precedence', () => {
  const options = getRedisConnection({
    REDIS_URL: 'rediss://test%40user:test%3Apassword@example.invalid:6380/2',
    REDIS_HOST: 'ignored.invalid',
  });
  assert.deepEqual(options, {
    host: 'example.invalid',
    port: 6380,
    username: 'test@user',
    password: 'test:password',
    db: 2,
    tls: {},
  });
  // Construct lazily to verify ioredis options without making any connection.
  const client = new Redis({ ...options, lazyConnect: true });
  assert.deepEqual(client.options.tls, {});
  assert.equal(client.options.db, 2);
  client.disconnect();
  assert.deepEqual(getRedisConnection({ REDIS_URL: 'redis://[::1]/0' }), {
    host: '::1',
    port: 6379,
    db: 0,
    username: undefined,
    password: undefined,
  });
  assert.deepEqual(getRedisConnection({}), { host: 'localhost', port: 6379 });
});

test('Redis configuration rejects malformed transport and database values', () => {
  for (const url of [
    '',
    'not a url',
    'https://example.invalid',
    'redis://example.invalid/-1',
    'redis://example.invalid/1.2',
    'redis://example.invalid/9007199254740992',
    'redis://example.invalid/1?tls=false',
    'redis://example.invalid#fragment',
    'redis://example.invalid:0',
    'redis://example.invalid:65536',
    'redis://%xx@example.invalid',
  ]) {
    assert.throws(() => getRedisConnection({ REDIS_URL: url }), /Redis|REDIS/);
  }
  for (const port of ['', '-1', 'abc', '65536', '1.5'])
    assert.throws(() => getRedisConnection({ REDIS_PORT: port }), /Redis port/);
});
