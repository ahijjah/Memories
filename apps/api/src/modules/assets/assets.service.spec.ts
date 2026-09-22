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

    it('should add /storage routing prefix to PUT presigned URL', async () => {
      const result = await service.createUploadTarget('mem-123', 'image/jpeg');

      const url = new URL(result.uploadUrl);
      expect(url.hostname).toBe('minio.example.com');
      expect(url.pathname).toMatch(/^\/storage\/memory-app-assets\//);
      expect(url.pathname).not.toMatch(/storage\/storage/);
    });

    it('should preserve query string after adding /storage prefix', async () => {
      const result = await service.createUploadTarget('mem-123', 'image/jpeg');

      const url = new URL(result.uploadUrl);
      const params = new URLSearchParams(url.search);

      // Verify SigV4 parameters are intact after transformation
      expect(params.has('X-Amz-Algorithm')).toBe(true);
      expect(params.has('X-Amz-Signature')).toBe(true);

      // Extract signature before and after to confirm it wasn't re-serialized
      const signatureParam = params.get('X-Amz-Signature');
      expect(signatureParam).toBeDefined();
      expect(signatureParam?.length).toBeGreaterThan(0);
    });
  });

  describe('getViewUrl routing', () => {
    it('should add /storage prefix to encrypted object GET URL', async () => {
      // Mock S3Client send to succeed (object is encrypted)
      const sendSpy = jest.spyOn(service['s3Client'], 'send' as any).mockResolvedValueOnce({});

      const result = await service.getViewUrl('memories/mem-123/asset-key');

      const url = new URL(result.url);
      expect(url.hostname).toBe('minio.example.com');
      expect(url.pathname).toMatch(/^\/storage\/memory-app-assets\//);
      expect(url.pathname).not.toMatch(/storage\/storage/);

      sendSpy.mockRestore();
    });

    it('should add /storage prefix to unencrypted fallback GET URL', async () => {
      // Mock S3Client send to fail with 400 (unencrypted fallback)
      const error: any = new Error('InvalidArgument');
      error.Code = 'InvalidArgument';
      error.$metadata = { httpStatusCode: 400 };
      const sendSpy = jest.spyOn(service['s3Client'], 'send' as any).mockRejectedValueOnce(error);

      const result = await service.getViewUrl('memories/mem-123/asset-key');

      const url = new URL(result.url);
      expect(url.hostname).toBe('minio.example.com');
      expect(url.pathname).toMatch(/^\/storage\/memory-app-assets\//);
      expect(url.pathname).not.toMatch(/storage\/storage/);

      sendSpy.mockRestore();
    });

    it('should preserve query string in encrypted GET URL after routing prefix', async () => {
      const sendSpy = jest.spyOn(service['s3Client'], 'send' as any).mockResolvedValueOnce({});

      const result = await service.getViewUrl('memories/mem-123/asset-key');

      const url = new URL(result.url);
      const params = new URLSearchParams(url.search);

      // Verify SigV4 parameters are intact
      expect(params.has('X-Amz-Algorithm')).toBe(true);
      expect(params.has('X-Amz-Signature')).toBe(true);
      expect(params.get('X-Amz-Signature')).toBeDefined();

      sendSpy.mockRestore();
    });

    it('should preserve query string in unencrypted GET URL after routing prefix', async () => {
      const error: any = new Error('InvalidArgument');
      error.Code = 'InvalidArgument';
      error.$metadata = { httpStatusCode: 400 };
      const sendSpy = jest.spyOn(service['s3Client'], 'send' as any).mockRejectedValueOnce(error);

      const result = await service.getViewUrl('memories/mem-123/asset-key');

      const url = new URL(result.url);
      const params = new URLSearchParams(url.search);

      // Verify SigV4 parameters are intact
      expect(params.has('X-Amz-Algorithm')).toBe(true);
      expect(params.has('X-Amz-Signature')).toBe(true);
      expect(params.get('X-Amz-Signature')).toBeDefined();

      sendSpy.mockRestore();
    });
  });
});
