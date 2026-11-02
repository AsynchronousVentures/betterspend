import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const SCHEME = 'scrypt';
const KEY_LENGTH = 64;
const PARAMS = { N: 16384, r: 8, p: 1 };
const MAX_MEM = 64 * 1024 * 1024;

export const VENDOR_PORTAL_PASSWORD_MIN_LENGTH = 8;

/** Hash a vendor portal password as `scrypt$N$r$p$salt$key` (base64url). */
export async function hashVendorPortalPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH, { ...PARAMS, maxmem: MAX_MEM });
  return [
    SCHEME,
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

export async function verifyVendorPortalPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const [scheme, n, r, p, salt, key] = storedHash.split('$');
  if (scheme !== SCHEME || !n || !r || !p || !salt || !key) return false;

  const expected = Buffer.from(key, 'base64url');
  const actual = await scrypt(password, Buffer.from(salt, 'base64url'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: MAX_MEM,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
