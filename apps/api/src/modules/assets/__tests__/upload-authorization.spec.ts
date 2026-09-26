import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { AssetsService } from '../assets.service';
import { AssetsController } from '../assets.controller';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AiQueueService } from '../../ai/ai-queue.service';
import { ObjectStorageSseService } from '../../../common/crypto/object-storage-sse.service';
import { ClerkAuthGuard } from '../../auth/clerk-auth.guard';
import { isUserUploadObjectKey } from '../upload-object-key';

describe('Upload ownership and object-key binding', () => {
  const OWNER = 'user-owner';
  const OTHER_USER = 'user-other';
  const MEMORY_ID = '0b7a4f1e-3c2d-4e5f-8a9b-0c1d2e3f4a5b';
  const OTHER_MEMORY_ID = '9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f';
  const LEAF = 'V1StGXR8_Z5jdHi6B-myT';
  const VALID_KEY = `memories/${MEMORY_ID}/${LEAF}`;
  const SSE_PARAMS = { SSECustomerAlgorithm: 'AES256', SSECustomerKeyMD5: 'md5' };

  let service: AssetsService;
  let prisma: {
    memory: { findUnique: jest.Mock };
    memoryAsset: { create: jest.Mock };
  };
  let aiQueue: { enqueueUnderstanding: jest.Mock };
  let s3Send: jest.SpyInstance;

  const memory = (overrides: Record<string, unknown> = {}) => ({
    id: MEMORY_ID,
    userId: OWNER,
    sourceType: 'camera',
    lifecycleState: 'active',
    securityScope: 'private',
    ...overrides,
  });

  beforeEach(async () => {
    prisma = {
      memory: { findUnique: jest.fn().mockResolvedValue(memory()) },
      memoryAsset: { create: jest.fn().mockResolvedValue({ id: 'asset-1' }) },
    };
    aiQueue = { enqueueUnderstanding: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssetsService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) =>
              ({
                OBJECT_STORAGE_ENDPOINT: 'http://minio:9000',
                OBJECT_STORAGE_PUBLIC_ENDPOINT: 'https://minio.example.com',
                OBJECT_STORAGE_ACCESS_KEY: 'test-access',
                OBJECT_STORAGE_SECRET_KEY: 'test-secret',
                OBJECT_STORAGE_BUCKET: 'memory-app-assets',
              })[key],
          },
        },
        { provide: PrismaService, useValue: prisma },
        { provide: AiQueueService, useValue: aiQueue },
        {
          provide: ObjectStorageSseService,
          useValue: {
            getSseParams: jest.fn().mockReturnValue(SSE_PARAMS),
            getSseHeaders: jest.fn().mockReturnValue({}),
          },
        },
      ],
    }).compile();

    service = module.get(AssetsService);
    // Internal S3 client: only complete-upload's HEAD goes through it in these tests.
    s3Send = jest.spyOn((service as any).s3Client, 'send').mockResolvedValue({} as never);
  });

  describe('createUploadTarget', () => {
    it('issues a target in the bound key shape for the owner of a normal Memory', async () => {
      const result = await service.createUploadTarget(MEMORY_ID, 'image/jpeg', OWNER);

      expect(prisma.memory.findUnique).toHaveBeenCalledWith({ where: { id: MEMORY_ID } });
      expect(isUserUploadObjectKey(result.objectKey, MEMORY_ID)).toBe(true);
      expect(result.uploadUrl).toContain(encodeURIComponent(result.objectKey).replace(/%2F/g, '/'));
    });

    it('issues a target for the owner of a Vault Memory (Vault Detail uploads)', async () => {
      prisma.memory.findUnique.mockResolvedValue(memory({ securityScope: 'vault' }));

      const result = await service.createUploadTarget(MEMORY_ID, 'image/jpeg', OWNER);

      expect(isUserUploadObjectKey(result.objectKey, MEMORY_ID)).toBe(true);
    });

    it("rejects another user's Memory", async () => {
      await expect(service.createUploadTarget(MEMORY_ID, 'image/jpeg', OTHER_USER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it.each(['deleted_pending', 'deleted'])('rejects a %s Memory as not found', async (lifecycleState) => {
      prisma.memory.findUnique.mockResolvedValue(memory({ lifecycleState }));

      await expect(service.createUploadTarget(MEMORY_ID, 'image/jpeg', OWNER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects a missing Memory as not found', async () => {
      prisma.memory.findUnique.mockResolvedValue(null);

      await expect(service.createUploadTarget(MEMORY_ID, 'image/jpeg', OWNER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('completeUpload', () => {
    const expectNoStorageOrRegistration = () => {
      expect(s3Send).not.toHaveBeenCalled();
      expect(prisma.memoryAsset.create).not.toHaveBeenCalled();
      expect(aiQueue.enqueueUnderstanding).not.toHaveBeenCalled();
    };

    it('registers an exact issued-shape key for the owner: HEAD with SSE-C, variant original, enqueue', async () => {
      const result = await service.completeUpload(MEMORY_ID, VALID_KEY, 'image/jpeg', OWNER, 'sum', undefined);

      expect(s3Send).toHaveBeenCalledTimes(1);
      const head = s3Send.mock.calls[0][0];
      expect(head).toBeInstanceOf(HeadObjectCommand);
      expect(head.input).toEqual({ Bucket: 'memory-app-assets', Key: VALID_KEY, ...SSE_PARAMS });
      expect(prisma.memoryAsset.create).toHaveBeenCalledWith({
        data: {
          memoryId: MEMORY_ID,
          objectKey: VALID_KEY,
          mimeType: 'image/jpeg',
          checksum: 'sum',
          pageIndex: undefined,
          variant: 'original',
        },
      });
      expect(aiQueue.enqueueUnderstanding).toHaveBeenCalledWith(MEMORY_ID);
      expect(result).toEqual({ id: 'asset-1' });
    });

    it('accepts a key produced by createUploadTarget for the same Memory', async () => {
      const target = await service.createUploadTarget(MEMORY_ID, 'image/jpeg', OWNER);

      await service.completeUpload(MEMORY_ID, target.objectKey, 'image/jpeg', OWNER);

      expect(prisma.memoryAsset.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ objectKey: target.objectKey }) }),
      );
    });

    it('keeps enqueue behavior: no auto-enqueue for multi-page uploads', async () => {
      await service.completeUpload(MEMORY_ID, VALID_KEY, 'image/jpeg', OWNER, undefined, 0);

      expect(prisma.memoryAsset.create).toHaveBeenCalled();
      expect(aiQueue.enqueueUnderstanding).not.toHaveBeenCalled();
    });

    it('keeps enqueue behavior: no auto-enqueue for url-sourced Memories', async () => {
      prisma.memory.findUnique.mockResolvedValue(memory({ sourceType: 'url' }));

      await service.completeUpload(MEMORY_ID, VALID_KEY, 'image/jpeg', OWNER);

      expect(prisma.memoryAsset.create).toHaveBeenCalled();
      expect(aiQueue.enqueueUnderstanding).not.toHaveBeenCalled();
    });

    it('registers for the owner of a Vault Memory', async () => {
      prisma.memory.findUnique.mockResolvedValue(memory({ securityScope: 'vault' }));

      await service.completeUpload(MEMORY_ID, VALID_KEY, 'image/jpeg', OWNER);

      expect(prisma.memoryAsset.create).toHaveBeenCalled();
    });

    it("rejects another user's Memory before touching storage or registering", async () => {
      await expect(
        service.completeUpload(MEMORY_ID, VALID_KEY, 'image/jpeg', OTHER_USER),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expectNoStorageOrRegistration();
    });

    it.each(['deleted_pending', 'deleted'])('rejects a %s Memory before touching storage', async (lifecycleState) => {
      prisma.memory.findUnique.mockResolvedValue(memory({ lifecycleState }));

      await expect(service.completeUpload(MEMORY_ID, VALID_KEY, 'image/jpeg', OWNER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expectNoStorageOrRegistration();
    });

    it('rejects a missing Memory before touching storage', async () => {
      prisma.memory.findUnique.mockResolvedValue(null);

      await expect(service.completeUpload(MEMORY_ID, VALID_KEY, 'image/jpeg', OWNER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expectNoStorageOrRegistration();
    });

    it.each([
      ['a key for another Memory', `memories/${OTHER_MEMORY_ID}/${LEAF}`],
      ['an arbitrary existing object key', 'backups/db-dump.sql.gz'],
      ['an extra path segment', `memories/${MEMORY_ID}/${LEAF}/extra`],
      ['a nested evidence key', `memories/${MEMORY_ID}/evidence/og-image/${LEAF}`],
      ['a traversal key', `memories/${MEMORY_ID}/../${OTHER_MEMORY_ID}/${LEAF}`],
      ['an empty leaf', `memories/${MEMORY_ID}/`],
      ['a malformed leaf', `memories/${MEMORY_ID}/photo.jpg`],
      ['a legacy test-style key', `memories/${MEMORY_ID}/image.jpg`],
    ])('rejects %s before touching storage or registering', async (_label, objectKey) => {
      await expect(service.completeUpload(MEMORY_ID, objectKey, 'image/jpeg', OWNER)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expectNoStorageOrRegistration();
    });

    it("does not register another user's valid key under the attacker's own Memory", async () => {
      // Attacker owns OTHER_MEMORY_ID and submits the victim's key for MEMORY_ID.
      prisma.memory.findUnique.mockResolvedValue(memory({ id: OTHER_MEMORY_ID, userId: OTHER_USER }));

      await expect(
        service.completeUpload(OTHER_MEMORY_ID, VALID_KEY, 'image/jpeg', OTHER_USER),
      ).rejects.toBeInstanceOf(BadRequestException);
      expectNoStorageOrRegistration();
    });
  });

  describe('AssetsController', () => {
    let controller: AssetsController;
    const assetsService = {
      createUploadTarget: jest.fn().mockResolvedValue({}),
      completeUpload: jest.fn().mockResolvedValue({}),
    };

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        controllers: [AssetsController],
        providers: [{ provide: AssetsService, useValue: assetsService }],
      })
        .overrideGuard(ClerkAuthGuard)
        .useValue({ canActivate: () => true })
        .compile();
      controller = module.get(AssetsController);
      jest.clearAllMocks();
    });

    const user = { sub: OWNER, email: 'owner@example.com', clerkUserId: 'clerk_1' } as any;

    it('passes the authenticated user id (sub) to createUploadTarget', async () => {
      await controller.createUpload({ memoryId: MEMORY_ID, mimeType: 'image/jpeg' }, user);

      expect(assetsService.createUploadTarget).toHaveBeenCalledWith(MEMORY_ID, 'image/jpeg', OWNER);
    });

    it('passes the authenticated user id (sub) to completeUpload', async () => {
      await controller.completeUpload(
        { memoryId: MEMORY_ID, objectKey: VALID_KEY, mimeType: 'image/jpeg', checksum: 'c', pageIndex: 2 },
        user,
      );

      expect(assetsService.completeUpload).toHaveBeenCalledWith(MEMORY_ID, VALID_KEY, 'image/jpeg', OWNER, 'c', 2);
    });
  });
});
