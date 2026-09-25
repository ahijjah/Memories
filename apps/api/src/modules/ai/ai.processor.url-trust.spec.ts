import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { AiProcessor } from './ai.processor';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmbeddingService } from './embedding.service';
import { UrlMetadataService, UrlMetadataResult } from './url-metadata.service';
import { FieldEncryptionService } from '../../common/crypto/field-encryption.service';
import { ObjectStorageSseService } from '../../common/crypto/object-storage-sse.service';
import type { Job } from 'bullmq';

jest.mock('@memory-app/ai', () => ({
  AnthropicAiProvider: jest.fn(),
}));

import { AnthropicAiProvider } from '@memory-app/ai';

const FB_URL = 'https://www.facebook.com/share/p/SENTINELPATH/?mibextid=SENTINELQUERY';
const PAGE_IMAGE_URL = 'https://static.xx.fbcdn.net/rsrc.php/SENTINELIMAGE.png';

const REJECTED: UrlMetadataResult = {
  status: 'rejected',
  reason: 'FINAL_PATH_INTERSTITIAL',
  requestedHost: 'www.facebook.com',
  finalHost: 'www.facebook.com',
  redirectCount: 2,
};

const UNAVAILABLE: UrlMetadataResult = {
  status: 'unavailable',
  reason: 'FETCH_FAILED',
  requestedHost: 'www.facebook.com',
};

const UNDERSTANDING = {
  title: 'Sunset at the beach',
  summary: 'A photo of a sunset.',
  type: 'GENERIC',
  topics: ['sunset'],
  confidence: 0.9,
  modelVersion: 'test-model',
};

describe('AiProcessor - URL page trust and evidence boundary', () => {
  let processor: AiProcessor;
  let prisma: any;
  let embedding: any;
  let urlMetadata: { fetchMetadata: jest.Mock; fetchImageBytes: jest.Mock };
  let provider: { understand: jest.Mock };
  let fetchUserAsset: jest.SpyInstance;

  const job = (memoryId: string) => ({ data: { memoryId } }) as Partial<Job> as Job;

  const urlMemory = (overrides: Record<string, unknown> = {}) => ({
    id: 'mem-fb',
    userId: 'user-1',
    title: FB_URL,
    sourceType: 'url',
    sourceUri: FB_URL,
    capturedAt: new Date('2026-09-24T10:00:00Z'),
    processingState: 'queued',
    lifecycleState: 'active',
    securityScope: 'private',
    idempotencyKey: 'key-1',
    ...overrides,
  });

  const updateCallsWith = (state: string) =>
    prisma.memory.update.mock.calls.filter(
      ([args]: any[]) => args.data?.processingState === state,
    );

  beforeEach(async () => {
    prisma = {
      memory: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      aIInference: { create: jest.fn().mockResolvedValue({}) },
      memoryAsset: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn().mockResolvedValue(null),
    };
    embedding = {
      embed: jest.fn().mockResolvedValue(new Array(1024).fill(0.1)),
      getModel: jest.fn().mockReturnValue('voyage-4'),
    };
    urlMetadata = {
      fetchMetadata: jest.fn(),
      fetchImageBytes: jest.fn().mockResolvedValue({
        data: Buffer.from('page-image'),
        mimeType: 'image/jpeg',
      }),
    };
    const config = {
      getOrThrow: jest.fn().mockImplementation((key: string) =>
        key === 'OBJECT_STORAGE_SSE_C_KEY' ? Buffer.from('a'.repeat(32)).toString('base64') : 'x',
      ),
    };
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiProcessor,
        { provide: PrismaService, useValue: prisma },
        { provide: EmbeddingService, useValue: embedding },
        { provide: UrlMetadataService, useValue: urlMetadata },
        { provide: ConfigService, useValue: config },
        { provide: FieldEncryptionService, useValue: { encrypt: jest.fn((v) => v), decrypt: jest.fn((v) => v) } },
        { provide: ObjectStorageSseService, useValue: { getSseParams: jest.fn().mockReturnValue({}) } },
      ],
    }).compile();

    processor = module.get(AiProcessor);
    provider = { understand: jest.fn().mockResolvedValue(UNDERSTANDING) };
    (AnthropicAiProvider as jest.Mock).mockImplementation(() => provider);

    // User-uploaded assets are read from object storage via the Memory's asset rows.
    fetchUserAsset = jest
      .spyOn(processor as any, 'fetchImageAsBase64')
      .mockResolvedValue({ base64: 'USER-UPLOADED-BYTES', mediaType: 'image/png' });
  });

  afterEach(() => jest.restoreAllMocks());

  describe.each([
    ['rejected', REJECTED],
    ['unavailable', UNAVAILABLE],
  ])('Facebook URL with %s page metadata and no user asset', (_label, result) => {
    beforeEach(() => {
      prisma.memory.findUnique.mockResolvedValue(urlMemory());
      urlMetadata.fetchMetadata.mockResolvedValue(result);
    });

    it('does not fetch or analyse any page-derived image', async () => {
      await processor.process(job('mem-fb'));
      expect(urlMetadata.fetchImageBytes).not.toHaveBeenCalled();
    });

    it('does not ask the AI to infer the post from the URL, writes no inferences and no embedding', async () => {
      await expect(processor.process(job('mem-fb'))).resolves.toBeUndefined();

      expect(provider.understand).not.toHaveBeenCalled();
      expect(prisma.aIInference.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(embedding.embed).not.toHaveBeenCalled();
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('persists the Memory as a partial saved link with no page image', async () => {
      await processor.process(job('mem-fb'));

      const partial = updateCallsWith('partial');
      expect(partial).toHaveLength(1);
      expect(partial[0][0]).toEqual({
        where: { id: 'mem-fb' },
        data: { processingState: 'partial', ogImageUrl: null },
      });
      expect(updateCallsWith('understood')).toHaveLength(0);
      expect(updateCallsWith('failed')).toHaveLength(0);
    });
  });

  it('rejected Facebook metadata + real user-uploaded asset: uses only the user asset, never the page image', async () => {
    prisma.memory.findUnique.mockResolvedValue(urlMemory());
    prisma.memoryAsset.findMany.mockResolvedValue([
      { id: 'asset-1', memoryId: 'mem-fb', objectKey: 'user-1/uploads/photo.png', mimeType: 'image/png', pageIndex: 0 },
    ]);
    urlMetadata.fetchMetadata.mockResolvedValue(REJECTED);

    await processor.process(job('mem-fb'));

    // Provenance: the image comes from the Memory's own asset row in object storage.
    expect(prisma.memoryAsset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { memoryId: 'mem-fb' } }),
    );
    expect(fetchUserAsset).toHaveBeenCalledWith('user-1/uploads/photo.png', 'image/png');
    expect(urlMetadata.fetchImageBytes).not.toHaveBeenCalled();

    expect(provider.understand).toHaveBeenCalledTimes(1);
    const input = provider.understand.mock.calls[0][0];
    expect(input.images).toEqual([{ base64: 'USER-UPLOADED-BYTES', mediaType: 'image/png' }]);

    const understood = updateCallsWith('understood');
    expect(understood).toHaveLength(1);
    expect(understood[0][0].data.ogImageUrl).toBeNull();
    expect(updateCallsWith('partial')).toHaveLength(0);
  });

  it('trusted Facebook metadata: normal processing with page metadata and og:image vision', async () => {
    prisma.memory.findUnique.mockResolvedValue(urlMemory());
    urlMetadata.fetchMetadata.mockResolvedValue({
      status: 'ok',
      metadata: {
        title: 'Jane Doe - Sunset at the beach | Facebook',
        description: 'Golden hour at the pier with friends.',
        imageUrl: 'https://scontent.xx.fbcdn.net/v/photo.jpg',
      },
      requestedHost: 'www.facebook.com',
      finalHost: 'www.facebook.com',
      redirectCount: 1,
    });

    await processor.process(job('mem-fb'));

    expect(urlMetadata.fetchImageBytes).toHaveBeenCalledWith('https://scontent.xx.fbcdn.net/v/photo.jpg');
    const input = provider.understand.mock.calls[0][0];
    expect(input.text).toContain('Golden hour at the pier with friends.');
    expect(input.images).toEqual([
      { base64: Buffer.from('page-image').toString('base64'), mediaType: 'image/jpeg' },
    ]);
    const understood = updateCallsWith('understood');
    expect(understood[0][0].data.ogImageUrl).toBe('https://scontent.xx.fbcdn.net/v/photo.jpg');
    expect(embedding.embed).toHaveBeenCalled();
  });

  it('non-Facebook URL with unavailable metadata keeps the existing raw-title fallback', async () => {
    prisma.memory.findUnique.mockResolvedValue(
      urlMemory({ title: 'https://example.com/article', sourceUri: 'https://example.com/article' }),
    );
    urlMetadata.fetchMetadata.mockResolvedValue({
      status: 'unavailable',
      reason: 'FETCH_FAILED',
      requestedHost: 'example.com',
    });

    await processor.process(job('mem-fb'));

    expect(provider.understand).toHaveBeenCalledTimes(1);
    expect(provider.understand.mock.calls[0][0].text).toBe('https://example.com/article');
    expect(updateCallsWith('understood')).toHaveLength(1);
    expect(updateCallsWith('understood')[0][0].data.ogImageUrl).toBeUndefined();
    expect(updateCallsWith('partial')).toHaveLength(0);
  });

  it('never logs the URL path/query, page title or page image URL', async () => {
    const logged: string[] = [];
    for (const level of ['log', 'warn', 'debug', 'error', 'verbose'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
      });
    }

    prisma.memory.findUnique.mockResolvedValue(urlMemory());
    urlMetadata.fetchMetadata.mockResolvedValueOnce(REJECTED);
    await processor.process(job('mem-fb'));

    urlMetadata.fetchMetadata.mockResolvedValueOnce({
      status: 'ok',
      metadata: { title: 'SENTINELTITLE post', description: 'desc', imageUrl: PAGE_IMAGE_URL },
      requestedHost: 'www.facebook.com',
      finalHost: 'www.facebook.com',
      redirectCount: 0,
    });
    urlMetadata.fetchImageBytes.mockResolvedValueOnce(null);
    await processor.process(job('mem-fb'));

    expect(logged.length).toBeGreaterThan(0);
    for (const line of logged) {
      expect(line).not.toMatch(/SENTINEL/);
    }
  });
});
