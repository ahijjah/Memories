import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiProcessor } from './ai.processor';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmbeddingService } from './embedding.service';
import { UrlMetadataService } from './url-metadata.service';
import { FieldEncryptionService } from '../../common/crypto/field-encryption.service';
import { ObjectStorageSseService } from '../../common/crypto/object-storage-sse.service';
import type { Job } from 'bullmq';

// Mock the AnthropicAiProvider at the module level
jest.mock('@memory-app/ai', () => ({
  AnthropicAiProvider: jest.fn(),
}));

import { AnthropicAiProvider } from '@memory-app/ai';

describe('AiProcessor - Real Date/Location/Summary Extraction Tests', () => {
  let processor: AiProcessor;
  let prismaService: PrismaService;
  let embeddingService: EmbeddingService;
  let mockAnthropicProvider: any;

  const testKeyBase64 = Buffer.from('a'.repeat(32)).toString('base64');

  beforeEach(async () => {
    // Create mocked services
    const mockPrisma = {
      memory: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      aIInference: {
        create: jest.fn().mockResolvedValue({}),
      },
      memoryAsset: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn().mockResolvedValue(null),
    };

    const mockEmbedding = {
      embed: jest.fn().mockResolvedValue(new Array(1024).fill(0.1)),
      getModel: jest.fn().mockReturnValue('voyage-4'),
    };

    const mockUrlMetadata = {
      fetchMetadata: jest.fn().mockResolvedValue(null),
      fetchImageBytes: jest.fn().mockResolvedValue(null),
    };

    const mockConfig = {
      getOrThrow: jest.fn().mockImplementation((key: string) => {
        const config: Record<string, string> = {
          OBJECT_STORAGE_ENDPOINT: 'http://minio:9000',
          OBJECT_STORAGE_ACCESS_KEY: 'minioadmin',
          OBJECT_STORAGE_SECRET_KEY: 'minioadmin',
          OBJECT_STORAGE_BUCKET: 'memories',
          OBJECT_STORAGE_SSE_C_KEY: testKeyBase64,
        };
        return config[key] || '';
      }),
    };

    // Mock process.env for ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'sk-test-key-123';

    const mockFieldEncryption = {
      encrypt: jest.fn((val) => `encrypted:${val}`),
      decrypt: jest.fn((val) => val.replace('encrypted:', '')),
    };

    const mockSseService = {
      getSseParams: jest.fn().mockReturnValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiProcessor,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmbeddingService, useValue: mockEmbedding },
        { provide: UrlMetadataService, useValue: mockUrlMetadata },
        { provide: ConfigService, useValue: mockConfig },
        { provide: FieldEncryptionService, useValue: mockFieldEncryption },
        { provide: ObjectStorageSseService, useValue: mockSseService },
      ],
    }).compile();

    processor = module.get<AiProcessor>(AiProcessor);
    prismaService = module.get<PrismaService>(PrismaService);
    embeddingService = module.get<EmbeddingService>(EmbeddingService);

    // Set up the default mock provider
    mockAnthropicProvider = {
      understand: jest.fn(),
      answerWithContext: jest.fn(),
      summarize: jest.fn(),
      extractKeyPoints: jest.fn(),
      compareProducts: jest.fn(),
    };

    (AnthropicAiProvider as jest.Mock).mockImplementation(() => mockAnthropicProvider);
  });

  describe('Test 1: Full date (with year) + location', () => {
    it('should create date and location AIInference rows, no dateYearInferred', async () => {
      const memoryId = 'mem-001';
      const capturedAt = new Date('2026-09-18T10:00:00Z');

      // Mock the memory
      jest.spyOn(prismaService.memory, 'findUnique').mockResolvedValue({
        id: memoryId,
        userId: 'user-1',
        title: 'Conference in NYC',
        sourceType: 'text',
        sourceUri: null,
        capturedAt,
        processingState: 'queued',
        memoryType: null,
        lifecycleState: 'active',
        securityScope: 'private',
        idempotencyKey: 'key-1',
      } as any);

      // Track the .create() calls (not transaction)
      const createCalls: any[] = [];
      jest.spyOn(prismaService.aIInference, 'create').mockImplementation((args: any) => {
        createCalls.push(args);
        return Promise.resolve({}) as any;
      });

      // Mock the understand method to return a response with full date and location
      mockAnthropicProvider.understand.mockResolvedValue({
        title: 'Conference in NYC',
        summary: 'A technology conference held in New York City on March 15, 2026.',
        type: 'EVENT',
        topics: ['conference', 'technology'],
        confidence: 0.95,
        modelVersion: 'claude-sonnet-5',
        date: '2026-03-15',
        location: 'New York City, NY',
        fieldConfidence: {
          date: 0.98,
          location: 0.95,
        },
      });

      // Create a mock job
      const mockJob = { data: { memoryId } } as Partial<Job> as Job;

      // Run the processor
      await processor.process(mockJob);

      // Verify date inference
      const dateInference = createCalls.find((call) => call.data.field === 'date');
      expect(dateInference).toBeDefined();
      expect(dateInference.data.valueJson).toBe('2026-03-15');
      expect(dateInference.data.confidence).toBe(0.98);

      // Verify location inference
      const locationInference = createCalls.find((call) => call.data.field === 'location');
      expect(locationInference).toBeDefined();
      expect(locationInference.data.valueJson).toBe('New York City, NY');
      expect(locationInference.data.confidence).toBe(0.95);

      // Verify dateYearInferred does NOT exist
      const yearInferredInference = createCalls.find((call) => call.data.field === 'dateYearInferred');
      expect(yearInferredInference).toBeUndefined();
    });
  });

  describe('Test 2: Month/day without year + location', () => {
    it('should create date, dateYearInferred, and location rows', async () => {
      const memoryId = 'mem-002';
      const capturedAt = new Date('2026-09-18T10:00:00Z');

      jest.spyOn(prismaService.memory, 'findUnique').mockResolvedValue({
        id: memoryId,
        userId: 'user-1',
        title: 'Sunday gathering',
        sourceType: 'text',
        sourceUri: null,
        capturedAt,
        processingState: 'queued',
        memoryType: null,
        lifecycleState: 'active',
        securityScope: 'private',
        idempotencyKey: 'key-2',
      } as any);

      const createCalls: any[] = [];
      jest.spyOn(prismaService.aIInference, 'create').mockImplementation((args: any) => {
        createCalls.push(args);
        return Promise.resolve({}) as any;
      });

      mockAnthropicProvider.understand.mockResolvedValue({
        title: 'Sunday gathering',
        summary: 'A gathering happening Sunday, September 20 in San Francisco with friends.',
        type: 'EVENT',
        topics: ['event', 'social'],
        confidence: 0.85,
        modelVersion: 'claude-sonnet-5',
        date: '2026-09-20', // Resolved year
        dateYearInferred: true,
        location: 'San Francisco, CA',
        fieldConfidence: {
          date: 0.92,
          dateYearInferred: 0.88,
          location: 0.93,
        },
      });

      const mockJob = { data: { memoryId } } as Partial<Job> as Job;
      await processor.process(mockJob);

      // Verify date row
      const dateInference = createCalls.find((call) => call.data.field === 'date');
      expect(dateInference).toBeDefined();
      expect(dateInference.data.valueJson).toBe('2026-09-20');

      // Verify dateYearInferred row (critical new field)
      const yearInferredInference = createCalls.find((call) => call.data.field === 'dateYearInferred');
      expect(yearInferredInference).toBeDefined();
      expect(yearInferredInference.data.valueJson).toBe(true);
      expect(yearInferredInference.data.confidence).toBe(0.88);

      // Verify location row
      const locationInference = createCalls.find((call) => call.data.field === 'location');
      expect(locationInference).toBeDefined();
      expect(locationInference.data.valueJson).toBe('San Francisco, CA');
    });
  });

  describe('Test 3: Location without date', () => {
    it('should create only location row, no date-related rows', async () => {
      const memoryId = 'mem-003';
      const capturedAt = new Date('2026-09-18T10:00:00Z');

      jest.spyOn(prismaService.memory, 'findUnique').mockResolvedValue({
        id: memoryId,
        userId: 'user-1',
        title: 'Coffee shop visit',
        sourceType: 'text',
        sourceUri: null,
        capturedAt,
        processingState: 'queued',
        memoryType: null,
        lifecycleState: 'active',
        securityScope: 'private',
        idempotencyKey: 'key-3',
      } as any);

      const createCalls: any[] = [];
      jest.spyOn(prismaService.aIInference, 'create').mockImplementation((args: any) => {
        createCalls.push(args);
        return Promise.resolve({}) as any;
      });

      mockAnthropicProvider.understand.mockResolvedValue({
        title: 'Coffee shop visit',
        summary: 'A visit to a coffee shop in Portland.',
        type: 'PLACE',
        topics: ['place', 'coffee'],
        confidence: 0.88,
        modelVersion: 'claude-sonnet-5',
        location: 'Portland, OR',
        fieldConfidence: {
          location: 0.94,
        },
        // Note: no date field
      });

      const mockJob = { data: { memoryId } } as Partial<Job> as Job;
      await processor.process(mockJob);

      // Verify location row exists
      const locationInference = createCalls.find((call) => call.data.field === 'location');
      expect(locationInference).toBeDefined();
      expect(locationInference.data.valueJson).toBe('Portland, OR');

      // Verify no date rows
      const dateInference = createCalls.find((call) => call.data.field === 'date');
      expect(dateInference).toBeUndefined();

      const yearInferredInference = createCalls.find((call) => call.data.field === 'dateYearInferred');
      expect(yearInferredInference).toBeUndefined();
    });
  });

  describe('Test 4: Ambiguous date omitted by AI', () => {
    it('should not create date rows when AI response omits date field', async () => {
      const memoryId = 'mem-004';
      const capturedAt = new Date('2026-09-18T10:00:00Z');

      jest.spyOn(prismaService.memory, 'findUnique').mockResolvedValue({
        id: memoryId,
        userId: 'user-1',
        title: 'Blog post',
        sourceType: 'text',
        sourceUri: null,
        capturedAt,
        processingState: 'queued',
        memoryType: null,
        lifecycleState: 'active',
        securityScope: 'private',
        idempotencyKey: 'key-4',
      } as any);

      const createCalls: any[] = [];
      jest.spyOn(prismaService.aIInference, 'create').mockImplementation((args: any) => {
        createCalls.push(args);
        return Promise.resolve({}) as any;
      });

      mockAnthropicProvider.understand.mockResolvedValue({
        title: 'Blog post',
        summary: 'An interesting blog post about machine learning without any specific date references.',
        type: 'ARTICLE_LEARNING',
        topics: ['ml', 'ai'],
        confidence: 0.81,
        modelVersion: 'claude-sonnet-5',
        // No date, no location, no dateYearInferred
      });

      const mockJob = { data: { memoryId } } as Partial<Job> as Job;
      await processor.process(mockJob);

      // Verify no date rows
      const dateInference = createCalls.find((call) => call.data.field === 'date');
      expect(dateInference).toBeUndefined();

      const yearInferredInference = createCalls.find((call) => call.data.field === 'dateYearInferred');
      expect(yearInferredInference).toBeUndefined();
    });
  });

  describe('Test 5: Date + time + location', () => {
    it('should create date, eventTime, and location rows all correctly', async () => {
      const memoryId = 'mem-005';
      const capturedAt = new Date('2026-07-01T10:00:00Z');

      jest.spyOn(prismaService.memory, 'findUnique').mockResolvedValue({
        id: memoryId,
        userId: 'user-1',
        title: 'Concert',
        sourceType: 'text',
        sourceUri: null,
        capturedAt,
        processingState: 'queued',
        memoryType: null,
        lifecycleState: 'active',
        securityScope: 'private',
        idempotencyKey: 'key-5',
      } as any);

      const createCalls: any[] = [];
      jest.spyOn(prismaService.aIInference, 'create').mockImplementation((args: any) => {
        createCalls.push(args);
        return Promise.resolve({}) as any;
      });

      mockAnthropicProvider.understand.mockResolvedValue({
        title: 'Concert',
        summary: 'A concert at Madison Square Garden on July 4, 2026 at 7:00 PM.',
        type: 'EVENT',
        topics: ['concert', 'music'],
        confidence: 0.93,
        modelVersion: 'claude-sonnet-5',
        date: '2026-07-04',
        eventTime: '7:00 PM',
        location: 'Madison Square Garden, New York, NY',
        fieldConfidence: {
          date: 0.96,
          eventTime: 0.91,
          location: 0.95,
        },
      });

      const mockJob = { data: { memoryId } } as Partial<Job> as Job;
      await processor.process(mockJob);

      // Verify date row
      const dateInference = createCalls.find((call) => call.data.field === 'date');
      expect(dateInference).toBeDefined();
      expect(dateInference.data.valueJson).toBe('2026-07-04');

      // Verify eventTime row (critical new field)
      const timeInference = createCalls.find((call) => call.data.field === 'eventTime');
      expect(timeInference).toBeDefined();
      expect(timeInference.data.valueJson).toBe('7:00 PM');
      expect(timeInference.data.confidence).toBe(0.91);

      // Verify location row
      const locationInference = createCalls.find((call) => call.data.field === 'location');
      expect(locationInference).toBeDefined();
      expect(locationInference.data.valueJson).toBe('Madison Square Garden, New York, NY');
    });
  });

  describe('Test 6: Summary storage completeness', () => {
    it('should store the complete summary from AI response without truncation', async () => {
      const memoryId = 'mem-006';
      const capturedAt = new Date('2026-09-18T10:00:00Z');
      const longSummary =
        'A comprehensive research paper on natural language processing that covers transformer architectures, attention mechanisms, and practical applications in real-world systems. The paper includes detailed benchmarks and comparisons with existing approaches.';

      jest.spyOn(prismaService.memory, 'findUnique').mockResolvedValue({
        id: memoryId,
        userId: 'user-1',
        title: 'Research paper',
        sourceType: 'text',
        sourceUri: null,
        capturedAt,
        processingState: 'queued',
        memoryType: null,
        lifecycleState: 'active',
        securityScope: 'private',
        idempotencyKey: 'key-6',
      } as any);

      const createCalls: any[] = [];
      jest.spyOn(prismaService.aIInference, 'create').mockImplementation((args: any) => {
        createCalls.push(args);
        return Promise.resolve({}) as any;
      });

      mockAnthropicProvider.understand.mockResolvedValue({
        title: 'Research paper',
        summary: longSummary,
        type: 'ARTICLE_LEARNING',
        topics: ['nlp', 'ai', 'research'],
        confidence: 0.89,
        modelVersion: 'claude-sonnet-5',
      });

      const mockJob = { data: { memoryId } } as Partial<Job> as Job;
      await processor.process(mockJob);

      // Find summary inference
      const summaryInference = createCalls.find((call) => call.data.field === 'summary');
      expect(summaryInference).toBeDefined();

      // Verify the summary is stored completely and unmodified
      expect(summaryInference.data.valueJson).toBe(longSummary);
      expect(summaryInference.data.valueJson).toMatch(/\.$/); // Ends with period
      expect(summaryInference.data.valueJson.length).toBeGreaterThan(100); // Not truncated to minimal length
      expect(summaryInference.data.valueJson).not.toMatch(/\s\.\.\.$|…$/); // No ellipsis marker

      // Verify it contains complete phrases, not mid-word cutoff
      const words = summaryInference.data.valueJson.split(/\s+/);
      const lastWord = words[words.length - 1];
      expect(lastWord).toMatch(/^[a-zA-Z0-9]+[.!?]?$/); // Last word is complete
    });
  });
});
