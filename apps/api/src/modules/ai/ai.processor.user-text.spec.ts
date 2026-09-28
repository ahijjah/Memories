import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiProcessor } from './ai.processor';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmbeddingService } from './embedding.service';
import { UrlMetadataService } from './url-metadata.service';
import { FieldEncryptionService } from '../../common/crypto/field-encryption.service';
import { ObjectStorageSseService } from '../../common/crypto/object-storage-sse.service';
import type { Job } from 'bullmq';

jest.mock('@memory-app/ai', () => ({
  AnthropicAiProvider: jest.fn(),
}));

import { AnthropicAiProvider } from '@memory-app/ai';

// LOSSLESS-CAPTURE-01: what the AI receives for Memories with saved full text.
describe('AiProcessor - saved full text', () => {
  const FB_URL = 'https://www.facebook.com/share/p/SENTINELPATH/';
  const URL = 'https://example.com/post';
  const SHARED = 'Look at this https://example.com/post\nMeet there Friday 6pm';

  let processor: AiProcessor;
  let prisma: any;
  let provider: { understand: jest.Mock };
  let urlMetadata: { fetchMetadata: jest.Mock; fetchImageBytes: jest.Mock };
  const job = { data: { memoryId: 'mem-1' } } as Partial<Job> as Job;

  const memoryRow = (overrides: Record<string, unknown>) => ({
    id: 'mem-1',
    userId: 'user-1',
    title: 'Short title',
    sourceType: 'text',
    sourceUri: null,
    capturedAt: new Date('2026-09-28T10:00:00Z'),
    processingState: 'queued',
    securityScope: 'private',
    content: null,
    ...overrides,
  });
  const input = () => provider.understand.mock.calls[0][0];

  beforeEach(async () => {
    const tx = {
      aIInference: { deleteMany: jest.fn() },
      $executeRaw: jest.fn().mockResolvedValue(1),
      memory: { update: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      memory: { findUnique: jest.fn(), update: jest.fn((args) => ({ op: 'memoryUpdate', args })) },
      aIInference: {
        create: jest.fn((args) => ({ op: 'create', args })),
        deleteMany: jest.fn((args) => ({ op: 'deleteMany', args })),
      },
      memoryAsset: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (arg: any) => (typeof arg === 'function' ? arg(tx) : [])),
      $executeRaw: jest.fn().mockResolvedValue(null),
      tx,
    };
    urlMetadata = {
      fetchMetadata: jest.fn().mockResolvedValue({ status: 'unavailable', reason: 'FETCH_FAILED', requestedHost: 'example.com' }),
      fetchImageBytes: jest.fn(),
    };
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiProcessor,
        { provide: PrismaService, useValue: prisma },
        { provide: EmbeddingService, useValue: { embed: jest.fn().mockResolvedValue(new Array(1024).fill(0)), getModel: () => 'v' } },
        { provide: UrlMetadataService, useValue: urlMetadata },
        { provide: ConfigService, useValue: { getOrThrow: (k: string) => (k === 'OBJECT_STORAGE_SSE_C_KEY' ? Buffer.from('a'.repeat(32)).toString('base64') : 'x') } },
        { provide: FieldEncryptionService, useValue: { encrypt: jest.fn((v) => v), decrypt: jest.fn((v) => v) } },
        { provide: ObjectStorageSseService, useValue: { getSseParams: jest.fn().mockReturnValue({}) } },
      ],
    }).compile();
    processor = module.get(AiProcessor);

    provider = {
      understand: jest.fn().mockResolvedValue({ title: 'T', summary: 'S', type: 'GENERIC', topics: [], confidence: 0.7, modelVersion: 'm' }),
    };
    (AnthropicAiProvider as jest.Mock).mockImplementation(() => provider);
  });

  it('loads the saved text with the Memory', async () => {
    prisma.memory.findUnique.mockResolvedValue(memoryRow({}));

    await processor.process(job);

    expect(prisma.memory.findUnique).toHaveBeenCalledWith({ where: { id: 'mem-1' }, include: { content: true } });
  });

  it('text Memory: the AI receives the full saved text, not the short title', async () => {
    const full = `${'word '.repeat(3999)}end`; // ~20,000 characters
    prisma.memory.findUnique.mockResolvedValue(memoryRow({ content: { text: full } }));

    await processor.process(job);

    expect(input().text).toBe(full);
    expect(input().userText).toBeUndefined();
    expect(input().sourceEvidence).toBeUndefined();
  });

  it('legacy text Memory without saved text: the title, as before', async () => {
    prisma.memory.findUnique.mockResolvedValue(memoryRow({}));

    await processor.process(job);

    expect(input()).toEqual({ text: 'Short title', sourceUri: undefined, images: undefined, capturedAt: '2026-09-28T10:00:00.000Z' });
  });

  it('URL Memory with shared text and admitted metadata: page metadata and user text are passed separately', async () => {
    prisma.memory.findUnique.mockResolvedValue(
      memoryRow({ sourceType: 'url', sourceUri: URL, title: 'Look at this', content: { text: SHARED } }),
    );
    urlMetadata.fetchMetadata.mockResolvedValue({
      status: 'ok',
      metadata: { title: 'Page title', description: 'Page description' },
      requestedHost: 'example.com',
      finalHost: 'example.com',
      redirectCount: 0,
    });

    await processor.process(job);

    expect(urlMetadata.fetchMetadata).toHaveBeenCalledWith(URL);
    expect(input()).toMatchObject({
      text: 'Page title\n\nPage description',
      sourceUri: URL,
      userText: SHARED,
      sourceEvidence: { textKind: 'fetched_page_metadata' },
    });
  });

  it('URL Memory with shared text, page unavailable: the link stands in for the text, user text labelled separately', async () => {
    prisma.memory.findUnique.mockResolvedValue(
      memoryRow({ sourceType: 'url', sourceUri: URL, title: 'Look at this', content: { text: SHARED } }),
    );

    await processor.process(job);

    expect(input()).toMatchObject({ text: URL, userText: SHARED, sourceEvidence: { textKind: 'memory_text' } });
  });

  it('bare URL Memory (no saved text): request unchanged, no user text or labelling', async () => {
    prisma.memory.findUnique.mockResolvedValue(memoryRow({ sourceType: 'url', sourceUri: URL, title: URL }));

    await processor.process(job);

    expect(input()).toEqual({ text: URL, sourceUri: URL, images: undefined, capturedAt: '2026-09-28T10:00:00.000Z' });
  });

  it('a run with user text keeps the ordinary provenance', async () => {
    prisma.memory.findUnique.mockResolvedValue(
      memoryRow({ sourceType: 'url', sourceUri: URL, title: 'Look at this', content: { text: SHARED } }),
    );

    await processor.process(job);

    const provenances = prisma.aIInference.create.mock.calls.map(([args]: any[]) => args.data.provenance);
    expect(provenances.length).toBeGreaterThan(0);
    expect(new Set(provenances)).toEqual(new Set(['llm_extraction']));
  });

  it('Facebook link with shared text but no admitted metadata and no user image stays partial: no AI call', async () => {
    prisma.memory.findUnique.mockResolvedValue(
      memoryRow({ sourceType: 'url', sourceUri: FB_URL, title: 'Wedding Friday', content: { text: `Wedding Friday ${FB_URL}` } }),
    );
    urlMetadata.fetchMetadata.mockResolvedValue({
      status: 'rejected',
      reason: 'PROFILE_OR_PAGE_LANDING',
      requestedHost: 'www.facebook.com',
      finalHost: 'www.facebook.com',
      redirectCount: 1,
    });

    await processor.process(job);

    expect(provider.understand).not.toHaveBeenCalled();
    expect(prisma.tx.memory.update).toHaveBeenCalledWith({
      where: { id: 'mem-1' },
      data: { processingState: 'partial', ogImageUrl: null },
    });
  });

  it('Facebook link: even an `ok` result is never admitted because of user text', async () => {
    prisma.memory.findUnique.mockResolvedValue(
      memoryRow({ sourceType: 'url', sourceUri: FB_URL, title: 'x', content: { text: `x ${FB_URL}` } }),
    );
    urlMetadata.fetchMetadata.mockResolvedValue({
      status: 'ok',
      metadata: { title: 'Facebook page' },
      requestedHost: 'www.facebook.com',
      finalHost: 'www.facebook.com',
      redirectCount: 0,
    });

    await processor.process(job);

    expect(provider.understand).not.toHaveBeenCalled();
  });
});
