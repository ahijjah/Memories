import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';

@Injectable()
export class ObjectStorageSseService {
  private readonly logger = new Logger(ObjectStorageSseService.name);
  private readonly key: Buffer;
  private readonly keyBase64: string;
  private readonly keyMd5Base64: string;
  private readonly algorithm = 'AES256';

  constructor(private readonly config: ConfigService) {
    const keyBase64 = this.config.getOrThrow('OBJECT_STORAGE_SSE_C_KEY');
    this.key = Buffer.from(keyBase64, 'base64');

    if (this.key.length !== 32) {
      throw new Error(
        'OBJECT_STORAGE_SSE_C_KEY must be exactly 32 bytes (256 bits) when base64-decoded. ' +
          `Got ${this.key.length} bytes. Generate with: openssl rand -base64 32`,
      );
    }

    this.keyBase64 = this.key.toString('base64');
    this.keyMd5Base64 = createHash('md5').update(this.key).digest('base64');

    this.logger.log('ObjectStorageSseService initialized with SSE-C key');
  }

  getSseParams() {
    return {
      SSECustomerAlgorithm: this.algorithm,
      // AWS SDK v3 expects raw bytes (Uint8Array/Buffer) for SSECustomerKey, not base64-encoded string.
      // It does its own base64 encoding for the signature computation. TypeScript types are overly strict
      // and claim string-only, but runtime accepts Uint8Array (Buffer is a Uint8Array).
      SSECustomerKey: this.key as any,
      SSECustomerKeyMD5: this.keyMd5Base64,
    };
  }

  getSseHeaders() {
    return {
      'x-amz-server-side-encryption-customer-algorithm': this.algorithm,
      'x-amz-server-side-encryption-customer-key': this.keyBase64,
      'x-amz-server-side-encryption-customer-key-MD5': this.keyMd5Base64,
    };
  }
}
