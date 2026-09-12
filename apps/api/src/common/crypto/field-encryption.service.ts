import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

@Injectable()
export class FieldEncryptionService {
  private readonly key: Buffer;
  private readonly algorithm = 'aes-256-gcm';
  private readonly ivLength = 12; // 12 bytes for GCM
  private readonly tagLength = 16; // 16 bytes for GCM auth tag
  private readonly version = 'v1';

  constructor(private readonly config: ConfigService) {
    const keyBase64 = this.config.getOrThrow('FIELD_ENCRYPTION_KEY');
    this.key = Buffer.from(keyBase64, 'base64');
    if (this.key.length !== 32) {
      throw new Error(
        'FIELD_ENCRYPTION_KEY must be exactly 32 bytes (256 bits) when base64-decoded. ' +
        `Got ${this.key.length} bytes. Generate with: openssl rand -base64 32`,
      );
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(this.ivLength);
    const cipher = createCipheriv(this.algorithm, this.key, iv);
    const ciphertextBuffer = cipher.update(plaintext, 'utf8');
    const finalBuffer = cipher.final();
    const authTag = cipher.getAuthTag();

    const ciphertext = Buffer.concat([ciphertextBuffer, finalBuffer]);
    const ivBase64 = iv.toString('base64');
    const ciphertextBase64 = ciphertext.toString('base64');
    const authTagBase64 = authTag.toString('base64');

    return `enc:${this.version}:${ivBase64}:${authTagBase64}:${ciphertextBase64}`;
  }

  decrypt(value: string): string {
    if (!value.startsWith('enc:')) {
      return value;
    }

    const parts = value.split(':');
    if (parts.length !== 5 || parts[1] !== this.version) {
      throw new Error(
        `Invalid encrypted value format or unsupported version. Expected 'enc:${this.version}:...', got '${value.substring(0, 50)}...'`,
      );
    }

    const [, , ivBase64, authTagBase64, ciphertextBase64] = parts;

    try {
      const iv = Buffer.from(ivBase64, 'base64');
      const authTag = Buffer.from(authTagBase64, 'base64');
      const ciphertext = Buffer.from(ciphertextBase64, 'base64');

      const decipher = createDecipheriv(this.algorithm, this.key, iv);
      decipher.setAuthTag(authTag);

      const plaintextBuffer = decipher.update(ciphertext);
      const finalBuffer = decipher.final();
      const plaintext = Buffer.concat([plaintextBuffer, finalBuffer]).toString('utf8');

      return plaintext;
    } catch (err) {
      throw new Error(
        `Decryption failed (tampered or corrupted data): ${(err as Error).message}`,
      );
    }
  }
}
