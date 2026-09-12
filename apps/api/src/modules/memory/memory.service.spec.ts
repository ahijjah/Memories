import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FieldEncryptionService } from '../../common/crypto/field-encryption.service';
import { AiQueueService } from '../ai/ai-queue.service';
import { AssetsService } from '../assets/assets.service';
import { MemoryDeletionQueueService } from './deletion-queue.service';

// Mock AI provider to capture input passed to summarize/extractKeyPoints/compareProducts
let mockSummarizeInput: any;
let mockExtractKeyPointsInput: any;
let mockCompareProductsInput: any;

jest.mock('@memory-app/ai', () => ({
  AnthropicAiProvider: jest.fn().mockImplementation(() => ({
    summarize: jest.fn().mockImplementation((input) => {
      mockSummarizeInput = input;
      return Promise.resolve('Quick summary');
    }),
    extractKeyPoints: jest.fn().mockImplementation((input) => {
      mockExtractKeyPointsInput = input;
      return Promise.resolve(['point 1', 'point 2']);
    }),
    compareProducts: jest.fn().mockImplementation((input) => {
      mockCompareProductsInput = input;
      return Promise.resolve({
        comparison: 'Product A is better than B',
        keyDifferences: ['A has better price', 'B has better quality'],
      });
    }),
  })),
}));

describe('MemoryService', () => {
  let service: MemoryService;
  const prismaMock = {
    memory: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
    },
  };
  const aiQueueMock = { enqueueUnderstanding: jest.fn() };
  const assetsMock = { getViewUrl: jest.fn().mockReturnValue('http://mock-url') };
  const deletionQueueMock = { enqueueFinalization: jest.fn(), cancelFinalization: jest.fn() };
  const fieldEncryptionMock = {
    encrypt: jest.fn((val) => `encrypted:${val}`),
    decrypt: jest.fn((val) => val.replace(/^encrypted:/, '')),
  };
  const configMock = {
    getOrThrow: (key: string) => {
      if (key === 'ANTHROPIC_API_KEY') return 'test-api-key';
      throw new Error(`Unknown config key: ${key}`);
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        MemoryService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AiQueueService, useValue: aiQueueMock },
        { provide: AssetsService, useValue: assetsMock },
        { provide: MemoryDeletionQueueService, useValue: deletionQueueMock },
        { provide: FieldEncryptionService, useValue: fieldEncryptionMock },
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();

    service = moduleRef.get(MemoryService);
  });

  it('creates a new Memory and enqueues AI understanding (spec §8)', async () => {
    prismaMock.memory.findUnique.mockResolvedValue(null);
    prismaMock.memory.create.mockResolvedValue({ id: 'mem-1', userId: 'user-1' });

    const result = await service.create('user-1', {
      sourceType: 'url',
      sourceUri: 'https://example.com',
      idempotencyKey: 'key-1',
    } as any);

    expect(prismaMock.memory.create).toHaveBeenCalledTimes(1);
    expect(aiQueueMock.enqueueUnderstanding).toHaveBeenCalledWith('mem-1');
    expect(result.id).toBe('mem-1');
  });

  it('returns the existing Memory instead of duplicating on retry (BR §3, spec §17)', async () => {
    prismaMock.memory.findUnique.mockResolvedValue({ id: 'mem-1', userId: 'user-1' });

    const result = await service.create('user-1', {
      sourceType: 'url',
      idempotencyKey: 'key-1',
    } as any);

    expect(prismaMock.memory.create).not.toHaveBeenCalled();
    expect(aiQueueMock.enqueueUnderstanding).not.toHaveBeenCalled();
    expect(result.id).toBe('mem-1');
  });

  it('rejects retrying another user\'s idempotency key (FR-SEC-001)', async () => {
    prismaMock.memory.findUnique.mockResolvedValue({ id: 'mem-1', userId: 'someone-else' });

    await expect(
      service.create('user-1', { sourceType: 'url', idempotencyKey: 'key-1' } as any),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws NotFoundException when retrieving a vault-scoped Memory via findOneForUser', async () => {
    const vaultMemory = {
      id: 'mem-1',
      userId: 'user-1',
      securityScope: 'vault',
      assets: [],
      aiInferences: [],
      userConfirmations: [],
    };
    prismaMock.memory.findUnique.mockResolvedValue(vaultMemory);

    await expect(service.findOneForUser('user-1', 'mem-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('summarizeMemory includes existing AI summary in input text', async () => {
    const memory = {
      id: 'mem-1',
      userId: 'user-1',
      title: 'Article Title',
      sourceUri: 'https://example.com/article',
      securityScope: 'private',
      aiInferences: [{ valueJson: 'This is an AI-extracted summary of the article.' }],
    };
    prismaMock.memory.findUnique.mockResolvedValue(memory);

    await service.summarizeMemory('user-1', 'mem-1');

    expect(mockSummarizeInput.text).toContain('Article Title');
    expect(mockSummarizeInput.text).toContain('This is an AI-extracted summary');
  });

  it('extractKeyPoints includes existing AI summary in input text', async () => {
    const memory = {
      id: 'mem-1',
      userId: 'user-1',
      title: 'Article Title',
      sourceUri: 'https://example.com/article',
      securityScope: 'private',
      aiInferences: [{ valueJson: 'This is an AI-extracted summary of the article.' }],
    };
    prismaMock.memory.findUnique.mockResolvedValue(memory);

    await service.extractKeyPoints('user-1', 'mem-1');

    expect(mockExtractKeyPointsInput.text).toContain('Article Title');
    expect(mockExtractKeyPointsInput.text).toContain('This is an AI-extracted summary');
  });

  it('summarizeMemory falls back to title when no summary inference exists', async () => {
    const memory = {
      id: 'mem-1',
      userId: 'user-1',
      title: 'Article Title',
      sourceUri: 'https://example.com/article',
      securityScope: 'private',
      aiInferences: [],
    };
    prismaMock.memory.findUnique.mockResolvedValue(memory);

    await service.summarizeMemory('user-1', 'mem-1');

    expect(mockSummarizeInput.text).toBe('Article Title');
  });

  it('extractKeyPoints throws NotFoundException for vault-scoped memory', async () => {
    const memory = {
      id: 'mem-1',
      userId: 'user-1',
      title: 'Secret Document',
      sourceUri: 'https://example.com/doc',
      securityScope: 'vault',
      aiInferences: [],
    };
    prismaMock.memory.findUnique.mockResolvedValue(memory);

    await expect(service.extractKeyPoints('user-1', 'mem-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('compareMemories rejects less than 2 memoryIds', async () => {
    await expect(service.compareMemories('user-1', ['mem-1'])).rejects.toThrow(
      'Must compare between 2 and 5 memories',
    );
  });

  it('compareMemories rejects more than 5 memoryIds', async () => {
    await expect(
      service.compareMemories('user-1', ['mem-1', 'mem-2', 'mem-3', 'mem-4', 'mem-5', 'mem-6']),
    ).rejects.toThrow('Must compare between 2 and 5 memories');
  });

  it('compareMemories rejects if any memory is vault-scoped', async () => {
    const product1 = {
      id: 'mem-1',
      userId: 'user-1',
      title: 'Product 1',
      securityScope: 'private',
      aiInferences: [],
      userConfirmations: [],
    };
    const vaultProduct = {
      id: 'mem-2',
      userId: 'user-1',
      title: 'Secret Product',
      securityScope: 'vault',
      aiInferences: [],
      userConfirmations: [],
    };

    prismaMock.memory.findUnique.mockResolvedValueOnce(product1);
    prismaMock.memory.findUnique.mockResolvedValueOnce(vaultProduct);

    await expect(
      service.compareMemories('user-1', ['mem-1', 'mem-2']),
    ).rejects.toThrow('Vault content cannot be compared');
  });

  it('compareMemories returns comparison with key differences', async () => {
    const product1 = {
      id: 'mem-1',
      userId: 'user-1',
      title: 'iPhone 15',
      securityScope: 'private',
      aiInferences: [
        { field: 'brand', valueJson: 'Apple' },
        { field: 'price', valueJson: '$999' },
        { field: 'summary', valueJson: 'Latest iPhone model' },
      ],
      userConfirmations: [],
    };
    const product2 = {
      id: 'mem-2',
      userId: 'user-1',
      title: 'Samsung Galaxy S24',
      securityScope: 'private',
      aiInferences: [
        { field: 'brand', valueJson: 'Samsung' },
        { field: 'price', valueJson: '$899' },
        { field: 'summary', valueJson: 'Flagship Android phone' },
      ],
      userConfirmations: [],
    };

    prismaMock.memory.findUnique.mockResolvedValueOnce(product1);
    prismaMock.memory.findUnique.mockResolvedValueOnce(product2);

    const result = await service.compareMemories('user-1', ['mem-1', 'mem-2']);

    expect(result.comparison).toBeDefined();
    expect(Array.isArray(result.keyDifferences)).toBe(true);
    expect(mockCompareProductsInput.products).toHaveLength(2);
    expect(mockCompareProductsInput.products[0].title).toBe('iPhone 15');
    expect(mockCompareProductsInput.products[1].title).toBe('Samsung Galaxy S24');
  });
});
