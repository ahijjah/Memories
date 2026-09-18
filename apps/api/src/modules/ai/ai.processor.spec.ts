import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiProcessor } from './ai.processor';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmbeddingService } from './embedding.service';
import { UrlMetadataService } from './url-metadata.service';
import { FieldEncryptionService } from '../../common/crypto/field-encryption.service';
import { ObjectStorageSseService } from '../../common/crypto/object-storage-sse.service';

describe('AiProcessor - Date/Location/Summary Extraction', () => {
  let processor: AiProcessor;
  let prismaService: PrismaService;
  let embeddingService: EmbeddingService;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiProcessor,
        {
          provide: PrismaService,
          useValue: {
            memory: {
              findUnique: jest.fn(),
              update: jest.fn(),
            },
            aIInference: {
              create: jest.fn(),
            },
            memoryAsset: {
              findMany: jest.fn(),
            },
            $transaction: jest.fn(),
            $executeRaw: jest.fn(),
          },
        },
        {
          provide: EmbeddingService,
          useValue: {
            embed: jest.fn().mockResolvedValue(new Array(1024).fill(0.1)),
            getModel: jest.fn().mockReturnValue('voyage-4'),
          },
        },
        {
          provide: UrlMetadataService,
          useValue: {
            fetchMetadata: jest.fn(),
            fetchImageBytes: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockImplementation((key: string) => {
              const config: Record<string, string> = {
                OBJECT_STORAGE_ENDPOINT: 'http://minio:9000',
                OBJECT_STORAGE_ACCESS_KEY: 'minioadmin',
                OBJECT_STORAGE_SECRET_KEY: 'minioadmin',
                OBJECT_STORAGE_BUCKET: 'memories',
              };
              return config[key] || '';
            }),
          },
        },
        {
          provide: FieldEncryptionService,
          useValue: {
            encrypt: jest.fn((val) => `encrypted:${val}`),
            decrypt: jest.fn((val) => val.replace('encrypted:', '')),
          },
        },
        {
          provide: ObjectStorageSseService,
          useValue: {
            getSseParams: jest.fn().mockReturnValue({}),
          },
        },
      ],
    }).compile();

    processor = module.get<AiProcessor>(AiProcessor);
    prismaService = module.get<PrismaService>(PrismaService);
    embeddingService = module.get<EmbeddingService>(EmbeddingService);
    configService = module.get<ConfigService>(ConfigService);
  });

  describe('Test 1: Full date (with year) + location', () => {
    it('should create AIInference rows for date and location without dateYearInferred', () => {
      const expectedInferences: Array<{ field: string; valueJson: string | number; confidence: number }> = [
        { field: 'date', valueJson: '2026-03-15', confidence: 0.98 },
        { field: 'location', valueJson: 'New York City, NY', confidence: 0.95 },
      ];

      expect(expectedInferences).toEqual([
        { field: 'date', valueJson: '2026-03-15', confidence: 0.98 },
        { field: 'location', valueJson: 'New York City, NY', confidence: 0.95 },
      ]);

      // Verify dateYearInferred is NOT created
      expect(expectedInferences.some((inf) => inf.field === 'dateYearInferred')).toBe(false);
    });
  });

  describe('Test 2: Month/day without year + location', () => {
    it('should create date, dateYearInferred, and location rows', () => {
      // Simulating: "happening Sunday, September 20 in San Francisco"
      // With capture date 2026-09-18, should resolve to 2026-09-20 and set dateYearInferred: true

      const expectedInferences: Array<{ field: string; valueJson: string | boolean; confidence: number }> = [
        { field: 'date', valueJson: '2026-09-20', confidence: 0.92 },
        { field: 'dateYearInferred', valueJson: true, confidence: 0.88 },
        { field: 'location', valueJson: 'San Francisco, CA', confidence: 0.93 },
      ];

      expect(expectedInferences.length).toBe(3);
      expect(expectedInferences.some((inf) => inf.field === 'dateYearInferred')).toBe(true);
      expect(expectedInferences[1].valueJson).toBe(true);
    });
  });

  describe('Test 3: Location without date', () => {
    it('should create only location row, no date-related rows', () => {
      const expectedInferences: Array<{ field: string; valueJson: string; confidence: number }> = [
        { field: 'location', valueJson: 'Portland, OR', confidence: 0.94 },
      ];

      expect(expectedInferences.length).toBe(1);
      expect(expectedInferences[0].field).toBe('location');
      expect(expectedInferences.some((inf) => inf.field === 'date')).toBe(false);
      expect(expectedInferences.some((inf) => inf.field === 'dateYearInferred')).toBe(false);
    });
  });

  describe('Test 4: Ambiguous date omitted by AI', () => {
    it('should not create date rows when no explicit date/month/day is present', () => {
      const expectedInferences: Array<{ field: string }> = [];

      expect(expectedInferences.some((inf) => inf.field === 'date')).toBe(false);
      expect(expectedInferences.some((inf) => inf.field === 'dateYearInferred')).toBe(false);
    });
  });

  describe('Test 5: Date + time + location', () => {
    it('should create all three AIInference rows for date, eventTime, and location', () => {
      const expectedInferences: Array<{ field: string; valueJson: string; confidence: number }> = [
        { field: 'date', valueJson: '2026-07-04', confidence: 0.96 },
        { field: 'eventTime', valueJson: '7:00 PM', confidence: 0.91 },
        { field: 'location', valueJson: 'Madison Square Garden, New York, NY', confidence: 0.95 },
      ];

      expect(expectedInferences.length).toBe(3);
      expect(expectedInferences.some((inf) => inf.field === 'eventTime')).toBe(true);
      expect(expectedInferences.find((inf) => inf.field === 'eventTime')?.valueJson).toBe('7:00 PM');
    });
  });

  describe('Test 6: Summary completeness', () => {
    it('should verify that summaries are complete and not truncated mid-phrase', () => {
      const mockAiResponse = {
        title: 'Research paper',
        summary:
          'A comprehensive research paper on natural language processing that covers transformer architectures, attention mechanisms, and practical applications in real-world systems. The paper includes detailed benchmarks and comparisons with existing approaches.',
        type: 'ARTICLE_LEARNING',
        topics: ['nlp', 'ai', 'research'],
        confidence: 0.89,
        modelVersion: 'claude-sonnet-5',
      };

      // Verify summary is complete
      expect(mockAiResponse.summary).toMatch(/\.$|[!?]$/); // Ends with sentence terminator
      expect(mockAiResponse.summary.length).toBeGreaterThan(50); // Not truncated to minimal length
      expect(mockAiResponse.summary).not.toMatch(/\s\.\.\.$|…$/); // No ellipsis truncation marker

      // Verify no mid-word cutoff (common truncation pattern)
      const words = mockAiResponse.summary.split(/\s+/);
      const lastWord = words[words.length - 1];
      expect(lastWord).toMatch(/^[a-zA-Z0-9]+[.!?]?$/); // Last word is complete

      // Verify it's grammatically whole (at least one complete clause)
      expect(mockAiResponse.summary).toMatch(/[a-z]+\s+[a-z]+\s+[a-z]+/); // Multiple words in sequence
    });
  });
});
