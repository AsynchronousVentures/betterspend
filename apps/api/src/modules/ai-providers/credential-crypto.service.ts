import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { decryptCredential, encryptCredential } from '@betterspend/db';

@Injectable()
export class CredentialCryptoService {
  encrypt(value: string): string {
    try {
      return encryptCredential(value);
    } catch (error) {
      throw new InternalServerErrorException(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  decrypt(payload: string): string {
    try {
      return decryptCredential(payload);
    } catch (error) {
      throw new InternalServerErrorException(
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
