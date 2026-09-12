import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FieldEncryptionService } from './field-encryption.service';

describe('FieldEncryptionService', () => {
  let service: FieldEncryptionService;
  const testKey = Buffer.alloc(32, 'a').toString('base64');

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        FieldEncryptionService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) => {
              if (key === 'FIELD_ENCRYPTION_KEY') return testKey;
              throw new Error(`Unknown config key: ${key}`);
            },
          },
        },
      ],
    }).compile();

    service = moduleRef.get(FieldEncryptionService);
  });

  it('should encrypt and decrypt a string correctly', () => {
    const plaintext = 'sensitive-document-number-12345';
    const encrypted = service.encrypt(plaintext);

    expect(encrypted).toMatch(/^enc:v1:/);
    expect(encrypted).not.toContain(plaintext);

    const decrypted = service.decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('should return plaintext unchanged if not prefixed with enc:', () => {
    const plaintext = 'regular-value';
    const result = service.decrypt(plaintext);

    expect(result).toBe(plaintext);
  });

  it('should throw error on tampered ciphertext', () => {
    const plaintext = 'secret-data';
    const encrypted = service.encrypt(plaintext);
    const parts = encrypted.split(':');
    const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:tampered:${parts[4]}`;

    expect(() => service.decrypt(tampered)).toThrow();
  });

  it('should throw error on invalid base64 in encrypted value', () => {
    const invalid = 'enc:v1:!!!invalid-base64!!!:tag:cipher';
    expect(() => service.decrypt(invalid)).toThrow();
  });

  it('should produce different ciphertexts for same plaintext (random IV)', () => {
    const plaintext = 'same-plaintext';
    const encrypted1 = service.encrypt(plaintext);
    const encrypted2 = service.encrypt(plaintext);

    expect(encrypted1).not.toBe(encrypted2);
    expect(service.decrypt(encrypted1)).toBe(plaintext);
    expect(service.decrypt(encrypted2)).toBe(plaintext);
  });

  it('should handle special characters and unicode', () => {
    const plaintext = 'Ñoño_日本語_🎉_@#$%';
    const encrypted = service.encrypt(plaintext);
    const decrypted = service.decrypt(encrypted);

    expect(decrypted).toBe(plaintext);
  });
});
