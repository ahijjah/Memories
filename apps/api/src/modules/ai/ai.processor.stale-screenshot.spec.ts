import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import { AiProcessor } from './ai.processor';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmbeddingService } from './embedding.service';
import { UrlMetadataService } from './url-metadata.service';
import { FieldEncryptionService } from '../../common/crypto/field-encryption.service';
import { ObjectStorageSseService } from '../../common/crypto/object-storage-sse.service';
import { LATEST_AI_INFERENCE_ORDER, resolveMemoryField } from '../../common/resolve-memory-field.util';
import type { Job } from 'bullmq';

jest.mock('@memory-app/ai', () => ({
  AnthropicAiProvider: jest.fn(),
}));

import { AnthropicAiProvider } from '@memory-app/ai';

// PR29 review finding B1: inferences are appended and each field resolves to its newest present
// value. A successful run in which no source screenshot reached the model must not leave fields
// from an earlier screenshot run visible.
//
// The ai_inferences table is simulated in memory: create/deleteMany return operation descriptors
// and $transaction applies a batch in order, as Prisma's array transaction does.
type Row = {
  id: string;
  memoryId: string;
  field: string;
  valueJson: unknown;
  confidence: number;
  provenance: string | null;
  evidenceRefs?: unknown;
  modelVersion: string;
  createdAt: Date;
};

const FB_URL = 'https://www.facebook.com/share/p/SENTINELPATH/';
const SCREENSHOT = { id: 'asset-shot', memoryId: 'mem-1', objectKey: 'memories/mem-1/SHOT', mimeType: 'image/png', pageIndex: null, evidenceRole: 'source_screenshot' };
const PHOTO = { id: 'asset-photo', memoryId: 'mem-1', objectKey: 'memories/mem-1/PHOTO', mimeType: 'image/jpeg', pageIndex: null, evidenceRole: null };

describe('AiProcessor - stale screenshot-derived inferences (B1)', () => {
  let processor: AiProcessor;
  let rows: Row[];
  let clock: number;
  let prisma: any;
  let provider: { understand: jest.Mock };
  let urlMetadata: { fetchMetadata: jest.Mock; fetchImageBytes: jest.Mock };
  let fetchUserAsset: jest.SpyInstance;

  const job = { data: { memoryId: 'mem-1' } } as Partial<Job> as Job;

  const seedScreenshotRun = () => {
    const refs = { v: 1, assets: [{ id: 'asset-shot', role: 'source_screenshot' }], pageMetadata: 'rejected' };
    for (const [field, value] of [
      ['title', 'Screenshot title'],
      ['summary', 'Screenshot summary'],
      ['date', '2026-10-02'],
      ['location', 'Screenshot Hall'],
    ] as const) {
      rows.push({
        id: `old-${field}`,
        memoryId: 'mem-1',
        field,
        valueJson: value,
        confidence: 0.8,
        provenance: 'llm_user_source_screenshot',
        evidenceRefs: refs,
        modelVersion: 'old',
        createdAt: new Date(Date.UTC(2026, 8, 1, 0, 0, clock++)),
      });
    }
  };

  // Resolve a field the way the read paths do (newest first, then the shared resolver).
  const resolved = (field: string) => {
    const ordered = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    expect(LATEST_AI_INFERENCE_ORDER[0]).toEqual({ createdAt: 'desc' });
    return resolveMemoryField(field, { aiInferences: ordered });
  };

  beforeEach(async () => {
    rows = [];
    clock = 0;
    const apply = (op: any) => {
      if (op.op === 'create') {
        rows.push({ id: `new-${rows.length}`, createdAt: new Date(Date.UTC(2026, 8, 2, 0, 0, clock++)), ...op.args.data });
      } else if (op.op === 'deleteMany') {
        const { memoryId, provenance } = op.args.where;
        const match = (r: Row) =>
          r.memoryId === memoryId &&
          (typeof provenance === 'string' ? r.provenance === provenance : provenance.in.includes(r.provenance));
        rows = rows.filter((r) => !match(r));
      }
    };
    const tx = {
      aIInference: { deleteMany: jest.fn((args) => apply({ op: 'deleteMany', args })) },
      $executeRaw: jest.fn().mockResolvedValue(1),
      memory: { update: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      memory: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'mem-1', userId: 'user-1', title: FB_URL, sourceType: 'url', sourceUri: FB_URL,
          capturedAt: new Date('2026-09-24T10:00:00Z'), processingState: 'queued', securityScope: 'private',
        }),
        update: jest.fn((args) => ({ op: 'memoryUpdate', args })),
      },
      aIInference: {
        create: jest.fn((args) => ({ op: 'create', args })),
        deleteMany: jest.fn((args) => ({ op: 'deleteMany', args })),
      },
      memoryAsset: { findMany: jest.fn().mockResolvedValue([PHOTO, SCREENSHOT]) },
      $transaction: jest.fn(async (arg: any) => {
        if (typeof arg === 'function') return arg(tx);
        arg.forEach(apply); // batch: applied in array order, all together
        return [];
      }),
      $executeRaw: jest.fn().mockResolvedValue(null),
    };
    urlMetadata = {
      fetchMetadata: jest.fn().mockResolvedValue({
        status: 'rejected', reason: 'PROFILE_OR_PAGE_LANDING', requestedHost: 'www.facebook.com', finalHost: 'www.facebook.com', redirectCount: 1,
      }),
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

    // The current AI response omits date and location.
    provider = {
      understand: jest.fn().mockResolvedValue({
        title: 'Photo title', summary: 'Photo summary', type: 'GENERIC', topics: [], confidence: 0.7, modelVersion: 'new',
      }),
    };
    (AnthropicAiProvider as jest.Mock).mockImplementation(() => provider);

    // B1 scenario: the ordinary photo loads, the screenshot does not.
    fetchUserAsset = jest
      .spyOn(processor as any, 'fetchImageAsBase64')
      .mockImplementation(async (key: unknown) =>
        String(key).endsWith('PHOTO') ? { base64: 'PHOTO', mediaType: 'image/jpeg' } : null,
      );
    seedScreenshotRun();
  });

  afterEach(() => jest.restoreAllMocks());

  it('a successful run without the screenshot leaves no screenshot-derived field resolvable', async () => {
    expect(resolved('date').value).toBe('2026-10-02'); // precondition: stale field present

    await processor.process(job);

    // Only the photo reached the model; the run is ordinary.
    expect(provider.understand.mock.calls[0][0].images).toEqual([{ base64: 'PHOTO', mediaType: 'image/jpeg' }]);
    expect(rows.some((r) => r.provenance === 'llm_user_source_screenshot')).toBe(false);
    // Omitted fields no longer resolve to the old screenshot values.
    expect(resolved('date')).toEqual({ value: null, source: 'none' });
    expect(resolved('location')).toEqual({ value: null, source: 'none' });
    expect(resolved('title')).toMatchObject({ value: 'Photo title', provenance: 'llm_extraction' });
  });

  it('the cleanup is part of the same batch transaction, before the new rows', async () => {
    await processor.process(job);

    const batches = prisma.$transaction.mock.calls.filter(([arg]: any[]) => Array.isArray(arg));
    expect(batches).toHaveLength(1);
    const [batch] = batches[0];
    expect(batch[0]).toEqual({
      op: 'deleteMany',
      args: { where: { memoryId: 'mem-1', provenance: 'llm_user_source_screenshot' } },
    });
    expect(batch.slice(1).some((op: any) => op.op === 'deleteMany')).toBe(false);
    // Only screenshot-derived rows are targeted: never llm_extraction, OCR or confirmations.
    expect(prisma.aIInference.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('a run that used the screenshot does not delete its own provenance', async () => {
    fetchUserAsset.mockImplementation(async () => ({ base64: 'IMG', mediaType: 'image/png' }));

    await processor.process(job);

    expect(prisma.aIInference.deleteMany).not.toHaveBeenCalled();
    // Old and new screenshot rows both remain; the newest wins per field.
    expect(resolved('title')).toMatchObject({ value: 'Photo title', provenance: 'llm_user_source_screenshot' });
    expect(resolved('date')).toMatchObject({ value: '2026-10-02', provenance: 'llm_user_source_screenshot' });
  });

  it('an AI failure erases nothing', async () => {
    provider.understand.mockRejectedValue(new Error('provider down'));

    await expect(processor.process(job)).rejects.toThrow('provider down');

    expect(prisma.aIInference.deleteMany).not.toHaveBeenCalled();
    expect(rows).toHaveLength(4);
    expect(resolved('date').value).toBe('2026-10-02');
  });

  it('a Memory without any source screenshot asset runs no extra cleanup query (legacy unchanged)', async () => {
    prisma.memoryAsset.findMany.mockResolvedValue([PHOTO]);
    rows = [];

    await processor.process(job);

    expect(prisma.aIInference.deleteMany).not.toHaveBeenCalled();
  });

  it('link-only fallback (no user image loads) still removes both LLM provenances', async () => {
    fetchUserAsset.mockResolvedValue(null);
    rows.push({ id: 'old-x', memoryId: 'mem-1', field: 'topics', valueJson: ['x'], confidence: 1, provenance: 'llm_extraction', modelVersion: 'old', createdAt: new Date(0) });

    await processor.process(job);

    expect(provider.understand).not.toHaveBeenCalled();
    expect(rows).toEqual([]);
  });

  it('a source screenshot stored with a canonical type reaches the provider with that media_type', async () => {
    // Real object-storage read path (fetchImageAsBase64 is not stubbed here).
    fetchUserAsset.mockRestore();
    prisma.memoryAsset.findMany.mockResolvedValue([SCREENSHOT]);
    jest
      .spyOn((processor as any).s3Client, 'send')
      .mockResolvedValue({ Body: Readable.from([Buffer.from('png-bytes')]), ContentLength: 9 } as never);

    await processor.process(job);

    const [image] = provider.understand.mock.calls[0][0].images;
    expect(image.mediaType).toBe('image/png');
    expect(image.evidence).toEqual({ kind: 'user_source_screenshot', assetId: 'asset-shot' });
  });
});
