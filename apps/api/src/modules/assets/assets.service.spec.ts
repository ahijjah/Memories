import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AssetsService } from './assets.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AiQueueService } from '../ai/ai-queue.service';
import { ObjectStorageSseService } from '../../common/crypto/object-storage-sse.service';

describe('AssetsService', () => {
  let service: AssetsService;
  let configService: ConfigService;
  let prismaService: PrismaService;
  let aiQueueService: AiQueueService;
  let sseCryptoService: ObjectStorageSseService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssetsService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) => {
              const config: Record<string, string> = {
                OBJECT_STORAGE_ENDPOINT: 'http://minio:9000',
                OBJECT_STORAGE_PUBLIC_ENDPOINT: 'https://minio.example.com',
                OBJECT_STORAGE_ACCESS_KEY: 'minioadmin',
                OBJECT_STORAGE_SECRET_KEY: 'minioadmin',
                OBJECT_STORAGE_BUCKET: 'memory-app-assets',
              };
              return config[key];
            },
          },
        },
        {
          provide: PrismaService,
          useValue: {
            memory: {
              findUnique: jest.fn().mockResolvedValue({ id: 'mem-123', sourceType: 'camera' }),
            },
            memoryAsset: {
              create: jest.fn().mockResolvedValue({ id: 'asset-123' }),
            },
          },
        },
        {
          provide: AiQueueService,
          useValue: {
            enqueueUnderstanding: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ObjectStorageSseService,
          useValue: {
            getSseParams: jest.fn().mockReturnValue({}),
            getSseHeaders: jest.fn().mockReturnValue({}),
          },
        },
      ],
    }).compile();

    service = module.get<AssetsService>(AssetsService);
    configService = module.get<ConfigService>(ConfigService);
    prismaService = module.get<PrismaService>(PrismaService);
    aiQueueService = module.get<AiQueueService>(AiQueueService);
    sseCryptoService = module.get<ObjectStorageSseService>(ObjectStorageSseService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createUploadTarget', () => {
    it('should generate a presigned URL without checksum parameters', async () => {
      const result = await service.createUploadTarget('mem-123', 'image/jpeg');

      expect(result).toBeDefined();
      expect(result.uploadUrl).toBeDefined();
      expect(result.objectKey).toBeDefined();
      expect(result.mimeType).toBe('image/jpeg');

      // Parse the URL to check query parameters
      const url = new URL(result.uploadUrl);
      const params = new URLSearchParams(url.search);

      // Verify that checksum-related parameters are NOT present in the presigned URL.
      // These parameters would cause MinIO to reject uploads from non-SDK clients
      // that cannot compute matching checksums.
      expect(params.has('x-amz-checksum-crc32')).toBe(false);
      expect(params.has('x-amz-sdk-checksum-algorithm')).toBe(false);

      // Verify standard presigned URL parameters are present
      expect(params.has('X-Amz-Algorithm')).toBe(true);
      expect(params.has('X-Amz-Credential')).toBe(true);
      expect(params.has('X-Amz-Date')).toBe(true);
      expect(params.has('X-Amz-Expires')).toBe(true);
      expect(params.has('X-Amz-Signature')).toBe(true);

      // Log evidence for verification: the URL query string should NOT contain
      // checksum algorithm parameters that would break non-SDK uploads
      const allParams = Array.from(params.keys()).sort();
      const hasChecksumParams = allParams.some(
        (key) => key.includes('checksum') || key.includes('algorithm'),
      );
      expect(hasChecksumParams).toBe(false);
    });
  });
});
