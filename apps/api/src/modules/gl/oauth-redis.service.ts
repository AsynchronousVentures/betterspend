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

export type XeroPendingGrant = {
  binding: OAuthStateBinding;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string;
  accessExpiresAt: string;
  scopes: string;
  tenants: readonly XeroPendingTenant[];
};

export type XeroPendingTenant = {
  tenantId: string;
  tenantName: string | null;
};

export type XeroPendingTenantClaim = 'claimed' | 'already_claimed' | 'conflict' | 'missing';

export type XeroDailyBudgetPriority = 'interactive' | 'background';

export type XeroDailyBudgetConsumeInput = {
  tenantId: string;
  date: string;
  limit: number;
  backgroundLimit: number;
  priority: XeroDailyBudgetPriority;
  ttlSeconds: number;
};

export type XeroDailyBudgetConsumeResult = {
  allowed: boolean;
  used: number;
};

export type XeroDailyBudgetReconcileInput = {
  tenantId: string;
  date: string;
  limit: number;
  providerRemaining: number;
  ttlSeconds: number;
};

export type XeroDailyBudgetStore = {
  consumeXeroDailyBudget(input: XeroDailyBudgetConsumeInput): Promise<XeroDailyBudgetConsumeResult>;
  getXeroDailyBudget(tenantId: string, date: string): Promise<number>;
  reconcileXeroDailyBudget(input: XeroDailyBudgetReconcileInput): Promise<number>;
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

  /** Stores an exchanged Xero grant until the authenticated user picks a tenant. */
  async createXeroPendingGrant(grant: XeroPendingGrant): Promise<string> {
    const grantId = randomBytes(32).toString('base64url');
    const result = await this.redis.set(
      this.pendingGrantKey(grantId),
      JSON.stringify(grant),
      'EX',
      10 * 60,
      'NX',
    );
    if (result !== 'OK') throw new ServiceUnavailableException('Could not create Xero grant');
    return grantId;
  }

  async getXeroPendingGrant(grantId: string): Promise<XeroPendingGrant | null> {
    if (!grantId) return null;
    const serialized = await this.redis.get(this.pendingGrantKey(grantId));
    if (typeof serialized !== 'string') return null;
    return parseXeroPendingGrant(serialized);
  }

  /** Consumes a pending grant atomically so a tenant can only be selected once. */
  async consumeXeroPendingGrant(grantId: string): Promise<XeroPendingGrant | null> {
    if (!grantId) return null;
    const serialized = await this.redis.eval(
      "local value = redis.call('GET', KEYS[1]); if value then redis.call('DEL', KEYS[1], KEYS[2]); end; return value",
      2,
      this.pendingGrantKey(grantId),
      this.pendingGrantSelectionKey(grantId),
    );
    if (typeof serialized !== 'string') return null;
    return parseXeroPendingGrant(serialized);
  }

  /** Claims one tenant before its credentials can be written to the connection registry. */
  async claimXeroPendingTenant(grantId: string, tenantId: string): Promise<XeroPendingTenantClaim> {
    if (!grantId || !tenantId) return 'missing';
    const result = await this.redis.eval(
      "if redis.call('EXISTS', KEYS[1]) == 0 then return -1 end; local selected = redis.call('GET', KEYS[2]); if not selected then local ttl = redis.call('TTL', KEYS[1]); if ttl < 1 then return -1 end; redis.call('SET', KEYS[2], ARGV[1], 'EX', ttl); return 1 end; if selected == ARGV[1] then return 2 end; return 0",
      2,
      this.pendingGrantKey(grantId),
      this.pendingGrantSelectionKey(grantId),
      tenantId,
    );
    const claim = Number(result);
    if (claim === -1) return 'missing';
    if (claim === 0) return 'conflict';
    if (claim === 1) return 'claimed';
    if (claim === 2) return 'already_claimed';
    throw new ServiceUnavailableException('Invalid Xero tenant claim response');
  }

  /** Completes a claimed tenant selection and clears both grant state keys atomically. */
  async completeXeroPendingGrant(grantId: string, tenantId: string): Promise<boolean> {
    if (!grantId || !tenantId) return false;
    const result = await this.redis.eval(
      "local selected = redis.call('GET', KEYS[2]); if selected and selected ~= ARGV[1] then return 0 end; redis.call('DEL', KEYS[1], KEYS[2]); return 1",
      2,
      this.pendingGrantKey(grantId),
      this.pendingGrantSelectionKey(grantId),
      tenantId,
    );
    const completed = Number(result);
    if (completed === 0) return false;
    if (completed === 1) return true;
    throw new ServiceUnavailableException('Invalid Xero grant completion response');
  }

  /** Atomically reserves one request while preserving the interactive daily reserve. */
  async consumeXeroDailyBudget(
    input: XeroDailyBudgetConsumeInput,
  ): Promise<XeroDailyBudgetConsumeResult> {
    const result = await this.redis.eval(
      "local used = tonumber(redis.call('GET', KEYS[1]) or '0') or 0; local ceiling = ARGV[3] == 'background' and tonumber(ARGV[2]) or tonumber(ARGV[1]); if used >= ceiling then return {0, used}; end; used = used + 1; redis.call('SET', KEYS[1], used, 'EX', ARGV[4]); return {1, used}",
      1,
      this.xeroDailyBudgetKey(input.tenantId, input.date),
      String(input.limit),
      String(input.backgroundLimit),
      input.priority,
      String(input.ttlSeconds),
    );
    return parseBudgetConsumeResult(result);
  }

  async getXeroDailyBudget(tenantId: string, date: string): Promise<number> {
    const value = await this.redis.get(this.xeroDailyBudgetKey(tenantId, date));
    return parseBudgetUsed(value);
  }

  /** Reconciles the local counter upward with Xero's authoritative remaining-day header. */
  async reconcileXeroDailyBudget(input: XeroDailyBudgetReconcileInput): Promise<number> {
    const providerUsed = Math.max(0, Math.min(input.limit, input.limit - input.providerRemaining));
    const result = await this.redis.eval(
      "local used = tonumber(redis.call('GET', KEYS[1]) or '0') or 0; local provider_used = tonumber(ARGV[1]); if provider_used > used then used = provider_used; redis.call('SET', KEYS[1], used, 'EX', ARGV[2]); end; return used",
      1,
      this.xeroDailyBudgetKey(input.tenantId, input.date),
      String(providerUsed),
      String(input.ttlSeconds),
    );
    return parseBudgetUsed(result);
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

  private pendingGrantKey(grantId: string): string {
    return `oauth:xero-grant:${grantId}`;
  }

  private pendingGrantSelectionKey(grantId: string): string {
    return `oauth:xero-grant-selection:${grantId}`;
  }

  private xeroDailyBudgetKey(tenantId: string, date: string): string {
    return `oauth:xero-budget:${encodeURIComponent(tenantId)}:${date}`;
  }
}

function parseBudgetConsumeResult(value: unknown): XeroDailyBudgetConsumeResult {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new ServiceUnavailableException('Invalid Xero daily budget response');
  }
  const allowed = Number(value[0]);
  const used = Number(value[1]);
  if (
    ![allowed, used].every(Number.isSafeInteger) ||
    (allowed !== 0 && allowed !== 1) ||
    used < 0
  ) {
    throw new ServiceUnavailableException('Invalid Xero daily budget response');
  }
  return { allowed: allowed === 1, used };
}

function parseBudgetUsed(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const used = Number(value);
  if (!Number.isSafeInteger(used) || used < 0) {
    throw new ServiceUnavailableException('Invalid Xero daily budget response');
  }
  return used;
}

function parseXeroPendingGrant(serialized: string): XeroPendingGrant | null {
  try {
    const parsed = JSON.parse(serialized) as Partial<XeroPendingGrant>;
    if (!parsed.binding || !isOAuthStateBinding(parsed.binding)) return null;
    if (
      typeof parsed.accessTokenEncrypted !== 'string' ||
      parsed.accessTokenEncrypted.length === 0 ||
      typeof parsed.refreshTokenEncrypted !== 'string' ||
      parsed.refreshTokenEncrypted.length === 0 ||
      typeof parsed.accessExpiresAt !== 'string' ||
      !Number.isFinite(Date.parse(parsed.accessExpiresAt)) ||
      typeof parsed.scopes !== 'string' ||
      parsed.scopes.length === 0 ||
      !Array.isArray(parsed.tenants)
    ) {
      return null;
    }
    const tenants = parsed.tenants.filter(isXeroPendingTenant);
    if (tenants.length !== parsed.tenants.length || tenants.length === 0) return null;
    return { ...parsed, binding: parsed.binding, tenants } as XeroPendingGrant;
  } catch {
    return null;
  }
}

function isOAuthStateBinding(value: unknown): value is OAuthStateBinding {
  if (!value || typeof value !== 'object') return false;
  const binding = value as Partial<OAuthStateBinding>;
  return (
    (binding.provider === 'qbo' || binding.provider === 'xero') &&
    typeof binding.organizationId === 'string' &&
    typeof binding.userId === 'string' &&
    typeof binding.sessionId === 'string'
  );
}

function isXeroPendingTenant(value: unknown): value is XeroPendingTenant {
  if (!value || typeof value !== 'object') return false;
  const tenant = value as Partial<XeroPendingTenant>;
  return (
    typeof tenant.tenantId === 'string' &&
    (tenant.tenantName === null || typeof tenant.tenantName === 'string')
  );
}
