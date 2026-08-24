import { Injectable, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import Redis from 'ioredis';

export type OAuthProvider = 'qbo' | 'xero';

export type OAuthStateBinding = {
  provider: OAuthProvider;
  organizationId: string;
  userId: string;
  sessionId: string;
};

@Injectable()
export class OAuthRedisService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor() {
    this.redis = process.env.REDIS_URL
      ? new Redis(process.env.REDIS_URL, { lazyConnect: true })
      : new Redis({
          host: process.env.REDIS_HOST || 'localhost',
          port: Number(process.env.REDIS_PORT || 6379),
          lazyConnect: true,
        });
  }

  async createState(binding: OAuthStateBinding): Promise<string> {
    const state = randomBytes(32).toString('base64url');
    const result = await this.redis.set(
      this.stateKey(state),
      JSON.stringify(binding),
      'EX',
      10 * 60,
      'NX',
    );
    if (result !== 'OK') throw new ServiceUnavailableException('Could not create OAuth state');
    return state;
  }

  async consumeState(state: string): Promise<OAuthStateBinding | null> {
    if (!state) return null;
    const serialized = await this.redis.eval(
      "local value = redis.call('GET', KEYS[1]); if value then redis.call('DEL', KEYS[1]); end; return value",
      1,
      this.stateKey(state),
    );
    if (typeof serialized !== 'string') return null;

    try {
      const parsed = JSON.parse(serialized) as Partial<OAuthStateBinding>;
      if (
        (parsed.provider !== 'qbo' && parsed.provider !== 'xero') ||
        typeof parsed.organizationId !== 'string' ||
        typeof parsed.userId !== 'string' ||
        typeof parsed.sessionId !== 'string'
      ) {
        return null;
      }
      return parsed as OAuthStateBinding;
    } catch {
      return null;
    }
  }

  /** Serializes token rotation. Waiters re-read the connection inside the callback. */
  async withLock<T>(key: string, callback: () => Promise<T>): Promise<T> {
    const lockKey = `oauth:lock:${key}`;
    const lockValue = randomBytes(16).toString('hex');
    const deadline = Date.now() + 10_000;

    while (Date.now() < deadline) {
      const acquired = await this.redis.set(lockKey, lockValue, 'PX', 15_000, 'NX');
      if (acquired === 'OK') {
        let renewalError: unknown;
        let renewal = Promise.resolve();
        const renewTimer = setInterval(() => {
          renewal = renewal
            .then(async () => {
              const renewed = await this.redis.eval(
                "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) else return 0 end",
                1,
                lockKey,
                lockValue,
                15_000,
              );
              if (renewed !== 1) {
                renewalError = new ServiceUnavailableException('OAuth refresh lock was lost');
              }
            })
            .catch((error: unknown) => {
              renewalError = error;
            });
        }, 5_000);
        renewTimer.unref();

        try {
          const result = await callback();
          await renewal;
          if (renewalError) throw renewalError;
          return result;
        } finally {
          clearInterval(renewTimer);
          await renewal;
          await this.redis.eval(
            "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
            1,
            lockKey,
            lockValue,
          );
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    throw new ServiceUnavailableException('Timed out waiting for OAuth refresh lock');
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }

  private stateKey(state: string): string {
    return `oauth:state:${state}`;
  }
}
