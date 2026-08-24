import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { OAuthService, type QboToken } from './oauth.service';

const QBO_MINOR_VERSION = 75;
const MAX_ATTEMPTS = 5;
const MAX_BATCH_OPERATIONS = 10;
const MAX_CONCURRENT_REQUESTS = 10;
const REQUESTS_PER_MINUTE = 500;
const BACKOFF_BASE_MS = 250;

export type QboRequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type QboRequestOptions = {
  organizationId: string;
  method: QboRequestMethod;
  path: string;
  data?: unknown;
  query?: Readonly<Record<string, string | number | boolean>>;
  requestId?: string;
};

export type QboResponse<T> = {
  data: T;
  connectionId: string;
  realmId: string;
};

export type QboBatchOperation = Readonly<Record<string, unknown> & { bId: string }>;

export type QboFaultDetail = {
  code: string;
  message: string;
  detail?: string;
  element?: string;
};

export class QboConnectionRequiredError extends Error {
  constructor() {
    super('QBO is not connected or requires reconnection');
    this.name = 'QboConnectionRequiredError';
  }
}

export class QboFaultError extends Error {
  constructor(
    readonly faultType: string,
    readonly errors: readonly QboFaultDetail[],
    readonly status: number | undefined,
  ) {
    super(errors.map((error) => error.detail || error.message).join('; ') || faultType);
    this.name = 'QboFaultError';
  }

  get primaryCode(): string | undefined {
    return this.errors[0]?.code;
  }
}

export class ValidationFault extends QboFaultError {
  constructor(errors: readonly QboFaultDetail[], status: number | undefined) {
    super('ValidationFault', errors, status);
    this.name = 'ValidationFault';
  }
}

export class AuthenticationFault extends QboFaultError {
  constructor(errors: readonly QboFaultDetail[], status: number | undefined) {
    super('AuthenticationFault', errors, status);
    this.name = 'AuthenticationFault';
  }
}

export class SystemFault extends QboFaultError {
  constructor(errors: readonly QboFaultDetail[], status: number | undefined) {
    super('SystemFault', errors, status);
    this.name = 'SystemFault';
  }
}

class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly capacity: number) {}

  async acquire(): Promise<() => void> {
    if (this.active >= this.capacity) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;
    return () => {
      this.active -= 1;
      this.waiters.shift()?.();
    };
  }
}

/** Enforces Intuit's per-realm minute quota and concurrent-request ceiling. */
class RealmLimiter {
  private readonly requestTimes: number[] = [];
  private readonly semaphore = new Semaphore(MAX_CONCURRENT_REQUESTS);

  async run<T>(operation: () => Promise<T>): Promise<T> {
    await this.takeQuotaSlot();
    const release = await this.semaphore.acquire();
    try {
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
      if (this.requestTimes.length < REQUESTS_PER_MINUTE) {
        this.requestTimes.push(now);
        return;
      }
      const oldestRequest = this.requestTimes[0];
      if (oldestRequest === undefined) continue;
      await sleep(oldestRequest + 60_000 - now);
    }
  }
}

/**
 * The shared QBO seam. Callers provide an organization and relative resource path;
 * provider authentication, quotas, retries, and fault translation stay internal.
 */
@Injectable()
export class QboClientService {
  private readonly realmLimiters = new Map<string, RealmLimiter>();

  constructor(private readonly oauthService: OAuthService) {}

  async request<T>(options: QboRequestOptions): Promise<QboResponse<T>> {
    const initialToken = await this.oauthService.getQboToken(options.organizationId);
    if (!initialToken) throw new QboConnectionRequiredError();
    let token: QboToken = initialToken;

    const url = this.buildUrl(token.realmId, options);
    let refreshed = false;
    let transientAttempts = 0;

    while (true) {
      try {
        const response = await this.limiterFor(token.realmId).run(() =>
          axios.request<T>({
            method: options.method,
            url,
            data: options.data,
            headers: {
              Authorization: `Bearer ${token.accessToken}`,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
          }),
        );
        const fault = this.faultError(response.data, response.status);
        if (fault) throw fault;
        return { data: response.data, connectionId: token.connectionId, realmId: token.realmId };
      } catch (error: unknown) {
        const status = responseStatus(error);
        if (status === 401) {
          if (refreshed) {
            await this.oauthService.markQboReconnectRequired(token.connectionId, token.accessToken);
            throw this.toQboError(error);
          }
          const rotated = await this.oauthService.refreshQboToken(
            options.organizationId,
            token.accessToken,
          );
          if (!rotated) throw new QboConnectionRequiredError();
          token = rotated;
          refreshed = true;
          continue;
        }

        if (status === 429 || status === 503) {
          transientAttempts += 1;
          if (transientAttempts < MAX_ATTEMPTS) {
            await sleep(this.retryDelay(transientAttempts, error));
            continue;
          }
        }
        throw this.toQboError(error);
      }
    }
  }

  async batch<T>(
    organizationId: string,
    operations: readonly QboBatchOperation[],
    requestId?: string,
  ): Promise<QboResponse<T>> {
    if (operations.length === 0 || operations.length > MAX_BATCH_OPERATIONS) {
      throw new RangeError('QBO batches must contain between 1 and 10 operations');
    }
    return this.request<T>({
      organizationId,
      method: 'POST',
      path: 'batch',
      data: { BatchItemRequest: operations },
      requestId,
    });
  }

  private buildUrl(realmId: string, options: QboRequestOptions): string {
    const path = normalizePath(options.path);
    const baseUrl = (process.env.QBO_API_URL || 'https://quickbooks.api.intuit.com').replace(
      /\/$/,
      '',
    );
    const url = new URL(`${baseUrl}/v3/company/${encodeURIComponent(realmId)}/${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, String(value));
    }
    url.searchParams.set('minorversion', String(QBO_MINOR_VERSION));
    if (isWrite(options.method)) {
      url.searchParams.set('requestid', options.requestId ?? randomUUID());
    }
    return url.toString();
  }

  private limiterFor(realmId: string): RealmLimiter {
    let limiter = this.realmLimiters.get(realmId);
    if (!limiter) {
      limiter = new RealmLimiter();
      this.realmLimiters.set(realmId, limiter);
    }
    return limiter;
  }

  private retryDelay(attempt: number, error: unknown): number {
    const exponential = BACKOFF_BASE_MS * 2 ** (attempt - 1);
    const jittered = exponential + Math.floor(Math.random() * exponential);
    const retryAfter = retryAfterMs(error);
    return retryAfter === undefined ? jittered : Math.max(jittered, retryAfter);
  }

  private toQboError(error: unknown): unknown {
    if (!axios.isAxiosError(error)) return error;
    return this.faultError(error.response?.data, error.response?.status) ?? error;
  }

  private faultError(data: unknown, status: number | undefined): QboFaultError | null {
    const fault = parseFault(data);
    if (!fault) return null;
    switch (fault.type) {
      case 'ValidationFault':
        return new ValidationFault(fault.errors, status);
      case 'AuthenticationFault':
        return new AuthenticationFault(fault.errors, status);
      case 'SystemFault':
        return new SystemFault(fault.errors, status);
      default:
        return new QboFaultError(fault.type, fault.errors, status);
    }
  }
}

function isWrite(method: QboRequestMethod): boolean {
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
    throw new TypeError('QBO request path must be a relative resource path');
  }
  return normalized;
}

function responseStatus(error: unknown): number | undefined {
  return axios.isAxiosError(error) ? error.response?.status : undefined;
}

function retryAfterMs(error: unknown): number | undefined {
  if (!axios.isAxiosError(error)) return undefined;
  const value = error.response?.headers?.['retry-after'];
  const seconds = typeof value === 'string' ? Number(value) : value;
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0
    ? seconds * 1000
    : undefined;
}

function parseFault(data: unknown): { type: string; errors: QboFaultDetail[] } | null {
  if (!isRecord(data) || !isRecord(data.Fault)) return null;
  const type = typeof data.Fault.type === 'string' ? data.Fault.type : 'UnknownFault';
  const rawErrors = Array.isArray(data.Fault.Error) ? data.Fault.Error : [];
  const errors = rawErrors.filter(isRecord).map((error) => ({
    code: typeof error.code === 'string' ? error.code : String(error.code ?? ''),
    message: typeof error.Message === 'string' ? error.Message : 'QuickBooks request failed',
    ...(typeof error.Detail === 'string' ? { detail: error.Detail } : {}),
    ...(typeof error.element === 'string' ? { element: error.element } : {}),
  }));
  return { type, errors };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
