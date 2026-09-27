import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiProcessor, LLM_INFERENCE_PROVENANCES } from './ai.processor';
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

// FACEBOOK-USER-EVIDENCE-01: a user source screenshot is user evidence only. It never changes the
// Facebook deny-by-default, never admits page content or og:image, and is recorded as such.
const FB_URL = 'https://www.facebook.com/share/p/SENTINELPATH/?mibextid=SENTINELQUERY';
const PAGE_IMAGE_URL = 'https://scontent.xx.fbcdn.net/v/SENTINELIMAGE.jpg';

const FB_REJECTED: UrlMetadataResult = {
  status: 'rejected',
  reason: 'PROFILE_OR_PAGE_LANDING',
  requestedHost: 'www.facebook.com',
  finalHost: 'www.facebook.com',
  redirectCount: 1,
};

// A regressed `ok` for Facebook: the processor backstop must still deny it.
const FB_OK_REGRESSED: UrlMetadataResult = {
  status: 'ok',
  metadata: {
    title: 'SENTINELTITLE page landing',
    description: 'SENTINELDESC 12,345 likes',
    imageUrl: PAGE_IMAGE_URL,
    author: 'SENTINELJSONLD',
  },
  requestedHost: 'www.facebook.com',
  finalHost: 'www.facebook.com',
  redirectCount: 1,
};

const UNDERSTANDING = {
  title: 'Concert poster',
  summary: 'A poster for a concert.',
  type: 'EVENT',
  topics: ['music'],
  confidence: 0.8,
  modelVersion: 'test-model',
};

const SCREENSHOT = {
  id: 'asset-shot',
  memoryId: 'mem-fb',
  objectKey: 'memories/mem-fb/SHOTKEY',
  mimeType: 'image/png',
  pageIndex: null,
  evidenceRole: 'source_screenshot',
};
const PHOTO = {
  id: 'asset-photo',
  memoryId: 'mem-fb',
  objectKey: 'memories/mem-fb/PHOTOKEY',
  mimeType: 'image/jpeg',
  pageIndex: null,
  evidenceRole: null,
};

describe('AiProcessor - user source screenshot evidence', () => {
  let processor: AiProcessor;
  let prisma: any;
  let tx: any;
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
  const createdInferences = () => prisma.aIInference.create.mock.calls.map(([args]: any[]) => args.data);
  const understoodUpdate = () =>
    prisma.memory.update.mock.calls.map(([a]: any[]) => a).find((a: any) => a.data?.processingState === 'understood');

  beforeEach(async () => {
    tx = {
      memory: { update: jest.fn().mockResolvedValue({}) },
      aIInference: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    prisma = {
      memory: { findUnique: jest.fn().mockResolvedValue(urlMemory()), update: jest.fn().mockResolvedValue({}) },
      aIInference: { create: jest.fn().mockResolvedValue({}), deleteMany: jest.fn() },
      memoryAsset: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn().mockImplementation((arg: unknown) =>
        typeof arg === 'function' ? (arg as (t: unknown) => Promise<unknown>)(tx) : Promise.resolve([]),
      ),
      $executeRaw: jest.fn().mockResolvedValue(null),
    };
    urlMetadata = {
      fetchMetadata: jest.fn().mockResolvedValue(FB_REJECTED),
      fetchImageBytes: jest.fn().mockResolvedValue({ data: Buffer.from('page-image'), mimeType: 'image/jpeg' }),
    };
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiProcessor,
        { provide: PrismaService, useValue: prisma },
        {
          provide: EmbeddingService,
          useValue: { embed: jest.fn().mockResolvedValue(new Array(1024).fill(0.1)), getModel: () => 'voyage-4' },
        },
        { provide: UrlMetadataService, useValue: urlMetadata },
        {
          provide: ConfigService,
          useValue: { getOrThrow: (k: string) => (k === 'OBJECT_STORAGE_SSE_C_KEY' ? Buffer.from('a'.repeat(32)).toString('base64') : 'x') },
        },
        { provide: FieldEncryptionService, useValue: { encrypt: jest.fn((v) => v), decrypt: jest.fn((v) => v) } },
        { provide: ObjectStorageSseService, useValue: { getSseParams: jest.fn().mockReturnValue({}) } },
      ],
    }).compile();

    processor = module.get(AiProcessor);
    provider = { understand: jest.fn().mockResolvedValue(UNDERSTANDING) };
    (AnthropicAiProvider as jest.Mock).mockImplementation(() => provider);
    fetchUserAsset = jest
      .spyOn(processor as any, 'fetchImageAsBase64')
      .mockImplementation(async (key: unknown) => ({ base64: `BYTES:${String(key)}`, mediaType: 'image/png' }));
  });

  afterEach(() => jest.restoreAllMocks());

  it('rejected Facebook + no assets: still a partial link, cleanup covers both LLM provenances', async () => {
    await processor.process(job('mem-fb'));

    expect(provider.understand).not.toHaveBeenCalled();
    expect(tx.aIInference.deleteMany).toHaveBeenCalledWith({
      where: { memoryId: 'mem-fb', provenance: { in: ['llm_extraction', 'llm_user_source_screenshot'] } },
    });
    expect(LLM_INFERENCE_PROVENANCES).toEqual(['llm_extraction', 'llm_user_source_screenshot']);
    expect(tx.memory.update).toHaveBeenCalledWith({
      where: { id: 'mem-fb' },
      data: { processingState: 'partial', ogImageUrl: null },
    });
  });

  it('stale screenshot-derived output is removed when a later run has no usable screenshot', async () => {
    // The screenshot row exists but its bytes cannot be loaded: nothing user-provided reaches the AI.
    prisma.memoryAsset.findMany.mockResolvedValue([SCREENSHOT]);
    fetchUserAsset.mockResolvedValue(null);

    await processor.process(job('mem-fb'));

    expect(provider.understand).not.toHaveBeenCalled();
    expect(tx.aIInference.deleteMany).toHaveBeenCalledWith({
      where: { memoryId: 'mem-fb', provenance: { in: ['llm_extraction', 'llm_user_source_screenshot'] } },
    });
  });

  describe.each([
    ['rejected', FB_REJECTED],
    ['regressed ok (processor backstop)', FB_OK_REGRESSED],
  ])('Facebook metadata %s + source screenshot', (_label, result) => {
    beforeEach(() => {
      urlMetadata.fetchMetadata.mockResolvedValue(result);
      prisma.memoryAsset.findMany.mockResolvedValue([SCREENSHOT]);
    });

    it('AI receives only the labelled user screenshot: no page content and no og:image', async () => {
      await processor.process(job('mem-fb'));

      expect(urlMetadata.fetchImageBytes).not.toHaveBeenCalled();
      expect(provider.understand).toHaveBeenCalledTimes(1);
      const input = provider.understand.mock.calls[0][0];
      expect(input.images).toEqual([
        {
          base64: 'BYTES:memories/mem-fb/SHOTKEY',
          mediaType: 'image/png',
          evidence: { kind: 'user_source_screenshot', assetId: 'asset-shot' },
        },
      ]);
      expect(input.sourceEvidence).toEqual({ textKind: 'memory_text' });
      expect(input.sourceUri).toBe(FB_URL);
      expect(JSON.stringify(input)).not.toMatch(/SENTINELTITLE|SENTINELDESC|SENTINELIMAGE|SENTINELJSONLD|fbcdn/);
      expect(understoodUpdate().data.ogImageUrl).toBeNull();
    });

    it('inferences use llm_user_source_screenshot and reference the actual asset', async () => {
      await processor.process(job('mem-fb'));

      const rows = createdInferences();
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.provenance).toBe('llm_user_source_screenshot');
        expect(row.evidenceRefs).toEqual({
          v: 1,
          assets: [{ id: 'asset-shot', role: 'source_screenshot' }],
          pageMetadata: 'rejected',
        });
      }
    });
  });

  it('mixed ordinary photo + source screenshot keeps each item distinct', async () => {
    prisma.memoryAsset.findMany.mockResolvedValue([PHOTO, SCREENSHOT]);

    await processor.process(job('mem-fb'));

    const input = provider.understand.mock.calls[0][0];
    expect(input.images.map((i: any) => i.evidence)).toEqual([
      { kind: 'user_attachment', assetId: 'asset-photo' },
      { kind: 'user_source_screenshot', assetId: 'asset-shot' },
    ]);
    for (const row of createdInferences()) {
      expect(row.provenance).toBe('llm_user_source_screenshot');
      expect(row.evidenceRefs.assets).toEqual([
        { id: 'asset-photo', role: null },
        { id: 'asset-shot', role: 'source_screenshot' },
      ]);
    }
  });

  it('only assets whose bytes loaded are referenced', async () => {
    prisma.memoryAsset.findMany.mockResolvedValue([PHOTO, SCREENSHOT]);
    fetchUserAsset.mockImplementation(async (key: unknown) =>
      String(key).includes('PHOTOKEY') ? null : { base64: 'SHOT', mediaType: 'image/png' },
    );

    await processor.process(job('mem-fb'));

    expect(createdInferences()[0].evidenceRefs.assets).toEqual([{ id: 'asset-shot', role: 'source_screenshot' }]);
  });

  it('non-Facebook URL with admitted metadata + screenshot: metadata labelled as fetched, no og:image added', async () => {
    const url = 'https://example.com/article';
    prisma.memory.findUnique.mockResolvedValue(urlMemory({ title: url, sourceUri: url }));
    prisma.memoryAsset.findMany.mockResolvedValue([SCREENSHOT]);
    urlMetadata.fetchMetadata.mockResolvedValue({
      status: 'ok',
      metadata: { title: 'Article title', description: 'Article body.', imageUrl: 'https://cdn.example.com/p.jpg' },
      requestedHost: 'example.com',
      finalHost: 'example.com',
      redirectCount: 0,
    });

    await processor.process(job('mem-fb'));

    // Unchanged rule: og:image is only used when there are no user images.
    expect(urlMetadata.fetchImageBytes).not.toHaveBeenCalled();
    const input = provider.understand.mock.calls[0][0];
    expect(input.sourceEvidence).toEqual({ textKind: 'fetched_page_metadata' });
    expect(input.text).toContain('Article body.');
    expect(createdInferences()[0].evidenceRefs).toEqual({
      v: 1,
      assets: [{ id: 'asset-shot', role: 'source_screenshot' }],
      pageMetadata: 'admitted',
    });
  });

  describe('runs without a source screenshot are unchanged', () => {
    const expectLegacyInput = (input: any) => {
      expect(Object.keys(input).sort()).toEqual(['capturedAt', 'images', 'sourceUri', 'text']);
      expect(input.sourceEvidence).toBeUndefined();
      for (const img of input.images ?? []) expect(Object.keys(img).sort()).toEqual(['base64', 'mediaType']);
    };

    it('rejected Facebook + ordinary photo: legacy input and provenance, no evidenceRefs', async () => {
      prisma.memoryAsset.findMany.mockResolvedValue([PHOTO]);

      await processor.process(job('mem-fb'));

      const input = provider.understand.mock.calls[0][0];
      expectLegacyInput(input);
      expect(input.images).toEqual([{ base64: 'BYTES:memories/mem-fb/PHOTOKEY', mediaType: 'image/png' }]);
      for (const row of createdInferences()) {
        expect(row.provenance).toBe('llm_extraction');
        expect(row).not.toHaveProperty('evidenceRefs');
      }
    });

    it('non-Facebook admitted metadata + og:image: legacy input and provenance', async () => {
      const url = 'https://example.com/article';
      prisma.memory.findUnique.mockResolvedValue(urlMemory({ title: url, sourceUri: url }));
      urlMetadata.fetchMetadata.mockResolvedValue({
        status: 'ok',
        metadata: { title: 'Article title', description: 'Article body.', imageUrl: 'https://cdn.example.com/p.jpg' },
        requestedHost: 'example.com',
        finalHost: 'example.com',
        redirectCount: 0,
      });

      await processor.process(job('mem-fb'));

      const input = provider.understand.mock.calls[0][0];
      expectLegacyInput(input);
      expect(input.images).toEqual([{ base64: Buffer.from('page-image').toString('base64'), mediaType: 'image/jpeg' }]);
      for (const row of createdInferences()) {
        expect(row.provenance).toBe('llm_extraction');
        expect(row).not.toHaveProperty('evidenceRefs');
      }
    });

    it('text Memory: legacy text-only input', async () => {
      prisma.memory.findUnique.mockResolvedValue(
        urlMemory({ sourceType: 'text', sourceUri: null, title: 'Buy milk' }),
      );

      await processor.process(job('mem-fb'));

      expect(provider.understand.mock.calls[0][0]).toEqual({
        text: 'Buy milk',
        sourceUri: undefined,
        images: undefined,
        capturedAt: '2026-09-24T10:00:00.000Z',
      });
      expect(urlMetadata.fetchMetadata).not.toHaveBeenCalled();
    });
  });
});
