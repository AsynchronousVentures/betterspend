import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const CIPHER = 'aes-256-gcm';
const VERSION = 'v1';

function normalizeCredentialKey(configured: string): Buffer {
  const trimmed = configured.trim();
  if (/^[a-f0-9]{64}$/i.test(trimmed)) return Buffer.from(trimmed, 'hex');

  const decoded = Buffer.from(trimmed, 'base64');
  if (decoded.length === 32) return decoded;

  // Existing v1 ciphertext used SHA-256-normalized passphrases. Keep that format readable.
  return createHash('sha256').update(trimmed).digest();
}

function getCredentialKeys(): Buffer[] {
  const configured = [
    process.env.CREDENTIAL_ENCRYPTION_KEY?.trim(),
    process.env.AI_CREDENTIAL_ENCRYPTION_KEY?.trim(),
  ].filter((value): value is string => Boolean(value));
  if (configured.length === 0) throw new Error('CREDENTIAL_ENCRYPTION_KEY is required');

  const uniqueKeys = new Map<string, Buffer>();
  for (const value of configured) {
    const key = normalizeCredentialKey(value);
    uniqueKeys.set(key.toString('hex'), key);
  }
  return [...uniqueKeys.values()];
}

export function encryptCredential(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(CIPHER, getCredentialKeys()[0]!, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':');
}

export function decryptCredential(payload: string): string {
  const [version, ivText, tagText, encryptedText] = payload.split(':');
  if (version !== VERSION || !ivText || !tagText || encryptedText === undefined) {
    throw new Error('Unsupported encrypted credential format');
  }

  let lastError: unknown;
  for (const key of getCredentialKeys()) {
    try {
      const decipher = createDecipheriv(CIPHER, key, Buffer.from(ivText, 'base64url'));
      decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(encryptedText, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch (error: unknown) {
      lastError = error;
    }
  }
  throw lastError;
}
