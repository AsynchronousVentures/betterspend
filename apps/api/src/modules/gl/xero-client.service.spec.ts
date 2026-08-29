import axios from 'axios';
import type { OAuthService, XeroToken } from './oauth.service';
import {
  XeroClientService,
  XeroConnectionRequiredError,
  XeroDailyBudgetExceededError,
  XeroDailyBudgetLedger,
  XeroApiError,
} from './xero-client.service';

const token: XeroToken = {
  accessToken: 'access-token',
  tenantId: 'tenant-1',
  connectionId: 'connection-1',
};

function oauth(overrides: Partial<OAuthService> = {}): OAuthService {
  return {
    getXeroToken: jest.fn(async () => token),
    refreshXeroToken: jest.fn(async () => ({ ...token, accessToken: 'rotated-token' })),
    markXeroReconnectRequired: jest.fn(async () => undefined),
    ...overrides,
  } as unknown as OAuthService;
}

function axiosError(status: number, data?: unknown, headers?: Record<string, string>) {
  return Object.assign(new Error(`HTTP ${status}`), {
    isAxiosError: true,
    response: { status, data, headers: headers ?? {} },
  });
}

describe('XeroDailyBudgetLedger', () => {
  it('keeps the interactive reserve unavailable to background work', async () => {
    const ledger = new XeroDailyBudgetLedger(10, 2);

    for (let index = 0; index < 8; index += 1) {
      await expect(ledger.tryConsume('tenant-1', 'background')).resolves.toBe(true);
    }
    await expect(ledger.tryConsume('tenant-1', 'background')).resolves.toBe(false);
    await expect(ledger.tryConsume('tenant-1', 'interactive')).resolves.toBe(true);
    await expect(ledger.snapshot('tenant-1')).resolves.toEqual(
      expect.objectContaining({ used: 9, remaining: 1, backgroundRemaining: 0 }),
    );
  });

  it('resets usage at the UTC day boundary', async () => {
    const ledger = new XeroDailyBudgetLedger(1, 0);
    const beforeMidnight = Date.parse('2026-08-29T23:59:59.000Z');
    const afterMidnight = Date.parse('2026-08-30T00:00:00.000Z');

    await expect(ledger.tryConsume('tenant-1', 'background', beforeMidnight)).resolves.toBe(true);
    await expect(ledger.tryConsume('tenant-1', 'background', beforeMidnight)).resolves.toBe(false);
    await expect(ledger.tryConsume('tenant-1', 'background', afterMidnight)).resolves.toBe(true);
  });

  it('enforces the reserve across concurrent consumers', async () => {
    const ledger = new XeroDailyBudgetLedger(10, 2);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => ledger.tryConsume('tenant-1', 'background')),
    );

    expect(results.filter(Boolean)).toHaveLength(8);
  });
});

describe('XeroClientService', () => {
  beforeEach(() => {
    process.env.XERO_API_URL = 'https://xero.example.test/api.xro/2.0';
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete process.env.XERO_API_URL;
  });

  it('sends the tenant, conditional-fetch, and write idempotency headers', async () => {
    const request = jest.spyOn(axios, 'request').mockResolvedValue({
      status: 200,
      data: { Invoices: [] },
    });
    const client = new XeroClientService(oauth());

    await client.request({
      organizationId: 'organization-1',
      method: 'POST',
      path: '/Invoices',
      data: { Invoices: [] },
      idempotencyKey: 'stable-key',
      ifModifiedSince: new Date('2026-08-29T12:00:00.000Z'),
    });

    const config = request.mock.calls[0]?.[0];
    expect(config?.url).toBe('https://xero.example.test/api.xro/2.0/Invoices');
    expect(config?.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer access-token',
        'xero-tenant-id': 'tenant-1',
        'If-Modified-Since': 'Sat, 29 Aug 2026 12:00:00 GMT',
        'Idempotency-Key': 'stable-key',
        'Content-Type': 'application/json',
      }),
    );
  });

  it('returns a 304 as a typed not-modified response', async () => {
    jest.spyOn(axios, 'request').mockResolvedValue({ status: 304, data: undefined });
    const client = new XeroClientService(oauth());

    await expect(
      client.getSince<{ Invoices: unknown[] }>(
        'organization-1',
        'Invoices',
        'Sat, 29 Aug 2026 12:00:00 GMT',
      ),
    ).resolves.toEqual(
      expect.objectContaining({ status: 304, notModified: true, tenantId: 'tenant-1' }),
    );
  });

  it('caps batches at 50 elements and forces SummarizeErrors=false', async () => {
    const request = jest.spyOn(axios, 'request').mockResolvedValue({
      status: 200,
      data: { Invoices: Array.from({ length: 50 }, () => ({ InvoiceID: 'id' })) },
    });
    const client = new XeroClientService(oauth());
    const invoices = Array.from({ length: 50 }, (_, index) => ({ InvoiceNumber: String(index) }));

    await client.batch(
      'organization-1',
      'Invoices',
      { Invoices: invoices },
      { requestId: 'batch-key' },
    );
    const config = request.mock.calls[0]?.[0];
    expect(new URL(String(config?.url)).searchParams.get('summarizeErrors')).toBe('false');
    expect(config?.headers).toEqual(
      expect.objectContaining({ 'Idempotency-Key': expect.any(String) }),
    );

    await expect(
      client.batch('organization-1', 'Invoices', {
        Invoices: [...invoices, { InvoiceNumber: '51' }],
      }),
    ).rejects.toThrow('between 1 and 50');
  });

  it('never exceeds five concurrent requests for one tenant', async () => {
    let active = 0;
    let maximum = 0;
    jest.spyOn(axios, 'request').mockImplementation(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => setImmediate(resolve));
      active -= 1;
      return { status: 200, data: { ok: true } };
    });
    const client = new XeroClientService(oauth());

    await Promise.all(
      Array.from({ length: 15 }, () =>
        client.get('organization-1', 'Organisation', { priority: 'interactive' }),
      ),
    );

    expect(maximum).toBe(5);
  });

  it('refreshes once after a 401 and retries with the rotated token', async () => {
    const auth = oauth();
    const request = jest
      .spyOn(axios, 'request')
      .mockRejectedValueOnce(axiosError(401))
      .mockResolvedValueOnce({ status: 200, data: { ok: true } });
    const client = new XeroClientService(auth);

    await client.get('organization-1', 'Organisation');

    expect(auth.refreshXeroToken).toHaveBeenCalledWith('organization-1', 'access-token');
    expect(request.mock.calls[1]?.[0].headers).toEqual(
      expect.objectContaining({ Authorization: 'Bearer rotated-token' }),
    );
  });

  it('reuses one idempotency key across transient retries', async () => {
    jest.useFakeTimers();
    const request = jest
      .spyOn(axios, 'request')
      .mockRejectedValueOnce(axiosError(503))
      .mockResolvedValueOnce({ status: 200, data: { ok: true } });
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const client = new XeroClientService(oauth());

    const result = client.request({
      organizationId: 'organization-1',
      method: 'POST',
      path: 'Invoices',
      data: { Invoices: [] },
      requestId: 'stable-request-id',
    });
    await jest.advanceTimersByTimeAsync(250);
    await expect(result).resolves.toEqual(expect.objectContaining({ data: { ok: true } }));

    expect(request.mock.calls[0]?.[0]?.headers?.['Idempotency-Key']).toBe('stable-request-id');
    expect(request.mock.calls[1]?.[0]?.headers?.['Idempotency-Key']).toBe('stable-request-id');
  });

  it('honors Retry-After and exposes a daily-limit 429 without retrying', async () => {
    jest.useFakeTimers();
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const request = jest
      .spyOn(axios, 'request')
      .mockRejectedValueOnce(axiosError(429, undefined, { 'retry-after': '1' }))
      .mockResolvedValueOnce({ status: 200, data: { ok: true } });
    const client = new XeroClientService(oauth());
    const result = client.get('organization-1', 'Organisation');
    await jest.advanceTimersByTimeAsync(1_000);
    await expect(result).resolves.toEqual(expect.objectContaining({ data: { ok: true } }));
    expect(request).toHaveBeenCalledTimes(2);

    request.mockReset();
    request.mockRejectedValue(axiosError(429, undefined, { 'x-daylimit-remaining': '0' }));
    await expect(client.get('organization-1', 'Organisation')).rejects.toBeInstanceOf(XeroApiError);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('fails before HTTP when no active tenant connection exists', async () => {
    const request = jest.spyOn(axios, 'request');
    const client = new XeroClientService(
      oauth({ getXeroToken: jest.fn(async () => null) } as Partial<OAuthService>),
    );

    await expect(client.get('organization-1', 'Organisation')).rejects.toBeInstanceOf(
      XeroConnectionRequiredError,
    );
    expect(request).not.toHaveBeenCalled();
  });

  it('raises a typed budget error after background work consumes its allowance', async () => {
    const ledger = new XeroDailyBudgetLedger(2, 1);
    const request = jest.spyOn(axios, 'request').mockResolvedValue({ status: 200, data: {} });
    const client = new XeroClientService(oauth(), ledger);

    await client.get('organization-1', 'Organisation');
    await expect(client.get('organization-1', 'Organisation')).rejects.toBeInstanceOf(
      XeroDailyBudgetExceededError,
    );
    await client.get('organization-1', 'Organisation', { priority: 'interactive' });
    expect(request).toHaveBeenCalledTimes(2);
  });
});
