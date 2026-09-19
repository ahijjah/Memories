import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ObjectStorageSseService } from './object-storage-sse.service';

describe('ObjectStorageSseService', () => {
  let service: ObjectStorageSseService;
  // 32 random bytes in base64
  const testKeyBase64 = Buffer.from('a'.repeat(32)).toString('base64');

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ObjectStorageSseService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) => {
              if (key === 'OBJECT_STORAGE_SSE_C_KEY') return testKeyBase64;
              throw new Error(`Unknown config key: ${key}`);
            },
          },
        },
      ],
    }).compile();

    service = moduleRef.get(ObjectStorageSseService);
  });

  describe('getSseParams()', () => {
    it('should return SSECustomerKey as raw Buffer (not base64 string)', () => {
      const params = service.getSseParams();

      // Critical fix: SSECustomerKey must be a Buffer for AWS SDK to handle correctly
      // The SDK does its own base64 encoding for the signature computation.
      // Passing a base64 string causes double-encoding and signature mismatch.
      expect(Buffer.isBuffer(params.SSECustomerKey)).toBe(true);
      expect(typeof params.SSECustomerKey).toBe('object');

      // Verify it's exactly 32 bytes (256 bits)
      expect(params.SSECustomerKey.length).toBe(32);
    });

    it('should return SSECustomerAlgorithm as AES256', () => {
      const params = service.getSseParams();
      expect(params.SSECustomerAlgorithm).toBe('AES256');
    });

    it('should return SSECustomerKeyMD5 as base64-encoded MD5 hash', () => {
      const params = service.getSseParams();

      // SSECustomerKeyMD5 must be the MD5 hash of the raw key, base64-encoded
      expect(typeof params.SSECustomerKeyMD5).toBe('string');

      // Base64 strings typically have length divisible by 4 (with padding)
      // MD5 hash is 16 bytes, so base64-encoded it should be 24 bytes
      expect(params.SSECustomerKeyMD5.length).toBe(24);
    });

    it('should have consistent SSECustomerKeyMD5 across calls', () => {
      const params1 = service.getSseParams();
      const params2 = service.getSseParams();

      expect(params1.SSECustomerKeyMD5).toBe(params2.SSECustomerKeyMD5);
    });
  });

  describe('getSseHeaders()', () => {
    it('should return headers with base64-encoded key string (not Buffer)', () => {
      const headers = service.getSseHeaders();

      // HTTP headers must be strings, so this uses base64 encoding
      expect(typeof headers['x-amz-server-side-encryption-customer-key']).toBe('string');

      // Should be base64 (alphanumeric + / and +)
      expect(headers['x-amz-server-side-encryption-customer-key']).toMatch(/^[A-Za-z0-9+/=]+$/);
    });

    it('should have correct header names for SSE-C', () => {
      const headers = service.getSseHeaders();

      expect(headers).toHaveProperty('x-amz-server-side-encryption-customer-algorithm');
      expect(headers).toHaveProperty('x-amz-server-side-encryption-customer-key');
      expect(headers).toHaveProperty('x-amz-server-side-encryption-customer-key-MD5');
    });

    it('should return algorithm as AES256 in headers', () => {
      const headers = service.getSseHeaders();
      expect(headers['x-amz-server-side-encryption-customer-algorithm']).toBe('AES256');
    });
  });

  describe('getSseParams() vs getSseHeaders() consistency', () => {
    it('should have matching key material (raw vs encoded)', () => {
      const params = service.getSseParams();
      const headers = service.getSseHeaders();

      // params.SSECustomerKey is raw Buffer, headers key is base64-encoded
      const paramKeyBase64 = params.SSECustomerKey.toString('base64');
      const headerKey = headers['x-amz-server-side-encryption-customer-key'];

      expect(paramKeyBase64).toBe(headerKey);
    });

    it('should have matching MD5 hashes', () => {
      const params = service.getSseParams();
      const headers = service.getSseHeaders();

      expect(params.SSECustomerKeyMD5).toBe(headers['x-amz-server-side-encryption-customer-key-MD5']);
    });
  });

  describe('initialization validation', () => {
    it('should throw error if OBJECT_STORAGE_SSE_C_KEY is not 32 bytes when decoded', async () => {
      const shortKey = Buffer.alloc(16).toString('base64'); // Only 16 bytes

      const moduleRef = Test.createTestingModule({
        providers: [
          ObjectStorageSseService,
          {
            provide: ConfigService,
            useValue: {
              getOrThrow: (key: string) => {
                if (key === 'OBJECT_STORAGE_SSE_C_KEY') return shortKey;
                throw new Error(`Unknown config key: ${key}`);
              },
            },
          },
        ],
      });

      expect(async () => {
        await moduleRef.compile();
      }).rejects.toThrow();
    });
  });
});
