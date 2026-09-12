import { Test } from '@nestjs/testing';
import { ConfigService, ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { CryptoModule } from './crypto/crypto.module';

describe('Module Wiring - Dependency Resolution', () => {
  const mockConfigService = {
    getOrThrow: (key: string) => {
      const defaults: Record<string, string> = {
        OBJECT_STORAGE_ENDPOINT: 'http://localhost:9000',
        OBJECT_STORAGE_PUBLIC_ENDPOINT: 'https://localhost:9000',
        OBJECT_STORAGE_ACCESS_KEY: 'test-key',
        OBJECT_STORAGE_SECRET_KEY: 'test-secret',
        OBJECT_STORAGE_BUCKET: 'test-bucket',
        VOYAGE_API_KEY: 'test-voyage-key',
        VOYAGE_MODEL: 'voyage-3-lite',
        ANTHROPIC_API_KEY: 'test-anthropic-key',
        REDIS_URL: 'redis://localhost:6379',
        DATABASE_URL: 'postgresql://test:test@localhost:5432/memories_test',
        CLERK_SECRET_KEY: 'test-clerk-secret',
        FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 'a').toString('base64'),
      };
      if (!(key in defaults)) {
        throw new Error(`Configuration key '${key}' does not exist`);
      }
      return defaults[key];
    },
    get: (key: string, defaultValue?: string) => {
      try {
        return mockConfigService.getOrThrow(key);
      } catch {
        return defaultValue;
      }
    },
  };

  it('VaultModule should resolve with real dependencies (catches missing exports)', async () => {
    const { VaultModule } = await import('../modules/vault/vault.module');

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), CryptoModule, PrismaModule, VaultModule],
    })
      .overrideProvider(ConfigService)
      .useValue(mockConfigService)
      .compile();

    expect(moduleRef).toBeDefined();
  });

  it('MemoryModule should resolve with real dependencies (catches missing exports)', async () => {
    const { MemoryModule } = await import('../modules/memory/memory.module');

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), CryptoModule, PrismaModule, MemoryModule],
    })
      .overrideProvider(ConfigService)
      .useValue(mockConfigService)
      .compile();

    expect(moduleRef).toBeDefined();
  });

  it('CollectionsModule should resolve with real dependencies (catches missing exports)', async () => {
    const { CollectionsModule } = await import('../modules/collections/collections.module');

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), CryptoModule, PrismaModule, CollectionsModule],
    })
      .overrideProvider(ConfigService)
      .useValue(mockConfigService)
      .compile();

    expect(moduleRef).toBeDefined();
  });
});
