import { Injectable, Optional } from '@nestjs/common';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { OAuthService, type XeroToken } from './oauth.service';
import type {
  XeroDailyBudgetConsumeInput,
  XeroDailyBudgetConsumeResult,
  XeroDailyBudgetReconcileInput,
  XeroDailyBudgetStore,
} from './oauth-redis.service';

export const XERO_MAX_CONCURRENT_REQUESTS = 5;
export const XERO_REQUESTS_PER_MINUTE = 60;
export const XERO_STARTER_DAILY_LIMIT = 1_000;
export const XERO_STANDARD_DAILY_LIMIT = 5_000;
export const XERO_INTERACTIVE_RESERVE_RATIO = 0.1;
const MAX_BATCH_ELEMENTS = 50;
const MAX_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 250;
const MAX_RETRY_AFTER_MS = 60_000;

export type XeroRequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type XeroRequestPriority = 'interactive' | 'background';

export type XeroRequestOptions = {
  organizationId: string;
  method: XeroRequestMethod;
  path: string;
  data?: unknown;
  query?: Readonly<Record<string, string | number | boolean>>;
  ifModifiedSince?: Date | string;
  idempotencyKey?: string;
  /** Alias retained for callers that use the provider-neutral sync request ID. */
  requestId?: string;
  priority?: XeroRequestPriority;
};

export type XeroResponse<T> = {
  data: T;
  connectionId: string;
  tenantId: string;
  status: number;
  notModified: boolean;
};

export type XeroBatchRequestOptions = {
  organizationId: string;
  path: string;
  data: unknown;
  query?: Readonly<Record<string, string | number | boolean>>;
  idempotencyKey?: string;
  requestId?: string;
  priority?: XeroRequestPriority;
};

export type XeroDailyBudgetSnapshot = {
  date: string;
  used: number;
  limit: number;
  remaining: number;
  backgroundRemaining: number;
};

/** Small local store used by isolated unit tests; production injects the Redis store. */
export class InMemoryXeroDailyBudgetStore implements XeroDailyBudgetStore {
  private readonly entries = new Map<string, number>();

  async consumeXeroDailyBudget(
    input: XeroDailyBudgetConsumeInput,
  ): Promise<XeroDailyBudgetConsumeResult> {
    const key = `${input.tenantId}:${input.date}`;
    const used = this.entries.get(key) ?? 0;
    const ceiling = input.priority === 'background' ? input.backgroundLimit : input.limit;
    if (used >= ceiling) return { allowed: false, used };
    const next = used + 1;
    this.entries.set(key, next);
    return { allowed: true, used: next };
  }

  async getXeroDailyBudget(tenantId: string, date: string): Promise<number> {
    return this.entries.get(`${tenantId}:${date}`) ?? 0;
  }

  async reconcileXeroDailyBudget(input: XeroDailyBudgetReconcileInput): Promise<number> {
    const key = `${input.tenantId}:${input.date}`;
    const used = Math.max(
      this.entries.get(key) ?? 0,
      Math.max(0, Math.min(input.limit, input.limit - input.providerRemaining)),
    );
    this.entries.set(key, used);
    return used;
  }
}

export class XeroConnectionRequiredError extends Error {
  constructor() {
    super('Xero is not connected or requires reconnection');
    this.name = 'XeroConnectionRequiredError';
  }
}

export class XeroDailyBudgetExceededError extends Error {
  constructor(
    readonly tenantId: string,
    readonly priority: XeroRequestPriority,
    readonly snapshot: XeroDailyBudgetSnapshot,
  ) {
    super(`Xero daily request budget exhausted for tenant ${tenantId}`);
    this.name = 'XeroDailyBudgetExceededError';
  }
}

export class XeroApiError extends Error {
  constructor(
    readonly status: number | undefined,
    readonly data: unknown,
    readonly headers: Readonly<Record<string, unknown>>,
  ) {
    super(`Xero request failed${status ? ` with HTTP ${status}` : ''}`);
    this.name = 'XeroApiError';
  }
}

/** Tracks each tenant's UTC-day usage and leaves a reserve for interactive work. */
export class XeroDailyBudgetLedger {
  private readonly interactiveReserve: number;

  constructor(
    private readonly limit = configuredDailyLimit(),
    interactiveReserve = Math.ceil(limit * XERO_INTERACTIVE_RESERVE_RATIO),
    private readonly store: XeroDailyBudgetStore = new InMemoryXeroDailyBudgetStore(),
  ) {
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new TypeError('Xero daily request limit must be a positive integer');
    }
    if (!Number.isSafeInteger(interactiveReserve) || interactiveReserve < 0) {
      throw new TypeError('Xero interactive reserve must be a non-negative integer');
    }
    this.interactiveReserve = Math.min(interactiveReserve, limit);
  }

  async tryConsume(
    tenantId: string,
    priority: XeroRequestPriority,
    now = Date.now(),
  ): Promise<boolean> {
    const result = await this.store.consumeXeroDailyBudget(
      this.consumeInput(tenantId, priority, now),
    );
    return result.allowed;
  }

  async consumeOrThrow(
    tenantId: string,
    priority: XeroRequestPriority,
    now = Date.now(),
  ): Promise<XeroDailyBudgetSnapshot> {
    const date = utcDate(now);
    const result = await this.store.consumeXeroDailyBudget(
      this.consumeInput(tenantId, priority, now),
    );
    const snapshot = this.snapshotFromUsed(date, result.used);
    if (!result.allowed) {
      throw new XeroDailyBudgetExceededError(tenantId, priority, snapshot);
    }
    return snapshot;
  }

  async snapshot(tenantId: string, now = Date.now()): Promise<XeroDailyBudgetSnapshot> {
    const date = utcDate(now);
    const used = await this.store.getXeroDailyBudget(tenantId, date);
    return this.snapshotFromUsed(date, used);
  }

  /** Reconciles local usage with Xero's authoritative remaining-day header. */
  async recordProviderRemaining(
    tenantId: string,
    remaining: number,
    now = Date.now(),
  ): Promise<void> {
    if (!Number.isSafeInteger(remaining) || remaining < 0) return;
    await this.store.reconcileXeroDailyBudget({
      tenantId,
      date: utcDate(now),
      limit: this.limit,
      providerRemaining: remaining,
      ttlSeconds: dailyBudgetTtlSeconds(now),
    });
  }

  private consumeInput(
    tenantId: string,
    priority: XeroRequestPriority,
    now: number,
  ): XeroDailyBudgetConsumeInput {
    return {
      tenantId,
      date: utcDate(now),
      limit: this.limit,
      backgroundLimit: this.limit - this.interactiveReserve,
      priority,
      ttlSeconds: dailyBudgetTtlSeconds(now),
    };
  }

  private snapshotFromUsed(date: string, used: number): XeroDailyBudgetSnapshot {
    return {
      date,
      used,
      limit: this.limit,
      remaining: Math.max(0, this.limit - used),
      backgroundRemaining: Math.max(0, this.limit - this.interactiveReserve - used),
    };
  }
}

class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly capacity: number) {}

  async acquire(): Promise<() => void> {
    if (this.active >= this.capacity) {
      return new Promise<() => void>((resolve) =>
        this.waiters.push(() => resolve(this.releasePermit())),
      );
    }
    this.active += 1;
    return this.releasePermit();
  }

  private releasePermit(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) next();
      else this.active -= 1;
    };
  }
}

class TenantLimiter {
  private readonly requestTimes: number[] = [];
  private readonly semaphore = new Semaphore(XERO_MAX_CONCURRENT_REQUESTS);

  constructor(private readonly budget: XeroDailyBudgetLedger) {}

  async run<T>(
    tenantId: string,
    priority: XeroRequestPriority,
    operation: () => Promise<T>,
  ): Promise<T> {
    const release = await this.semaphore.acquire();
    try {
      await this.takeQuotaSlot();
      await this.budget.consumeOrThrow(tenantId, priority);
      return await operation();
    } finally {
      release();
    }
  }

  private async takeQuotaSlot(): Promise<void> {
    while (true) {
      const now = Date.now();
      while (this.requestTimes[0] !== undefined && this.requestTimes[0] <= now - 60_000) {
        this.requestTimes.shift();
      }
      if (this.requestTimes.length < XERO_REQUESTS_PER_MINUTE) {
        this.requestTimes.push(now);
        return;
      }
      const oldestRequest = this.requestTimes[0];
      if (oldestRequest === undefined) continue;
      await sleep(oldestRequest + 60_000 - now);
    }
  }
}

/** Provider client that owns Xero authentication, request headers, retries, and tenant quotas. */
@Injectable()
export class XeroClientService {
  private readonly tenantLimiters = new Map<string, TenantLimiter>();
  private readonly budget: XeroDailyBudgetLedger;

  constructor(
    private readonly oauthService: OAuthService,
    @Optional() budget?: XeroDailyBudgetLedger,
  ) {
    this.budget = budget ?? new XeroDailyBudgetLedger();
  }

  async request<T>(options: XeroRequestOptions): Promise<XeroResponse<T>> {
    const initialToken = await this.oauthService.getXeroToken(options.organizationId);
    if (!initialToken) throw new XeroConnectionRequiredError();
    let token: XeroToken = initialToken;
    const idempotencyKey = isWrite(options.method)
      ? (options.idempotencyKey ?? options.requestId ?? randomUUID())
      : undefined;
    let refreshed = false;
    let transientAttempts = 0;

    while (true) {
      try {
        const url = this.buildUrl(options);
        const headers = this.headers(token, options, idempotencyKey);
        const response = await this.limiterFor(token.tenantId).run(
          token.tenantId,
          options.priority ?? 'background',
          () =>
            axios.request<T>({
              method: options.method,
              url,
              data: options.data,
              headers,
              validateStatus: (status) => (status >= 200 && status < 300) || status === 304,
            }),
        );
        await this.budget.recordProviderRemaining(
          token.tenantId,
          headerNumber(response.headers, 'x-daylimit-remaining') ?? Number.NaN,
        );
        return {
          data: response.data,
          connectionId: token.connectionId,
          tenantId: token.tenantId,
          status: response.status,
          notModified: response.status === 304,
        };
      } catch (error: unknown) {
        const status = responseStatus(error);
        if (status === 401) {
          if (refreshed) {
            await this.oauthService.markXeroReconnectRequired(
              token.connectionId,
              token.accessToken,
            );
            throw this.toXeroError(error);
          }
          const rotated = await this.oauthService.refreshXeroToken(
            options.organizationId,
            token.accessToken,
          );
          if (!rotated) throw new XeroConnectionRequiredError();
          token = rotated;
          refreshed = true;
          continue;
        }

        if (status === 429 || status === 503) {
          if (status === 429 && dayLimitRemaining(error) === 0) {
            await this.budget.recordProviderRemaining(token.tenantId, 0);
            throw this.toXeroError(error);
          }
          transientAttempts += 1;
          if (transientAttempts < MAX_ATTEMPTS) {
            await sleep(this.retryDelay(transientAttempts, error));
            continue;
          }
        }
        throw this.toXeroError(error);
      }
    }
  }

  get<T>(
    organizationId: string,
    path: string,
    options: Omit<XeroRequestOptions, 'organizationId' | 'method' | 'path'> = {},
  ): Promise<XeroResponse<T>> {
    return this.request({ ...options, organizationId, method: 'GET', path });
  }

  /** Fetches a resource changed since the supplied UTC instant. A 304 is returned as notModified. */
  getSince<T>(
    organizationId: string,
    path: string,
    ifModifiedSince: Date | string,
    options: Omit<
      XeroRequestOptions,
      'organizationId' | 'method' | 'path' | 'ifModifiedSince'
    > = {},
  ): Promise<XeroResponse<T>> {
    return this.get(organizationId, path, { ...options, ifModifiedSince });
  }

  batch<T>(options: XeroBatchRequestOptions): Promise<XeroResponse<T>>;
  batch<T>(
    organizationId: string,
    path: string,
    data: unknown,
    options?: Omit<XeroBatchRequestOptions, 'organizationId' | 'path' | 'data'> | string,
  ): Promise<XeroResponse<T>>;
  async batch<T>(
    first: XeroBatchRequestOptions | string,
    path?: string,
    data?: unknown,
    options: Omit<XeroBatchRequestOptions, 'organizationId' | 'path' | 'data'> | string = {},
  ): Promise<XeroResponse<T>> {
    const batchOptions = typeof options === 'string' ? { idempotencyKey: options } : options;
    const request =
      typeof first === 'string'
        ? { organizationId: first, path: path ?? '', data, ...batchOptions }
        : first;
    const elements = batchElementCount(request.data);
    if (elements === 0 || elements > MAX_BATCH_ELEMENTS) {
      throw new RangeError('Xero batches must contain between 1 and 50 elements');
    }
    return this.request<T>({
      ...request,
      method: 'POST',
      query: { ...request.query, summarizeErrors: false },
    });
  }

  private limiterFor(tenantId: string): TenantLimiter {
    let limiter = this.tenantLimiters.get(tenantId);
    if (!limiter) {
      limiter = new TenantLimiter(this.budget);
      this.tenantLimiters.set(tenantId, limiter);
    }
    return limiter;
  }

  private buildUrl(options: XeroRequestOptions): string {
    const path = normalizePath(options.path);
    const baseUrl = (process.env.XERO_API_URL || 'https://api.xero.com/api.xro/2.0').replace(
      /\/$/,
      '',
    );
    const url = new URL(`${baseUrl}/${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  private headers(
    token: XeroToken,
    options: XeroRequestOptions,
    idempotencyKey?: string,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token.accessToken}`,
      'xero-tenant-id': token.tenantId,
      Accept: 'application/json',
    };
    if (options.data !== undefined) headers['Content-Type'] = 'application/json';
    if (options.ifModifiedSince !== undefined) {
      headers['If-Modified-Since'] = formatIfModifiedSince(options.ifModifiedSince);
    }
    if (isWrite(options.method)) {
      const key = idempotencyKey ?? randomUUID();
      if (key.length === 0 || key.length > 128) {
        throw new RangeError('Xero Idempotency-Key must contain between 1 and 128 characters');
      }
      headers['Idempotency-Key'] = key;
    }
    return headers;
  }

  private retryDelay(attempt: number, error: unknown): number {
    const exponential = BACKOFF_BASE_MS * 2 ** (attempt - 1);
    const jittered = exponential + Math.floor(Math.random() * exponential);
    const retryAfter = retryAfterMs(error);
    return retryAfter === undefined ? jittered : Math.max(jittered, retryAfter);
  }

  private toXeroError(error: unknown): unknown {
    if (!axios.isAxiosError(error)) return error;
    return new XeroApiError(
      error.response?.status,
      error.response?.data,
      (error.response?.headers ?? {}) as Readonly<Record<string, unknown>>,
    );
  }
}

function configuredDailyLimit(): number {
  const planDefault =
    process.env.XERO_PLAN?.toLowerCase() === 'standard'
      ? XERO_STANDARD_DAILY_LIMIT
      : XERO_STARTER_DAILY_LIMIT;
  const configured = Number(
    process.env.XERO_DAILY_REQUEST_LIMIT ?? process.env.XERO_DAILY_LIMIT ?? planDefault,
  );
  return Number.isSafeInteger(configured) && configured > 0 ? configured : planDefault;
}

function batchElementCount(data: unknown): number {
  if (Array.isArray(data)) return data.length;
  if (!isRecord(data)) return 0;
  const arrays = Object.values(data).filter(Array.isArray);
  if (arrays.length !== 1) return 0;
  return arrays[0]?.length ?? 0;
}

function isWrite(method: XeroRequestMethod): boolean {
  return method !== 'GET';
}

function normalizePath(path: string): string {
  const normalized = path.replace(/^\/+/, '');
  if (
    normalized.length === 0 ||
    normalized.includes('://') ||
    normalized.includes('?') ||
    normalized.includes('#') ||
    normalized.split('/').includes('..')
  ) {
    throw new TypeError('Xero request path must be a relative resource path');
  }
  return normalized;
}

function formatIfModifiedSince(value: Date | string): string {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime()))
      throw new TypeError('If-Modified-Since must be a valid date');
    return value.toUTCString();
  }
  if (!value.trim()) throw new TypeError('If-Modified-Since must not be empty');
  return value;
}

function responseStatus(error: unknown): number | undefined {
  return axios.isAxiosError(error) ? error.response?.status : undefined;
}

function retryAfterMs(error: unknown): number | undefined {
  if (!axios.isAxiosError(error)) return undefined;
  const value = headerValue(error.response?.headers, 'retry-after');
  return parseRetryAfterMs(value);
}

function parseRetryAfterMs(value: unknown): number | undefined {
  if (Array.isArray(value)) return parseRetryAfterMs(value[0]);
  if (typeof value === 'string') {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
    }
    const date = Date.parse(value);
    if (Number.isFinite(date)) {
      return Math.min(Math.max(0, date - Date.now()), MAX_RETRY_AFTER_MS);
    }
  }
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.min(value * 1000, MAX_RETRY_AFTER_MS);
  }
  return undefined;
}

function dayLimitRemaining(error: unknown): number | undefined {
  if (!axios.isAxiosError(error)) return undefined;
  return headerNumber(error.response?.headers, 'x-daylimit-remaining');
}

function headerNumber(headers: unknown, name: string): number | undefined {
  const value = headerValue(headers, name);
  const numberValue = typeof value === 'string' ? Number(value) : value;
  return typeof numberValue === 'number' && Number.isFinite(numberValue) ? numberValue : undefined;
}

function headerValue(headers: unknown, name: string): unknown {
  if (!headers || typeof headers !== 'object') return undefined;
  const entry = Object.entries(headers as Record<string, unknown>).find(
    ([key]) => key.toLowerCase() === name,
  );
  return entry?.[1];
}

function utcDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function dailyBudgetTtlSeconds(timestamp: number): number {
  const today = utcDate(timestamp);
  const nextUtcDay = Date.parse(`${today}T00:00:00.000Z`) + 86_400_000;
  return Math.max(60, Math.ceil((nextUtcDay - timestamp) / 1_000) + 86_400);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
