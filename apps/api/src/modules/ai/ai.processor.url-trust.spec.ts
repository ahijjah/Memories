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

const REJECTED_FROM_EXTERNAL: UrlMetadataResult = {
  status: 'rejected',
  reason: 'FINAL_PATH_INTERSTITIAL',
  requestedHost: 'example.com',
  finalHost: 'www.facebook.com',
  redirectCount: 1,
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
  let tx: any;
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
    [...prisma.memory.update.mock.calls, ...tx.memory.update.mock.calls].filter(
      ([args]: any[]) => args.data?.processingState === state,
    );

  const rawSql = (call: any[]) => (call[0] as TemplateStringsArray).join('?');

  // Asserts the partial transition happened as one interactive transaction: the stale-AI cleanup
  // and the state change all ran on the transaction client, none on the root client, and no new
  // AI output was produced.
  const expectAtomicPartialCleanup = (memoryId: string) => {
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(typeof prisma.$transaction.mock.calls[0][0]).toBe('function');

    expect(tx.aIInference.deleteMany).toHaveBeenCalledTimes(1);
    expect(tx.aIInference.deleteMany).toHaveBeenCalledWith({
      where: { memoryId, provenance: 'llm_extraction' },
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(rawSql(tx.$executeRaw.mock.calls[0])).toBe(
      'DELETE FROM "embeddings" WHERE "memoryId" = ?',
    );
    expect(tx.$executeRaw.mock.calls[0][1]).toBe(memoryId);
    expect(tx.memory.update).toHaveBeenCalledTimes(1);
    expect(tx.memory.update).toHaveBeenCalledWith({
      where: { id: memoryId },
      data: { processingState: 'partial', ogImageUrl: null },
    });

    // Nothing went through the root client, and nothing new was written.
    expect(prisma.aIInference.deleteMany).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    // The only root-client update is the initial 'processing' claim made before the fetch.
    expect(prisma.memory.update.mock.calls.map(([args]: any[]) => args.data)).toEqual([
      { processingState: 'processing' },
    ]);
    expect(prisma.aIInference.create).not.toHaveBeenCalled();
    expect(tx.aIInference.create).not.toHaveBeenCalled();
    expect(embedding.embed).not.toHaveBeenCalled();

    // User data is never touched.
    for (const client of [prisma, tx]) {
      for (const fn of Object.values(client.userConfirmation)) {
        expect(fn).not.toHaveBeenCalled();
      }
      for (const fn of Object.values(client.memoryAsset).filter((f) => f !== prisma.memoryAsset.findMany)) {
        expect(fn).not.toHaveBeenCalled();
      }
    }
    const [[partialUpdate]] = tx.memory.update.mock.calls;
    expect(Object.keys(partialUpdate.data).sort()).toEqual(['ogImageUrl', 'processingState']);
  };

  beforeEach(async () => {
    const userConfirmationMock = () => ({
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    });
    tx = {
      memory: { update: jest.fn().mockResolvedValue({}) },
      aIInference: {
        create: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      memoryAsset: { delete: jest.fn(), deleteMany: jest.fn(), update: jest.fn() },
      userConfirmation: userConfirmationMock(),
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    prisma = {
      memory: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      aIInference: {
        create: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      memoryAsset: {
        findMany: jest.fn().mockResolvedValue([]),
        delete: jest.fn(),
        deleteMany: jest.fn(),
        update: jest.fn(),
      },
      userConfirmation: userConfirmationMock(),
      // Interactive form runs the callback on the separate transaction client; the array form
      // (used by the success path) just resolves.
      $transaction: jest.fn().mockImplementation((arg: unknown) =>
        typeof arg === 'function' ? (arg as (t: unknown) => Promise<unknown>)(tx) : Promise.resolve([]),
      ),
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
      expect(tx.aIInference.create).not.toHaveBeenCalled();
      expect(embedding.embed).not.toHaveBeenCalled();
      const inserts = [...prisma.$executeRaw.mock.calls, ...tx.$executeRaw.mock.calls].filter(
        (call) => /INSERT/i.test(rawSql(call)),
      );
      expect(inserts).toHaveLength(0);
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

    it('atomically removes stale AI inferences and the embedding with the partial transition', async () => {
      await processor.process(job('mem-fb'));
      expectAtomicPartialCleanup('mem-fb');
    });
  });

  it('partial cleanup failure propagates (no partial state without cleanup)', async () => {
    prisma.memory.findUnique.mockResolvedValue(urlMemory());
    urlMetadata.fetchMetadata.mockResolvedValue(REJECTED);
    tx.$executeRaw.mockRejectedValueOnce(new Error('db down'));

    await expect(processor.process(job('mem-fb'))).rejects.toThrow('db down');
    // The update never ran on either client: the transaction aborted before the state change.
    expect(tx.memory.update).not.toHaveBeenCalled();
    expect(prisma.memory.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ processingState: 'partial' }) }),
    );
  });

  it('A: non-Facebook source redirected to a rejected Facebook interstitial is a partial link', async () => {
    const source = 'https://example.com/go/SENTINELPATH?q=SENTINELQUERY';
    prisma.memory.findUnique.mockResolvedValue(
      urlMemory({ title: source, sourceUri: source, ogImageUrl: PAGE_IMAGE_URL }),
    );
    urlMetadata.fetchMetadata.mockResolvedValue(REJECTED_FROM_EXTERNAL);

    await expect(processor.process(job('mem-fb'))).resolves.toBeUndefined();

    // The raw URL never reaches understand(), and no page Vision happens.
    expect(provider.understand).not.toHaveBeenCalled();
    expect(urlMetadata.fetchImageBytes).not.toHaveBeenCalled();
    // Stale ogImageUrl is cleared and stale AI output removed in the same transaction.
    expectAtomicPartialCleanup('mem-fb');
    expect(updateCallsWith('understood')).toHaveLength(0);
  });

  it('B: scheme-less www.facebook.com source with unavailable metadata is a partial link', async () => {
    const source = 'www.facebook.com/share/p/SENTINELPATH/';
    prisma.memory.findUnique.mockResolvedValue(urlMemory({ title: source, sourceUri: source }));
    urlMetadata.fetchMetadata.mockResolvedValue({
      status: 'unavailable',
      reason: 'INVALID_URL',
      requestedHost: '(invalid-url)',
    });

    await processor.process(job('mem-fb'));

    expect(provider.understand).not.toHaveBeenCalled();
    expectAtomicPartialCleanup('mem-fb');
  });

  it('C: deceptive www.facebook.com.example.com source is not Facebook-family (raw fallback kept)', async () => {
    const source = 'https://www.facebook.com.example.com/share/p/abc/';
    prisma.memory.findUnique.mockResolvedValue(urlMemory({ title: source, sourceUri: source }));
    urlMetadata.fetchMetadata.mockResolvedValue({
      status: 'unavailable',
      reason: 'FETCH_FAILED',
      requestedHost: 'www.facebook.com.example.com',
    });

    await processor.process(job('mem-fb'));

    expect(provider.understand).toHaveBeenCalledTimes(1);
    expect(updateCallsWith('partial')).toHaveLength(0);
    expect(tx.aIInference.deleteMany).not.toHaveBeenCalled();
    expect(updateCallsWith('understood')).toHaveLength(1);
  });

  describe('processor backstop: a (regressed) `ok` result is never used when Facebook is involved', () => {
    const OK_PAGE = {
      title: 'SENTINELTITLE An article',
      description: 'SENTINELDESC Article body summary.',
      imageUrl: 'https://cdn.example.com/SENTINELIMAGE.jpg',
      author: 'SENTINELJSONLD author',
    };

    it.each([
      ['a) Facebook source, non-Facebook final', FB_URL, 'www.facebook.com', 'example.com'],
      ['a) l.facebook.com source, non-Facebook final', 'https://l.facebook.com/l.php?u=SENTINELPATH', 'l.facebook.com', 'example.com'],
      ['b) non-Facebook source, Facebook final', 'https://example.com/go/SENTINELPATH', 'example.com', 'www.facebook.com'],
    ])('%s: denied, partial, no og:image fetch and no understand', async (_label, source, requestedHost, finalHost) => {
      prisma.memory.findUnique.mockResolvedValue(urlMemory({ title: source, sourceUri: source }));
      urlMetadata.fetchMetadata.mockResolvedValue({
        status: 'ok',
        metadata: OK_PAGE,
        requestedHost,
        finalHost,
        redirectCount: 1,
      });

      await expect(processor.process(job('mem-fb'))).resolves.toBeUndefined();

      expect(urlMetadata.fetchImageBytes).not.toHaveBeenCalled();
      expect(provider.understand).not.toHaveBeenCalled();
      expectAtomicPartialCleanup('mem-fb');
      expect(updateCallsWith('understood')).toHaveLength(0);
    });

    it('with a user asset: only the user asset and the Memory title reach understand', async () => {
      prisma.memory.findUnique.mockResolvedValue(urlMemory());
      prisma.memoryAsset.findMany.mockResolvedValue([
        { id: 'asset-1', memoryId: 'mem-fb', objectKey: 'user-1/uploads/photo.png', mimeType: 'image/png', pageIndex: 0 },
      ]);
      urlMetadata.fetchMetadata.mockResolvedValue({
        status: 'ok',
        metadata: OK_PAGE,
        requestedHost: 'www.facebook.com',
        finalHost: 'www.facebook.com',
        redirectCount: 1,
      });

      await processor.process(job('mem-fb'));

      expect(urlMetadata.fetchImageBytes).not.toHaveBeenCalled();
      expect(provider.understand).toHaveBeenCalledTimes(1);
      const input = provider.understand.mock.calls[0][0];
      expect(input.text).toBe(FB_URL); // memory.title ?? memory.sourceUri
      expect(input.images).toEqual([{ base64: 'USER-UPLOADED-BYTES', mediaType: 'image/png' }]);
      expect(JSON.stringify(input)).not.toMatch(/SENTINELTITLE|SENTINELDESC|SENTINELIMAGE|SENTINELJSONLD/);
      expect(updateCallsWith('understood')[0][0].data.ogImageUrl).toBeNull();
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

  it('trusted non-Facebook metadata: normal processing with page metadata and og:image vision (unchanged)', async () => {
    prisma.memory.findUnique.mockResolvedValue(
      urlMemory({ title: 'https://example.com/article', sourceUri: 'https://example.com/article' }),
    );
    urlMetadata.fetchMetadata.mockResolvedValue({
      status: 'ok',
      metadata: {
        title: 'Sunset at the beach',
        description: 'Golden hour at the pier with friends.',
        imageUrl: 'https://cdn.example.com/photo.jpg',
      },
      requestedHost: 'example.com',
      finalHost: 'example.com',
      redirectCount: 0,
    });

    await processor.process(job('mem-fb'));

    expect(urlMetadata.fetchImageBytes).toHaveBeenCalledWith('https://cdn.example.com/photo.jpg');
    const input = provider.understand.mock.calls[0][0];
    expect(input.text).toContain('Golden hour at the pier with friends.');
    expect(input.images).toEqual([
      { base64: Buffer.from('page-image').toString('base64'), mediaType: 'image/jpeg' },
    ]);
    const understood = updateCallsWith('understood');
    expect(understood[0][0].data.ogImageUrl).toBe('https://cdn.example.com/photo.jpg');
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

  describe('production shape end-to-end with the real UrlMetadataService', () => {
    // Real metadata service (fetch stubbed): share wrapper -> one redirect -> Facebook page landing
    // with a 68-char non-generic title, specific description and an og:image. No user assets.
    let realService: UrlMetadataService;
    let fetchSpy: jest.SpyInstance;
    let imageFetch: jest.SpyInstance;

    const html = (head: string) => `<html><head>${head}</head><body></body></html>`;
    const TITLE = 'SENTINELTITLE Example Networks - Fast home internet in your area'.padEnd(68, '.');

    beforeEach(async () => {
      realService = new UrlMetadataService();
      jest.spyOn(realService as any, 'isValidHostname').mockResolvedValue(true);
      imageFetch = jest.spyOn(realService, 'fetchImageBytes');
      // Any request not explicitly stubbed (e.g. an og:image download) fails loudly.
      fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('unexpected network request'));

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AiProcessor,
          { provide: PrismaService, useValue: prisma },
          { provide: EmbeddingService, useValue: embedding },
          { provide: UrlMetadataService, useValue: realService },
          { provide: ConfigService, useValue: { getOrThrow: jest.fn().mockReturnValue(Buffer.from('a'.repeat(32)).toString('base64')) } },
          { provide: FieldEncryptionService, useValue: { encrypt: jest.fn((v) => v), decrypt: jest.fn((v) => v) } },
          { provide: ObjectStorageSseService, useValue: { getSseParams: jest.fn().mockReturnValue({}) } },
        ],
      }).compile();
      processor = module.get(AiProcessor);
      prisma.memory.findUnique.mockResolvedValue(urlMemory());
    });

    const landingPage = (declared: string) =>
      new Response(
        html(
          `<meta property="og:title" content="${TITLE}">` +
            '<meta property="og:description" content="SENTINELDESC Internet service provider. 12,345 likes.">' +
            declared +
            '<meta property="og:image" content="https://scontent.xx.fbcdn.net/v/SENTINELIMAGE.jpg">',
        ),
        { status: 200, headers: { 'content-type': 'text/html' } },
      );
    const redirectTo = (location: string) => new Response(null, { status: 302, headers: { location } });

    it.each([
      ['page landing, og:url page', 'https://www.facebook.com/SENTINELPAGE/', '<meta property="og:url" content="https://www.facebook.com/SENTINELPAGE/">'],
      ['page landing, no declared URLs', 'https://www.facebook.com/SENTINELPAGE/', ''],
      ['wrapper with self-canonical', 'https://www.facebook.com/share/p/SENTINELPATH/?_rdr', '<link rel="canonical" href="https://www.facebook.com/share/p/SENTINELPATH/">'],
      ['wrapper with og:url item only', 'https://www.facebook.com/share/p/SENTINELPATH/?_rdr', '<meta property="og:url" content="https://www.facebook.com/x/posts/123">'],
    ])('%s: never reaches Vision or understand; saved as partial on the first attempt', async (_label, location, declared) => {
      fetchSpy.mockResolvedValueOnce(redirectTo(location)).mockResolvedValueOnce(landingPage(declared));

      await expect(processor.process(job('mem-fb'))).resolves.toBeUndefined();

      expect(fetchSpy).toHaveBeenCalledTimes(2); // share URL + one redirect; no og:image request
      expect(imageFetch).not.toHaveBeenCalled();
      expect(provider.understand).not.toHaveBeenCalled();
      expect(embedding.embed).not.toHaveBeenCalled();
      expectAtomicPartialCleanup('mem-fb');
      expect(updateCallsWith('failed')).toHaveLength(0);
    });

    // Production P3: final + canonical + og:url all ITEM, no markers, specific title/description,
    // og:image present. Deny-by-default must stop this before any og:image request.
    const ITEM = 'https://www.facebook.com/SENTINELNAME/posts/987654321';
    const itemPage = (title: string, withImage = true) =>
      new Response(
        html(
          `<meta property="og:title" content="${title}">` +
            '<meta property="og:description" content="SENTINELDESC Fibre internet plans with free installation this month.">' +
            `<link rel="canonical" href="${ITEM}">` +
            `<meta property="og:url" content="${ITEM}">` +
            '<script type="application/ld+json">{"@type":"Article","author":"SENTINELJSONLD"}</script>' +
            (withImage ? '<meta property="og:image" content="https://scontent.xx.fbcdn.net/v/SENTINELIMAGE.jpg">' : ''),
        ),
        { status: 200, headers: { 'content-type': 'text/html' } },
      );
    const TITLE_52 = 'SENTINELTITLE Example Networks fibre offer'.padEnd(52, '.');
    const TITLE_68 = 'SENTINELTITLE Example Networks - Fast home internet in your area'.padEnd(68, '.');

    it.each([
      ['52-char title', TITLE_52],
      ['68-char title', TITLE_68],
    ])('P3 (%s): all-ITEM page is denied - no og:image request, no Vision, no understand, no embedding, partial', async (_label, title) => {
      expect(title.length === 52 || title.length === 68).toBe(true);
      const debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
      fetchSpy.mockResolvedValueOnce(redirectTo(ITEM)).mockResolvedValueOnce(itemPage(title));

      await expect(processor.process(job('mem-fb'))).resolves.toBeUndefined();

      expect(fetchSpy).toHaveBeenCalledTimes(2); // share URL + one redirect only
      expect(imageFetch).not.toHaveBeenCalled();
      expect(provider.understand).not.toHaveBeenCalled();
      expect(embedding.embed).not.toHaveBeenCalled();
      expectAtomicPartialCleanup('mem-fb');
      expect(updateCallsWith('failed')).toHaveLength(0);
      expect(debug).toHaveBeenCalledWith(
        'metadata fetch host=www.facebook.com final_host=www.facebook.com redirects=1 result=rejected reason=FACEBOOK_DENY_BY_DEFAULT ' +
          'fb_final=ITEM fb_canonical=ITEM fb_og=ITEM markers=none title_generic=false desc_generic=false ' +
          // The /share/ source names no item, so a self-consistent final/canonical/og is only PARTIAL.
          'fb_id_src=wrapper fb_id_final=item fb_id_canon=item fb_id_og=item fb_kind_src=na fb_kind_final=post fb_kind_canon=post fb_kind_og=post fb_idform_src=na fb_idform_final=numeric fb_idform_canon=numeric fb_idform_og=numeric fb_m_src_final=na fb_m_src_canon=na fb_m_final_canon=eq fb_m_final_og=eq fb_m_canon_og=eq fb_corr=PARTIAL',
      );
    });

    // PR-FB-A: correspondence diagnostics are log-only. Even the strongest possible identity
    // correspondence (the shared URL itself names the item, and final = canonical = og:url)
    // must not change processing.
    it('STRONG direct-item Facebook source is still denied: partial, no og:image, no Vision, no understand', async () => {
      const debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
      prisma.memory.findUnique.mockResolvedValue(urlMemory({ title: ITEM, sourceUri: ITEM }));
      fetchSpy.mockResolvedValueOnce(itemPage(TITLE_68));

      await expect(processor.process(job('mem-fb'))).resolves.toBeUndefined();

      expect(fetchSpy).toHaveBeenCalledTimes(1); // the page only; no og:image request
      expect(imageFetch).not.toHaveBeenCalled();
      expect(provider.understand).not.toHaveBeenCalled();
      expect(embedding.embed).not.toHaveBeenCalled();
      expectAtomicPartialCleanup('mem-fb');
      expect(updateCallsWith('understood')).toHaveLength(0);
      const fetchLine = debug.mock.calls.map((call) => String(call[0])).find((line) => line.startsWith('metadata fetch'));
      expect(fetchLine).toContain('reason=FACEBOOK_DENY_BY_DEFAULT');
      expect(fetchLine).toContain('fb_corr=STRONG');
    });

    it('STRONG direct-item Facebook source + user asset: only the user asset reaches understand', async () => {
      prisma.memory.findUnique.mockResolvedValue(urlMemory({ title: ITEM, sourceUri: ITEM }));
      prisma.memoryAsset.findMany.mockResolvedValue([
        { id: 'asset-1', memoryId: 'mem-fb', objectKey: 'user-1/uploads/photo.png', mimeType: 'image/png', pageIndex: 0 },
      ]);
      jest
        .spyOn(processor as any, 'fetchImageAsBase64')
        .mockResolvedValue({ base64: 'USER-UPLOADED-BYTES', mediaType: 'image/png' });
      fetchSpy.mockResolvedValueOnce(itemPage(TITLE_68));

      await processor.process(job('mem-fb'));

      expect(imageFetch).not.toHaveBeenCalled();
      expect(provider.understand).toHaveBeenCalledTimes(1);
      const input = provider.understand.mock.calls[0][0];
      expect(input.images).toEqual([{ base64: 'USER-UPLOADED-BYTES', mediaType: 'image/png' }]);
      expect(JSON.stringify(input)).not.toMatch(/SENTINELTITLE|SENTINELDESC|SENTINELIMAGE|SENTINELJSONLD/);
      expect(updateCallsWith('understood')[0][0].data.ogImageUrl).toBeNull();
    });

    it('Facebook ITEM page without og:image is denied (partial, no understand)', async () => {
      fetchSpy.mockResolvedValueOnce(redirectTo(ITEM)).mockResolvedValueOnce(itemPage(TITLE_68, false));

      await processor.process(job('mem-fb'));

      expect(provider.understand).not.toHaveBeenCalled();
      expectAtomicPartialCleanup('mem-fb');
    });

    it.each([
      ['fb.me source -> Facebook ITEM', 'https://fb.me/SENTINELPATH'],
      ['fb.watch source -> Facebook ITEM', 'https://fb.watch/SENTINELPATH/'],
      ['non-Facebook source -> Facebook ITEM', 'https://example.com/go/SENTINELPATH'],
    ])('%s: denied', async (_label, source) => {
      prisma.memory.findUnique.mockResolvedValue(urlMemory({ title: source, sourceUri: source }));
      fetchSpy.mockResolvedValueOnce(redirectTo(ITEM)).mockResolvedValueOnce(itemPage(TITLE_68));

      await processor.process(job('mem-fb'));

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(imageFetch).not.toHaveBeenCalled();
      expect(provider.understand).not.toHaveBeenCalled();
      expectAtomicPartialCleanup('mem-fb');
    });

    it('Facebook source -> non-Facebook final page is denied (locked policy)', async () => {
      fetchSpy
        .mockResolvedValueOnce(redirectTo('https://example.com/article/SENTINELPATH'))
        .mockResolvedValueOnce(
          new Response(
            html(
              '<meta property="og:title" content="SENTINELTITLE External article">' +
                '<meta property="og:description" content="SENTINELDESC Article summary.">' +
                '<meta property="og:image" content="https://cdn.example.com/SENTINELIMAGE.jpg">',
            ),
            { status: 200, headers: { 'content-type': 'text/html' } },
          ),
        );

      await processor.process(job('mem-fb'));

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(imageFetch).not.toHaveBeenCalled();
      expect(provider.understand).not.toHaveBeenCalled();
      expectAtomicPartialCleanup('mem-fb');
    });

    it('Facebook source + user asset: only the user asset and Memory title reach understand', async () => {
      prisma.memoryAsset.findMany.mockResolvedValue([
        { id: 'asset-1', memoryId: 'mem-fb', objectKey: 'user-1/uploads/photo.png', mimeType: 'image/png', pageIndex: 0 },
      ]);
      jest
        .spyOn(processor as any, 'fetchImageAsBase64')
        .mockResolvedValue({ base64: 'USER-UPLOADED-BYTES', mediaType: 'image/png' });
      fetchSpy.mockResolvedValueOnce(redirectTo(ITEM)).mockResolvedValueOnce(itemPage(TITLE_68));

      await processor.process(job('mem-fb'));

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(imageFetch).not.toHaveBeenCalled();
      expect(provider.understand).toHaveBeenCalledTimes(1);
      const input = provider.understand.mock.calls[0][0];
      expect(input.text).toBe(FB_URL); // memory.title ?? memory.sourceUri
      expect(input.sourceUri).toBe(FB_URL);
      expect(input.images).toEqual([{ base64: 'USER-UPLOADED-BYTES', mediaType: 'image/png' }]);
      expect(JSON.stringify(input)).not.toMatch(/SENTINELTITLE|SENTINELDESC|SENTINELIMAGE|SENTINELJSONLD/);
      const understood = updateCallsWith('understood');
      expect(understood).toHaveLength(1);
      expect(understood[0][0].data.ogImageUrl).toBeNull();
      expect(updateCallsWith('partial')).toHaveLength(0);
    });

    it('non-Facebook source -> non-Facebook final is unchanged: page metadata and og:image Vision', async () => {
      prisma.memory.findUnique.mockResolvedValue(
        urlMemory({ title: 'https://example.com/article', sourceUri: 'https://example.com/article' }),
      );
      fetchSpy
        .mockResolvedValueOnce(
          new Response(
            html(
              '<meta property="og:title" content="Sunset at the beach">' +
                '<meta property="og:description" content="Golden hour at the pier.">' +
                '<meta property="og:image" content="https://cdn.example.com/photo.jpg">',
            ),
            { status: 200, headers: { 'content-type': 'text/html' } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(Buffer.from('img'), { status: 200, headers: { 'content-type': 'image/jpeg' } }),
        );

      await processor.process(job('mem-fb'));

      expect(imageFetch).toHaveBeenCalledWith('https://cdn.example.com/photo.jpg');
      expect(provider.understand).toHaveBeenCalledTimes(1);
      const input = provider.understand.mock.calls[0][0];
      expect(input.text).toContain('Golden hour at the pier.');
      expect(input.images).toHaveLength(1);
      expect(updateCallsWith('understood')[0][0].data.ogImageUrl).toBe('https://cdn.example.com/photo.jpg');
      expect(updateCallsWith('partial')).toHaveLength(0);
    });
  });
});
