import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { AssetsService, SOURCE_SCREENSHOT_MIME_TYPES } from '../assets.service';
import { CompleteUploadDto } from '../dto/asset.dto';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AiQueueService } from '../../ai/ai-queue.service';
import { ObjectStorageSseService } from '../../../common/crypto/object-storage-sse.service';

// FACEBOOK-USER-EVIDENCE-01: complete-upload with evidenceRole=source_screenshot.
describe('complete-upload: source screenshot evidence role and retry idempotency', () => {
  const OWNER = 'user-owner';
  const OTHER_USER = 'user-other';
  const MEMORY_ID = '0b7a4f1e-3c2d-4e5f-8a9b-0c1d2e3f4a5b';
  const OTHER_MEMORY_ID = '9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f';
  const LEAF = 'V1StGXR8_Z5jdHi6B-myT';
  const KEY = `memories/${MEMORY_ID}/${LEAF}`;
  const FB_URL = 'https://www.facebook.com/share/p/SENTINELPATH/';

  let service: AssetsService;
  let prisma: { memory: { findUnique: jest.Mock }; memoryAsset: { create: jest.Mock; findFirst: jest.Mock } };
  let aiQueue: { enqueueUnderstanding: jest.Mock };
  let s3Send: jest.SpyInstance;

  const urlMemory = (overrides: Record<string, unknown> = {}) => ({
    id: MEMORY_ID,
    userId: OWNER,
    sourceType: 'url',
    sourceUri: FB_URL,
    lifecycleState: 'active',
    securityScope: 'private',
    ...overrides,
  });

  beforeEach(async () => {
    prisma = {
      memory: { findUnique: jest.fn().mockResolvedValue(urlMemory()) },
      memoryAsset: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'asset-new', ...data })),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    aiQueue = { enqueueUnderstanding: jest.fn().mockResolvedValue(undefined) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssetsService,
        {
          provide: ConfigService,
          useValue: { getOrThrow: (key: string) => (key === 'OBJECT_STORAGE_BUCKET' ? 'bucket' : 'http://minio:9000') },
        },
        { provide: PrismaService, useValue: prisma },
        { provide: AiQueueService, useValue: aiQueue },
        {
          provide: ObjectStorageSseService,
          useValue: { getSseParams: jest.fn().mockReturnValue({}), getSseHeaders: jest.fn().mockReturnValue({}) },
        },
      ],
    }).compile();
    service = module.get(AssetsService);
    // HEAD reports the stored object's type, as set by the signed upload.
    s3Send = jest.spyOn((service as any).s3Client, 'send').mockResolvedValue({ ContentType: 'image/png' } as never);
  });

  const SCREENSHOT = 'source_screenshot' as const;
  // `role` is passed explicitly by every caller that needs something other than a screenshot
  // (an explicit undefined means "no role").
  const complete = (
    overrides: Partial<{ memoryId: string; key: string; mime: string; user: string; pageIndex: number }> = {},
    ...rest: [role?: any]
  ) =>
    service.completeUpload(
      overrides.memoryId ?? MEMORY_ID,
      overrides.key ?? KEY,
      overrides.mime ?? 'image/png',
      overrides.user ?? OWNER,
      'md5sum',
      overrides.pageIndex,
      rest.length > 0 ? rest[0] : SCREENSHOT,
    );

  describe('accepted', () => {
    it('registers a source screenshot for the owner of a URL Memory, with the role on the row', async () => {
      const asset = await complete();

      expect(prisma.memoryAsset.create).toHaveBeenCalledWith({
        data: {
          memoryId: MEMORY_ID,
          objectKey: KEY,
          mimeType: 'image/png',
          checksum: 'md5sum',
          pageIndex: undefined,
          variant: 'original',
          evidenceRole: 'source_screenshot',
        },
      });
      expect(asset).toMatchObject({ evidenceRole: 'source_screenshot' });
      // URL Memories are reprocessed by the client (unchanged): no auto-enqueue here.
      expect(aiQueue.enqueueUnderstanding).not.toHaveBeenCalled();
    });

    it('is not limited to Facebook links', async () => {
      prisma.memory.findUnique.mockResolvedValue(urlMemory({ sourceUri: 'https://example.com/article' }));

      await expect(complete()).resolves.toMatchObject({ evidenceRole: 'source_screenshot' });
    });

    it('does not add a Vault restriction (Vault uploads are already allowed for the owner)', async () => {
      prisma.memory.findUnique.mockResolvedValue(urlMemory({ securityScope: 'vault' }));

      await expect(complete()).resolves.toMatchObject({ evidenceRole: 'source_screenshot' });
    });

    it.each(SOURCE_SCREENSHOT_MIME_TYPES)('accepts %s', async (mime) => {
      s3Send.mockResolvedValue({ ContentType: mime });

      await expect(complete({ mime })).resolves.toMatchObject({ mimeType: mime });
    });

    it('treats MIME parameters and case as the same type', async () => {
      s3Send.mockResolvedValue({ ContentType: 'image/PNG; charset=binary' });

      await expect(complete({ mime: 'image/png' })).resolves.toBeDefined();
    });
  });

  describe('rejected', () => {
    const expectNothingRegistered = () => expect(prisma.memoryAsset.create).not.toHaveBeenCalled();

    it.each(['camera', 'image', 'screenshot', 'text', 'document_scan', 'share'])(
      'for a %s Memory, before touching storage',
      async (sourceType) => {
        prisma.memory.findUnique.mockResolvedValue(urlMemory({ sourceType }));

        await expect(complete()).rejects.toBeInstanceOf(BadRequestException);
        expect(s3Send).not.toHaveBeenCalled();
        expectNothingRegistered();
      },
    );

    it('for a URL Memory without a sourceUri', async () => {
      prisma.memory.findUnique.mockResolvedValue(urlMemory({ sourceUri: null }));

      await expect(complete()).rejects.toBeInstanceOf(BadRequestException);
      expectNothingRegistered();
    });

    it.each(['image/heic', 'image/svg+xml', 'application/pdf', 'text/html', 'video/mp4', ''])(
      'for unsupported declared type %p, before touching storage',
      async (mime) => {
        await expect(complete({ mime })).rejects.toBeInstanceOf(BadRequestException);
        expect(s3Send).not.toHaveBeenCalled();
        expectNothingRegistered();
      },
    );

    it.each([
      ['a different stored type', { ContentType: 'text/html' }],
      ['no stored type', {}],
    ])('when the stored object has %s', async (_label, head) => {
      s3Send.mockResolvedValue(head);

      await expect(complete()).rejects.toBeInstanceOf(BadRequestException);
      expectNothingRegistered();
    });

    it("for another user's Memory (ownership unchanged)", async () => {
      await expect(complete({ user: OTHER_USER })).rejects.toBeInstanceOf(ForbiddenException);
      expect(s3Send).not.toHaveBeenCalled();
      expectNothingRegistered();
    });

    it('for a tampered memoryId whose key belongs to another Memory (key binding unchanged)', async () => {
      prisma.memory.findUnique.mockResolvedValue(urlMemory({ id: OTHER_MEMORY_ID }));

      await expect(complete({ memoryId: OTHER_MEMORY_ID })).rejects.toBeInstanceOf(BadRequestException);
      expect(s3Send).not.toHaveBeenCalled();
      expectNothingRegistered();
    });

    it('for a deleted Memory', async () => {
      prisma.memory.findUnique.mockResolvedValue(urlMemory({ lifecycleState: 'deleted_pending' }));

      await expect(complete()).rejects.toBeInstanceOf(NotFoundException);
      expectNothingRegistered();
    });
  });

  describe('ordinary uploads are unchanged', () => {
    it('write the same row as before (no evidenceRole key) and ignore the URL/MIME rules', async () => {
      prisma.memory.findUnique.mockResolvedValue(urlMemory({ sourceType: 'camera', sourceUri: null }));
      s3Send.mockResolvedValue({});

      await complete({ mime: 'application/pdf' }, undefined);

      const { data } = prisma.memoryAsset.create.mock.calls[0][0];
      expect(Object.keys(data).sort()).toEqual(
        ['checksum', 'memoryId', 'mimeType', 'objectKey', 'pageIndex', 'variant'].sort(),
      );
      expect(aiQueue.enqueueUnderstanding).toHaveBeenCalledWith(MEMORY_ID);
    });
  });

  describe('retry idempotency (service level)', () => {
    const existing = (overrides: Record<string, unknown> = {}) => ({
      id: 'asset-existing',
      memoryId: MEMORY_ID,
      objectKey: KEY,
      mimeType: 'image/png',
      pageIndex: null,
      evidenceRole: 'source_screenshot',
      ...overrides,
    });

    it('looks the key up only within the same Memory', async () => {
      await complete();

      expect(prisma.memoryAsset.findFirst).toHaveBeenCalledWith({ where: { memoryId: MEMORY_ID, objectKey: KEY } });
    });

    it('a retry with the same key and role returns the existing asset without a new row or enqueue', async () => {
      prisma.memoryAsset.findFirst.mockResolvedValue(existing());

      await expect(complete()).resolves.toEqual(existing());
      expect(prisma.memoryAsset.create).not.toHaveBeenCalled();
      expect(aiQueue.enqueueUnderstanding).not.toHaveBeenCalled();
    });

    it('an ordinary retry of an ordinary asset returns the existing asset', async () => {
      prisma.memory.findUnique.mockResolvedValue(urlMemory({ sourceType: 'camera' }));
      prisma.memoryAsset.findFirst.mockResolvedValue(existing({ evidenceRole: null }));

      await expect(complete({}, undefined)).resolves.toMatchObject({ id: 'asset-existing' });
      expect(prisma.memoryAsset.create).not.toHaveBeenCalled();
    });

    it.each([
      ['asking for source_screenshot on an ordinary asset', existing({ evidenceRole: null }), 'source_screenshot'],
      ['dropping the role of a source screenshot', existing(), undefined],
    ])('a retry %s is a 409 conflict (the role cannot be changed)', async (_label, row, role) => {
      prisma.memoryAsset.findFirst.mockResolvedValue(row);

      await expect(complete({}, role)).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.memoryAsset.create).not.toHaveBeenCalled();
    });

    it.each([
      ['a different MIME type', existing({ mimeType: 'image/jpeg' })],
      ['a different page index', existing({ pageIndex: 3 })],
    ])('a retry with %s is a 409 conflict', async (_label, row) => {
      prisma.memoryAsset.findFirst.mockResolvedValue(row);

      await expect(complete()).rejects.toBeInstanceOf(ConflictException);
    });

    it('still runs ownership, key binding and the storage check before the lookup', async () => {
      prisma.memoryAsset.findFirst.mockResolvedValue(existing());
      await expect(complete({ user: OTHER_USER })).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.memoryAsset.findFirst).not.toHaveBeenCalled();

      s3Send.mockRejectedValueOnce(new Error('NotFound'));
      await expect(complete()).rejects.toThrow('Object not found in storage');
      expect(prisma.memoryAsset.findFirst).not.toHaveBeenCalled();
    });

    // Documented limitation: two concurrent first requests both see no existing row and both
    // create one. Closing that needs a DB unique constraint on objectKey (separate hardening).
    it('does not claim to prevent concurrent duplicates: two first requests both register', async () => {
      await Promise.all([complete(), complete()]);

      expect(prisma.memoryAsset.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('CompleteUploadDto validation', () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    const body = (extra: Record<string, unknown>) => ({
      memoryId: MEMORY_ID,
      objectKey: KEY,
      mimeType: 'image/png',
      ...extra,
    });
    const validate = (value: unknown) =>
      pipe.transform(value, { type: 'body', metatype: CompleteUploadDto, data: '' });

    it('accepts no role and source_screenshot', async () => {
      await expect(validate(body({}))).resolves.toBeInstanceOf(CompleteUploadDto);
      await expect(validate(body({ evidenceRole: 'source_screenshot' }))).resolves.toMatchObject({
        evidenceRole: 'source_screenshot',
      });
    });

    it('treats a null role as no role (class-validator @IsOptional semantics)', async () => {
      await expect(validate(body({ evidenceRole: null }))).resolves.toMatchObject({ evidenceRole: null });
    });

    it.each(['provider_authenticated', 'verified_source', 'SOURCE_SCREENSHOT', '', 1, true, ['source_screenshot']])(
      'rejects role %p',
      async (evidenceRole) => {
        await expect(validate(body({ evidenceRole }))).rejects.toBeInstanceOf(BadRequestException);
      },
    );
  });
});
