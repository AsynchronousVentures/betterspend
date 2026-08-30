import axios from 'axios';
import type { OAuthService, QboToken } from './oauth.service';
import {
  QboClientService,
  QboConnectionRequiredError,
  QboResourceNotFoundError,
  ValidationFault,
} from './qbo-client.service';

const token: QboToken = {
  accessToken: 'access-token',
  realmId: 'realm-1',
  connectionId: 'connection-1',
};

function oauth(overrides: Partial<OAuthService> = {}): OAuthService {
  return {
    getQboToken: jest.fn(async () => token),
    refreshQboToken: jest.fn(async () => ({ ...token, accessToken: 'rotated-token' })),
    markQboReconnectRequired: jest.fn(async () => undefined),
    ...overrides,
  } as unknown as OAuthService;
}

function axiosError(status: number, data?: unknown, headers?: Record<string, string>) {
  return Object.assign(new Error(`HTTP ${status}`), {
    isAxiosError: true,
    response: { status, data, headers: headers ?? {} },
  });
}

describe('QboClientService', () => {
  beforeEach(() => {
    process.env.QBO_API_URL = 'https://qbo.example.test';
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete process.env.QBO_API_URL;
  });

  it('pins the minor version, sends JSON, and injects a request ID on writes', async () => {
    const request = jest.spyOn(axios, 'request').mockResolvedValue({
      data: { Bill: { Id: 'bill-1' } },
    });
    const client = new QboClientService(oauth());

    const response = await client.request<{ Bill: { Id: string } }>({
      organizationId: 'organization-1',
      method: 'POST',
      path: '/bill',
      data: { DocNumber: 'INV-1' },
      requestId: 'stable-request-id',
    });

    const config = request.mock.calls[0]?.[0];
    const url = new URL(String(config?.url));
    expect(url.pathname).toBe('/v3/company/realm-1/bill');
    expect(url.searchParams.get('minorversion')).toBe('75');
    expect(url.searchParams.get('requestid')).toBe('stable-request-id');
    expect(config?.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer access-token',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
    );
    expect(response).toEqual({
      data: { Bill: { Id: 'bill-1' } },
      connectionId: 'connection-1',
      realmId: 'realm-1',
    });
  });

  it('caps batch requests at ten sub-operations', async () => {
    const request = jest.spyOn(axios, 'request').mockResolvedValue({ data: { ok: true } });
    const client = new QboClientService(oauth());
    const operations = Array.from({ length: 10 }, (_, index) => ({
      bId: String(index + 1),
      operation: 'query',
      Query: 'select * from Account',
    }));

    await client.batch('organization-1', operations, 'batch-request-id');
    await expect(client.batch('organization-1', [...operations, { bId: '11' }])).rejects.toThrow(
      'between 1 and 10',
    );

    expect(request.mock.calls[0]?.[0].data).toEqual({ BatchItemRequest: operations });
    const url = new URL(String(request.mock.calls[0]?.[0].url));
    expect(url.pathname).toBe('/v3/company/realm-1/batch');
    expect(url.searchParams.get('requestid')).toBe('batch-request-id');
  });

  it('backs off through a 429 burst and stops after at most five attempts', async () => {
    jest.useFakeTimers();
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const request = jest
      .spyOn(axios, 'request')
      .mockRejectedValueOnce(axiosError(429))
      .mockRejectedValueOnce(axiosError(429))
      .mockRejectedValueOnce(axiosError(503))
      .mockRejectedValueOnce(axiosError(429))
      .mockResolvedValueOnce({ data: { ok: true } });
    const client = new QboClientService(oauth());

    const result = client.request<{ ok: boolean }>({
      organizationId: 'organization-1',
      method: 'GET',
      path: 'companyinfo/realm-1',
    });
    await jest.runAllTimersAsync();

    await expect(result).resolves.toEqual(expect.objectContaining({ data: { ok: true } }));
    expect(request).toHaveBeenCalledTimes(5);
  });

  it('allows no more than ten concurrent requests for one realm', async () => {
    let active = 0;
    let maximum = 0;
    jest.spyOn(axios, 'request').mockImplementation(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => setImmediate(resolve));
      active -= 1;
      return { data: { ok: true } };
    });
    const client = new QboClientService(oauth());

    await Promise.all(
      Array.from({ length: 25 }, () =>
        client.request({
          organizationId: 'organization-1',
          method: 'GET',
          path: 'companyinfo/realm-1',
        }),
      ),
    );

    expect(maximum).toBe(10);
  });

  it('allows no more than 500 requests in a rolling minute for one realm', async () => {
    jest.useFakeTimers({ now: 0 });
    const request = jest.spyOn(axios, 'request').mockResolvedValue({ data: { ok: true } });
    const client = new QboClientService(oauth());

    const results = Array.from({ length: 501 }, () =>
      client.request({
        organizationId: 'organization-1',
        method: 'GET',
        path: 'companyinfo/realm-1',
      }),
    );
    await jest.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(500);

    await jest.advanceTimersByTimeAsync(59_999);
    expect(request).toHaveBeenCalledTimes(500);

    await jest.advanceTimersByTimeAsync(1);
    await Promise.all(results);
    expect(request).toHaveBeenCalledTimes(501);
  });

  it('refreshes once after a 401 and retries with the rotated token', async () => {
    const auth = oauth({
      refreshQboToken: jest.fn(async () => ({
        ...token,
        accessToken: 'rotated-token',
        realmId: 'realm-2',
      })),
    } as Partial<OAuthService>);
    const request = jest
      .spyOn(axios, 'request')
      .mockRejectedValueOnce(axiosError(401))
      .mockResolvedValueOnce({ data: { ok: true } });
    const client = new QboClientService(auth);

    await client.request({
      organizationId: 'organization-1',
      method: 'POST',
      path: 'bill',
      data: { DocNumber: 'INV-1' },
    });

    expect(auth.refreshQboToken).toHaveBeenCalledWith('organization-1', 'access-token');
    expect(request.mock.calls[0]?.[0].headers).toEqual(
      expect.objectContaining({ Authorization: 'Bearer access-token' }),
    );
    expect(request.mock.calls[1]?.[0].headers).toEqual(
      expect.objectContaining({ Authorization: 'Bearer rotated-token' }),
    );
    const firstUrl = new URL(String(request.mock.calls[0]?.[0].url));
    const secondUrl = new URL(String(request.mock.calls[1]?.[0].url));
    expect(firstUrl.pathname).toBe('/v3/company/realm-1/bill');
    expect(secondUrl.pathname).toBe('/v3/company/realm-2/bill');
    expect(secondUrl.searchParams.get('requestid')).toBe(firstUrl.searchParams.get('requestid'));
  });

  it('marks the connection for reconnection after the retried request also returns 401', async () => {
    const auth = oauth();
    jest
      .spyOn(axios, 'request')
      .mockRejectedValueOnce(axiosError(401))
      .mockRejectedValueOnce(axiosError(401));
    const client = new QboClientService(auth);

    await expect(
      client.request({
        organizationId: 'organization-1',
        method: 'GET',
        path: 'companyinfo/realm-1',
      }),
    ).rejects.toThrow('HTTP 401');

    expect(auth.refreshQboToken).toHaveBeenCalledTimes(1);
    expect(auth.markQboReconnectRequired).toHaveBeenCalledWith('connection-1', 'rotated-token');
  });

  it('parses Intuit validation faults into typed errors with stable codes', async () => {
    jest.spyOn(axios, 'request').mockRejectedValue(
      axiosError(400, {
        Fault: {
          type: 'ValidationFault',
          Error: [
            {
              code: '6240',
              Message: 'Duplicate Name Exists Error',
              Detail: 'The name supplied already exists.',
            },
          ],
        },
      }),
    );
    const client = new QboClientService(oauth());

    const result = client.request({
      organizationId: 'organization-1',
      method: 'POST',
      path: 'vendor',
      data: { DisplayName: 'Duplicate' },
    });

    await expect(result).rejects.toBeInstanceOf(ValidationFault);
    await expect(result).rejects.toMatchObject({
      faultType: 'ValidationFault',
      primaryCode: '6240',
      status: 400,
    });
  });

  it('rejects a Fault envelope even when Intuit returns HTTP 200', async () => {
    jest.spyOn(axios, 'request').mockResolvedValue({
      status: 200,
      data: {
        Fault: {
          type: 'ValidationFault',
          Error: [{ code: '610', Message: 'Object Not Found' }],
        },
      },
    });
    const client = new QboClientService(oauth());

    await expect(
      client.request({ organizationId: 'organization-1', method: 'GET', path: 'vendor/404' }),
    ).rejects.toMatchObject({ name: 'ValidationFault', primaryCode: '610', status: 200 });
  });

  it('translates an HTTP 404 into a typed resource-not-found error', async () => {
    jest.spyOn(axios, 'request').mockRejectedValue(axiosError(404));
    const client = new QboClientService(oauth());

    await expect(
      client.request({ organizationId: 'organization-1', method: 'GET', path: 'vendor/404' }),
    ).rejects.toBeInstanceOf(QboResourceNotFoundError);
  });

  it('fails before making an HTTP request when no active connection exists', async () => {
    const request = jest.spyOn(axios, 'request');
    const client = new QboClientService(
      oauth({ getQboToken: jest.fn(async () => null) } as Partial<OAuthService>),
    );

    await expect(
      client.request({ organizationId: 'organization-1', method: 'GET', path: 'companyinfo/1' }),
    ).rejects.toBeInstanceOf(QboConnectionRequiredError);
    expect(request).not.toHaveBeenCalled();
  });
});
