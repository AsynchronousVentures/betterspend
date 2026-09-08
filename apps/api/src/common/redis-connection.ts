import type { RedisOptions } from 'ioredis';

/** Queue, lease and OAuth clients must share transport and logical database. */
export function getRedisConnection(env: NodeJS.ProcessEnv = process.env): RedisOptions {
  if (env.REDIS_URL !== undefined) {
    let url: URL;
    try {
      url = new URL(env.REDIS_URL);
    } catch {
      throw new Error('REDIS_URL must be a valid redis:// or rediss:// URL');
    }
    if (
      !['redis:', 'rediss:'].includes(url.protocol) ||
      !url.hostname ||
      url.search ||
      url.hash ||
      !/^\/(\d+)?$|^$/.test(url.pathname)
    ) {
      throw new Error('REDIS_URL must specify redis/rediss, a host and an optional database index');
    }
    const db = Number(url.pathname.slice(1) || '0');
    if (!Number.isSafeInteger(db) || db < 0)
      throw new Error('REDIS_URL database must be a nonnegative integer');
    let username: string | undefined;
    let password: string | undefined;
    try {
      username = url.username ? decodeURIComponent(url.username) : undefined;
      password = url.password ? decodeURIComponent(url.password) : undefined;
    } catch {
      throw new Error('REDIS_URL credentials contain invalid encoding');
    }
    return {
      host: url.hostname.replace(/^\[|\]$/g, ''),
      port: redisPort(url.port || '6379'),
      username,
      password,
      db,
      ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    };
  }
  return { host: env.REDIS_HOST || 'localhost', port: redisPort(env.REDIS_PORT ?? '6379') };
}

function redisPort(value: string): number {
  const port = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Redis port must be an integer from 1 through 65535');
  }
  return port;
}
