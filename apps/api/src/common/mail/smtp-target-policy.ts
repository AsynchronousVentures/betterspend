import * as dns from 'node:dns/promises';
import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';
import ipaddr from 'ipaddr.js';

const IPV6_GLOBAL_UNICAST = ipaddr.parseCIDR('2000::/3');
const ALLOWED_SMTP_PORTS = new Set([25, 465, 587, 2525]);

export class SmtpTargetPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SmtpTargetPolicyError';
  }
}

export interface SmtpDnsAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export type SmtpDnsLookup = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<SmtpDnsAddress[]>;

export interface SafeSmtpTarget {
  readonly hostname: string;
  readonly address: string;
  readonly family: 4 | 6;
  readonly port: number;
}

const defaultLookup: SmtpDnsLookup = async (hostname, options) => {
  const addresses = await dns.lookup(hostname, options);
  const validAddresses: SmtpDnsAddress[] = [];
  for (const { address, family } of addresses) {
    if (family === 4 || family === 6) validAddresses.push({ address, family });
  }
  return validAddresses;
};

export async function resolveSafeSmtpTarget(
  rawHost: string,
  port: number,
  lookup: SmtpDnsLookup = defaultLookup,
): Promise<SafeSmtpTarget> {
  if (!ALLOWED_SMTP_PORTS.has(port)) {
    throw new SmtpTargetPolicyError('SMTP port is not allowed');
  }
  const hostname = normalizeHostname(rawHost);
  const family = isIP(hostname);
  if (family === 4 || family === 6) {
    if (!isGlobalIp(hostname)) {
      throw new SmtpTargetPolicyError('SMTP host must resolve only to a public address');
    }
    return { hostname, address: hostname, family, port };
  }

  let addresses: SmtpDnsAddress[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    addresses = [];
  }
  let pinned = addresses[0];
  if (!pinned) throw new SmtpTargetPolicyError('SMTP host did not resolve');
  for (const answer of addresses) {
    if (isIP(answer.address) !== answer.family || !isGlobalIp(answer.address)) {
      throw new SmtpTargetPolicyError('SMTP host must resolve only to a public address');
    }
    if (answer.family === 4) pinned = answer;
  }

  return { hostname, address: pinned.address, family: pinned.family, port };
}

function normalizeHostname(rawHost: string): string {
  let candidate = rawHost.trim();
  if (candidate.startsWith('[') || candidate.endsWith(']')) {
    if (!candidate.startsWith('[') || !candidate.endsWith(']')) {
      throw new SmtpTargetPolicyError('SMTP host is invalid');
    }
    candidate = candidate.slice(1, -1);
  }
  if (isIP(candidate)) return candidate.toLowerCase();

  const ascii = domainToASCII(candidate.toLowerCase().replace(/\.$/, ''));
  const labels = ascii.split('.');
  if (
    !ascii ||
    ascii.length > 253 ||
    labels.some(
      (label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    )
  ) {
    throw new SmtpTargetPolicyError('SMTP host is invalid');
  }
  return ascii;
}

function isGlobalIp(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.parse(address);
  if (parsed.kind() === 'ipv6' && parsed.range() === 'ipv4Mapped') return false;
  if (parsed.kind() === 'ipv6') {
    return parsed.range() === 'unicast' && parsed.match(IPV6_GLOBAL_UNICAST);
  }
  return parsed.range() === 'unicast';
}
