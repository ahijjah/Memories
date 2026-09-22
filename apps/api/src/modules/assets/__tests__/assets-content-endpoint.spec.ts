import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotFoundException, ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { Readable } from 'stream';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { AssetsService } from '../assets.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AiQueueService } from '../../ai/ai-queue.service';
import { ObjectStorageSseService } from '../../../common/crypto/object-storage-sse.service';

describe('AssetsService.getAssetContentStream', () => {
  let service: AssetsService;
  let prismaService: PrismaService;
  let sseCryptoService: ObjectStorageSseService;
  let s3ClientSpy: jest.SpyInstance;

  const mockUserId = 'test-user-123';
  const mockAssetId = 'asset-123';
  const mockMemoryId = 'memory-456';
  const mockObjectKey = 'memories/memory-456/file.jpg';

  const mockAsset = {
    id: mockAssetId,
    memoryId: mockMemoryId,
    objectKey: mockObjectKey,
    mimeType: 'image/jpeg',
    checksum: 'abc123',
    pageIndex: null,
    variant: 'original' as const,
    createdAt: new Date(),
  };

  const mockMemory = {
    id: mockMemoryId,
    userId: mockUserId,
    lifecycleState: 'active' as const,
    securityScope: 'private' as const,
  };

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
            memoryAsset: {
              findUnique: jest.fn(),
            },
          },
        },
        {
          provide: AiQueueService,
          useValue: {},
        },
        {
          provide: ObjectStorageSseService,
          useValue: {
            getSseParams: jest.fn().mockReturnValue({
              SSECustomerAlgorithm: 'AES256',
              SSECustomerKey: 'test-key-32-bytes-long-1234567890ab',
              SSECustomerKeyMD5: 'test-md5-hash',
            }),
            getSseHeaders: jest.fn().mockReturnValue({
              'x-amz-server-side-encryption-customer-algorithm': 'AES256',
            }),
          },
        },
      ],
    }).compile();

    service = module.get<AssetsService>(AssetsService);
    prismaService = module.get<PrismaService>(PrismaService);
    sseCryptoService = module.get<ObjectStorageSseService>(ObjectStorageSseService);

    // Spy on S3Client.send to verify SSE-C parameters
    s3ClientSpy = jest.spyOn(service['s3Client'], 'send' as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('successful retrieval', () => {
    it('should return stream with mimeType and ContentLength for existing asset', async () => {
      const mockStream = new Readable();
      mockStream.push('mock file data');
      mockStream.push(null);

      (prismaService.memoryAsset.findUnique as jest.Mock).mockResolvedValue({
        ...mockAsset,
        memory: mockMemory,
      });

      s3ClientSpy.mockResolvedValueOnce({
        Body: mockStream,
        ContentLength: 1024,
      });

      const result = await service.getAssetContentStream(mockAssetId, mockUserId);

      expect(result.body).toBe(mockStream);
      expect(result.mimeType).toBe('image/jpeg');
      expect(result.size).toBe(1024);
    });

    it('should include SSE-C parameters in GetObjectCommand', async () => {
      const mockStream = new Readable();
      (prismaService.memoryAsset.findUnique as jest.Mock).mockResolvedValue({
        ...mockAsset,
        memory: mockMemory,
      });

      s3ClientSpy.mockResolvedValueOnce({
        Body: mockStream,
        ContentLength: 512,
      });

      await service.getAssetContentStream(mockAssetId, mockUserId);

      // Verify GetObjectCommand was called with SSE-C params
      expect(s3ClientSpy).toHaveBeenCalledWith(expect.any(GetObjectCommand));
      const command = s3ClientSpy.mock.calls[0][0];
      expect(command.input.SSECustomerAlgorithm).toBe('AES256');
      expect(command.input.SSECustomerKey).toBeDefined();
    });

    it('should allow owner to retrieve vault assets', async () => {
      const vaultAsset = { ...mockAsset, memory: { ...mockMemory, securityScope: 'vault' } };
      const mockStream = new Readable();

      (prismaService.memoryAsset.findUnique as jest.Mock).mockResolvedValue(vaultAsset);
      s3ClientSpy.mockResolvedValueOnce({ Body: mockStream, ContentLength: 256 });

      const result = await service.getAssetContentStream(mockAssetId, mockUserId);

      expect(result).toBeDefined();
      expect(result.mimeType).toBe('image/jpeg');
    });
  });

  describe('access control', () => {
    it('should throw ForbiddenException when user does not own the memory', async () => {
      const differentUser = 'other-user-789';
      (prismaService.memoryAsset.findUnique as jest.Mock).mockResolvedValue({
        ...mockAsset,
        memory: { ...mockMemory, userId: mockUserId },
      });

      await expect(service.getAssetContentStream(mockAssetId, differentUser)).rejects.toThrow(
        ForbiddenException
      );
    });

    it('should throw NotFoundException when asset does not exist', async () => {
      (prismaService.memoryAsset.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getAssetContentStream('nonexistent-id', mockUserId)).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('memory lifecycle', () => {
    it('should throw NotFoundException when memory is deleted', async () => {
      (prismaService.memoryAsset.findUnique as jest.Mock).mockResolvedValue({
        ...mockAsset,
        memory: { ...mockMemory, lifecycleState: 'deleted' },
      });

      await expect(service.getAssetContentStream(mockAssetId, mockUserId)).rejects.toThrow(
        NotFoundException
      );
    });

    it('should throw NotFoundException when memory is deleted_pending', async () => {
      (prismaService.memoryAsset.findUnique as jest.Mock).mockResolvedValue({
        ...mockAsset,
        memory: { ...mockMemory, lifecycleState: 'deleted_pending' },
      });

      await expect(service.getAssetContentStream(mockAssetId, mockUserId)).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('error handling', () => {
    it('should throw InternalServerErrorException on S3 failure', async () => {
      (prismaService.memoryAsset.findUnique as jest.Mock).mockResolvedValue({
        ...mockAsset,
        memory: mockMemory,
      });

      const s3Error = new Error('S3 connection failed');
      s3ClientSpy.mockRejectedValueOnce(s3Error);

      await expect(service.getAssetContentStream(mockAssetId, mockUserId)).rejects.toThrow(
        InternalServerErrorException
      );
    });

    it('should NOT retry without SSE-C on failure (no fallback)', async () => {
      (prismaService.memoryAsset.findUnique as jest.Mock).mockResolvedValue({
        ...mockAsset,
        memory: mockMemory,
      });

      s3ClientSpy.mockRejectedValueOnce(new Error('Invalid SSE-C key'));

      await expect(service.getAssetContentStream(mockAssetId, mockUserId)).rejects.toThrow(
        InternalServerErrorException
      );

      // Verify only one S3 call was made (no retry/fallback)
      expect(s3ClientSpy).toHaveBeenCalledTimes(1);
    });

    it('should handle undefined ContentLength in S3 response', async () => {
      const mockStream = new Readable();
      (prismaService.memoryAsset.findUnique as jest.Mock).mockResolvedValue({
        ...mockAsset,
        memory: mockMemory,
      });

      s3ClientSpy.mockResolvedValueOnce({
        Body: mockStream,
        ContentLength: undefined,
      });

      const result = await service.getAssetContentStream(mockAssetId, mockUserId);

      expect(result.size).toBeUndefined();
    });
  });
});
