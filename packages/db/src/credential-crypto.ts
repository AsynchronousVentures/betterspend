import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const CIPHER = 'aes-256-gcm';
const VERSION = 'v1';

function getCredentialKey(): Buffer {
  const configured = process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
  if (configured) {
    const trimmed = configured.trim();
    if (/^[a-f0-9]{64}$/i.test(trimmed)) return Buffer.from(trimmed, 'hex');

    const decoded = Buffer.from(trimmed, 'base64');
    if (decoded.length === 32) return decoded;

    return createHash('sha256').update(trimmed).digest();
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('AI_CREDENTIAL_ENCRYPTION_KEY is required in production');
  }

  return createHash('sha256')
    .update(process.env.BETTER_AUTH_SECRET || 'betterspend-dev-ai-credential-key')
    .digest();
}

export function encryptCredential(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(CIPHER, getCredentialKey(), iv);
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

  const decipher = createDecipheriv(CIPHER, getCredentialKey(), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
