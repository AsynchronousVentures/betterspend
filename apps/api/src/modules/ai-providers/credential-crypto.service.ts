import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const CIPHER = 'aes-256-gcm';
const VERSION = 'v1';

@Injectable()
export class CredentialCryptoService {
  encrypt(value: string): string {
    const key = this.getKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv(CIPHER, key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      VERSION,
      iv.toString('base64url'),
      tag.toString('base64url'),
      encrypted.toString('base64url'),
    ].join(':');
  }

  decrypt(payload: string): string {
    const [version, ivText, tagText, encryptedText] = payload.split(':');
    if (version !== VERSION || !ivText || !tagText || encryptedText === undefined) {
      throw new InternalServerErrorException('Unsupported encrypted credential format');
    }

    const decipher = createDecipheriv(CIPHER, this.getKey(), Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedText, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  private getKey(): Buffer {
    const configured = process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
    if (configured) return this.normalizeKey(configured);

    if (process.env.NODE_ENV === 'production') {
      throw new InternalServerErrorException('AI_CREDENTIAL_ENCRYPTION_KEY is required in production');
    }

    return createHash('sha256')
      .update(process.env.BETTER_AUTH_SECRET || 'betterspend-dev-ai-credential-key')
      .digest();
  }

  private normalizeKey(value: string): Buffer {
    const trimmed = value.trim();
    if (/^[a-f0-9]{64}$/i.test(trimmed)) return Buffer.from(trimmed, 'hex');

    try {
      const decoded = Buffer.from(trimmed, 'base64');
      if (decoded.length === 32) return decoded;
    } catch {
      // Fall through to passphrase hashing.
    }

    return createHash('sha256').update(trimmed).digest();
  }
}
