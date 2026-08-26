import * as dns from 'node:dns/promises';
import {
  request as httpRequest,
  type ClientRequest,
  type IncomingMessage,
  type RequestOptions,
} from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import ipaddr from 'ipaddr.js';

const DEFAULT_TIMEOUT_MS = 10_000;
export const MAX_RESPONSE_BYTES = 1_048_576;
const IPV6_GLOBAL_UNICAST = ipaddr.parseCIDR('2000::/3');

export class WebhookUrlPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookUrlPolicyError';
  }
}

export interface WebhookDnsAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export interface SafeWebhookTarget {
  readonly protocol: 'http:' | 'https:';
  readonly hostname: string;
  readonly hostHeader: string;
  readonly address: string;
  readonly family: 4 | 6;
  readonly port: number;
  readonly path: string;
}

export interface WebhookRequestResponse {
  readonly status: number;
  readonly body: string;
  readonly ok: boolean;
}

type Lookup = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<WebhookDnsAddress[]>;

const defaultLookup: Lookup = async (hostname, options) => {
  const addresses = await dns.lookup(hostname, options);
  const validAddresses: WebhookDnsAddress[] = [];
  for (const { address, family } of addresses) {
    if (family === 4 || family === 6) validAddresses.push({ address, family });
  }
  return validAddresses;
};

/**
 * Resolve and validate a webhook destination before storing or delivering it.
 * Every returned target carries the address used for the request, so delivery
 * cannot resolve a hostname again after the private-address check.
 */
export async function resolveSafeWebhookTarget(
  rawUrl: string,
  lookup: Lookup = defaultLookup,
): Promise<SafeWebhookTarget> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new WebhookUrlPolicyError('Webhook URL is invalid');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new WebhookUrlPolicyError('Webhook URL must use HTTP or HTTPS');
  }
  if (parsed.username || parsed.password) {
    throw new WebhookUrlPolicyError('Webhook URL cannot contain credentials');
  }
  if (parsed.hash) {
    throw new WebhookUrlPolicyError('Webhook URL cannot contain a fragment');
  }

  const defaultPort = parsed.protocol === 'https:' ? 443 : 80;
  if (parsed.port !== '' && Number(parsed.port) !== defaultPort) {
    throw new WebhookUrlPolicyError(`Webhook URL must use port ${defaultPort}`);
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname) throw new WebhookUrlPolicyError('Webhook URL must include a hostname');

  const addressFamily = isIP(hostname);
  const addresses = addressFamily
    ? [{ address: hostname, family: addressFamily as 4 | 6 }]
    : await lookup(hostname, { all: true, verbatim: true }).catch(() => []);

  if (
    addresses.length === 0 ||
    addresses.some(({ address, family }) => (family !== 4 && family !== 6) || !isGlobalIp(address))
  ) {
    throw new WebhookUrlPolicyError('Webhook URL must resolve only to a public address');
  }

  const pinned = addresses.find(({ family }) => family === 4) ?? addresses[0];
  if (!pinned) throw new WebhookUrlPolicyError('Webhook URL did not resolve');

  return {
    protocol: parsed.protocol,
    hostname,
    hostHeader: parsed.host,
    address: pinned.address,
    family: pinned.family,
    port: parsed.port === '' ? defaultPort : Number(parsed.port),
    path: `${parsed.pathname}${parsed.search}`,
  };
}

/**
 * Send a webhook over a pinned socket. Redirects are deliberately not
 * followed, because each redirect would be a new destination requiring the
 * same validation and DNS pinning.
 */
export function requestPinnedWebhook(
  target: SafeWebhookTarget,
  options: {
    method: string;
    headers: Record<string, string>;
    body: string;
    timeoutMs?: number;
  },
): Promise<WebhookRequestResponse> {
  const requestFn = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pinnedLookup: LookupFunction = (_hostname, lookupOptions, callback) => {
    if (lookupOptions.all) {
      callback(null, [{ address: target.address, family: target.family }]);
      return;
    }
    callback(null, target.address, target.family);
  };
  const requestOptions: RequestOptions = {
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port,
    path: target.path,
    method: options.method,
    headers: { ...options.headers, Host: target.hostHeader },
    agent: false,
    lookup: pinnedLookup,
  };
  if (target.protocol === 'https:' && isIP(target.hostname) === 0) {
    (requestOptions as RequestOptions & { servername?: string }).servername = target.hostname;
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const deadlineTimer: { id?: ReturnType<typeof setTimeout> } = {};
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (deadlineTimer.id) clearTimeout(deadlineTimer.id);
      callback();
    };

    const req: ClientRequest = (requestFn as typeof httpRequest)(
      requestOptions,
      (response: IncomingMessage) => {
        const chunks: Buffer[] = [];
        let responseBytes = 0;
        response.on('data', (chunk: Buffer | string) => {
          responseBytes += Buffer.byteLength(chunk);
          if (responseBytes > MAX_RESPONSE_BYTES) {
            const error = new Error(`Webhook response exceeded ${MAX_RESPONSE_BYTES} bytes`);
            finish(() => reject(error));
            response.destroy(error);
            return;
          }
          chunks.push(Buffer.from(chunk));
        });
        response.on('end', () => {
          const status = response.statusCode ?? 0;
          finish(() =>
            resolve({
              status,
              body: Buffer.concat(chunks).toString('utf8'),
              ok: status >= 200 && status < 300,
            }),
          );
        });
        response.on('error', (error) => finish(() => reject(error)));
      },
    );

    deadlineTimer.id = setTimeout(() => {
      const error = new Error('Webhook delivery timed out');
      finish(() => reject(error));
      req.destroy(error);
    }, timeoutMs);
    req.setTimeout(timeoutMs, () => {
      const error = new Error('Webhook delivery timed out');
      finish(() => reject(error));
      req.destroy(error);
    });
    req.on('error', (error) => finish(() => reject(error)));
    req.end(options.body);
  });
}

function isGlobalIp(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.parse(address);
  const normalized =
    parsed.kind() === 'ipv6' && parsed.range() === 'ipv4Mapped'
      ? (parsed as ipaddr.IPv6).toIPv4Address()
      : parsed;
  if (normalized.kind() === 'ipv6') {
    return normalized.range() === 'unicast' && normalized.match(IPV6_GLOBAL_UNICAST);
  }
  return normalized.range() === 'unicast';
}
