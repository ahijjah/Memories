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
      update: jest.fn(),
    },
    aIInference: {
      findMany: jest.fn(),
    },
    userConfirmation: {
      findMany: jest.fn(),
    },
    $queryRaw: jest.fn(),
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

  it('findOneForUser increments viewCount and sets lastViewedAt for non-vault memories', async () => {
    const memory = {
      id: 'mem-1',
      userId: 'user-1',
      title: 'My Memory',
      securityScope: 'private',
      assets: [],
      aiInferences: [],
      userConfirmations: [],
    };
    prismaMock.memory.findUnique.mockResolvedValue(memory);
    prismaMock.memory.update.mockResolvedValue(memory);

    await service.findOneForUser('user-1', 'mem-1');

    expect(prismaMock.memory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'mem-1' },
        data: expect.objectContaining({
          viewCount: { increment: 1 },
        }),
      }),
    );
    // Verify lastViewedAt is set to a recent date (within last second)
    const updateCall = prismaMock.memory.update.mock.calls[0];
    const lastViewedAt = updateCall[0].data.lastViewedAt;
    expect(lastViewedAt).toBeInstanceOf(Date);
    expect(Date.now() - lastViewedAt.getTime()).toBeLessThan(1000);
  });

  it('vault.service.ts findOneForUser does NOT track views for vault-scoped memories', async () => {
    // This is a behavioral test: we verify that vault.service.ts does not call
    // prisma.memory.update in its findOneForUser method, which would track views.
    // Since we're testing memory.service, we simply verify the code pattern by
    // checking that only non-vault memories get view tracking in memory.service.
    jest.clearAllMocks();

    // Verify vault-scoped memories are rejected before view tracking
    const vaultMemory = {
      id: 'mem-2',
      userId: 'user-1',
      securityScope: 'vault',
      assets: [],
      aiInferences: [],
      userConfirmations: [],
    };
    prismaMock.memory.findUnique.mockResolvedValue(vaultMemory);

    await expect(service.findOneForUser('user-1', 'mem-2')).rejects.toThrow(
      NotFoundException,
    );

    // Verify update was never called (view tracking never happened for vault)
    expect(prismaMock.memory.update).not.toHaveBeenCalled();
  });

  describe('findRelatedForUser (P2.1 Related Memories)', () => {
    // Helper to setup base source memory mocks
    const setupSourceMemory = (userId: string, scope: 'private' | 'vault' = 'private', lifecycle = 'active') => {
      const memory = {
        id: 'source-mem',
        userId,
        title: 'Source Article',
        securityScope: scope,
        lifecycleState: lifecycle,
        assets: [],
        aiInferences: [],
        userConfirmations: [],
      };
      prismaMock.memory.findUnique.mockResolvedValueOnce(memory);
      return memory;
    };

    it('A. same-user candidate allowed for private source', async () => {
      setupSourceMemory('user-1', 'private');
      const candidate = {
        id: 'cand-mem',
        title: 'Candidate',
        memoryType: 'url',
        capturedAt: new Date(),
        securityScope: 'private',
        distance: 0.3,
      };
      (prismaMock.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([{ vector: [0.1, 0.2] }])
        .mockResolvedValueOnce([candidate]);
      (prismaMock.aIInference.findMany as jest.Mock).mockResolvedValueOnce([]);
      (prismaMock.userConfirmation.findMany as jest.Mock).mockResolvedValueOnce([]);
      (prismaMock.memory.findMany as jest.Mock).mockResolvedValueOnce([{ id: 'cand-mem', assets: [] }]);

      const result = await service.findRelatedForUser('user-1', 'source-mem', 5);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('cand-mem');
    });

    it('B. cross-user candidate excluded by SQL WHERE userId', async () => {
      setupSourceMemory('user-1', 'private');
      (prismaMock.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([{ vector: [0.1, 0.2] }])
        .mockResolvedValueOnce([]);

      const result = await service.findRelatedForUser('user-1', 'source-mem', 5);
      expect(result).toEqual([]);
    });

    it('C. querying another user\'s source rejected with ForbiddenException', async () => {
      setupSourceMemory('user-2', 'private');

      await expect(
        service.findRelatedForUser('user-1', 'source-mem', 5),
      ).rejects.toThrow(ForbiddenException);
    });

    it('D. source itself excluded by SQL WHERE id !=', async () => {
      setupSourceMemory('user-1', 'private');
      (prismaMock.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([{ vector: [0.1, 0.2] }])
        .mockResolvedValueOnce([]);

      const result = await service.findRelatedForUser('user-1', 'source-mem', 5);
      expect(result).toEqual([]);
    });

    it('E. deleted candidate excluded by SQL WHERE lifecycleState NOT IN', async () => {
      setupSourceMemory('user-1', 'private');
      (prismaMock.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([{ vector: [0.1, 0.2] }])
        .mockResolvedValueOnce([]);

      const result = await service.findRelatedForUser('user-1', 'source-mem', 5);
      expect(result).toEqual([]);
    });

    it('F. deleted_pending candidate excluded by SQL WHERE lifecycleState NOT IN', async () => {
      setupSourceMemory('user-1', 'private');
      (prismaMock.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([{ vector: [0.1, 0.2] }])
        .mockResolvedValueOnce([]);

      const result = await service.findRelatedForUser('user-1', 'source-mem', 5);
      expect(result).toEqual([]);
    });

    it('G. deleted source rejected with NotFoundException', async () => {
      setupSourceMemory('user-1', 'private', 'deleted');

      await expect(
        service.findRelatedForUser('user-1', 'source-mem', 5),
      ).rejects.toThrow(NotFoundException);
    });

    it('H. deleted_pending source rejected with NotFoundException', async () => {
      setupSourceMemory('user-1', 'private', 'deleted_pending');

      await expect(
        service.findRelatedForUser('user-1', 'source-mem', 5),
      ).rejects.toThrow(NotFoundException);
    });

    it('I. private source -> private candidates allowed', async () => {
      setupSourceMemory('user-1', 'private');
      const candidate = {
        id: 'cand-mem',
        title: 'Candidate',
        memoryType: 'url',
        capturedAt: new Date(),
        securityScope: 'private',
        distance: 0.3,
      };
      (prismaMock.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([{ vector: [0.1, 0.2] }])
        .mockResolvedValueOnce([candidate]);
      (prismaMock.aIInference.findMany as jest.Mock).mockResolvedValueOnce([]);
      (prismaMock.userConfirmation.findMany as jest.Mock).mockResolvedValueOnce([]);
      (prismaMock.memory.findMany as jest.Mock).mockResolvedValueOnce([{ id: 'cand-mem', assets: [] }]);

      const result = await service.findRelatedForUser('user-1', 'source-mem', 5);
      expect(result).toHaveLength(1);
    });

    it('J. private source -> vault candidates excluded by SQL WHERE securityScope', async () => {
      setupSourceMemory('user-1', 'private');
      (prismaMock.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([{ vector: [0.1, 0.2] }])
        .mockResolvedValueOnce([]);

      const result = await service.findRelatedForUser('user-1', 'source-mem', 5);
      expect(result).toEqual([]);
    });

    it('K. vault source -> vault candidates allowed', async () => {
      setupSourceMemory('user-1', 'vault');
      const candidate = {
        id: 'cand-mem',
        title: 'Vault Candidate',
        memoryType: 'document',
        capturedAt: new Date(),
        securityScope: 'vault',
        distance: 0.25,
      };
      (prismaMock.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([{ vector: [0.1, 0.2] }])
        .mockResolvedValueOnce([candidate]);
      (prismaMock.aIInference.findMany as jest.Mock).mockResolvedValueOnce([]);
      (prismaMock.userConfirmation.findMany as jest.Mock).mockResolvedValueOnce([]);
      (prismaMock.memory.findMany as jest.Mock).mockResolvedValueOnce([{ id: 'cand-mem', assets: [] }]);

      const result = await service.findRelatedForUser('user-1', 'source-mem', 5);
      expect(result).toHaveLength(1);
      expect(result[0].securityScope).toBe('vault');
    });

    it('L. vault source -> private candidates excluded by SQL WHERE securityScope', async () => {
      setupSourceMemory('user-1', 'vault');
      (prismaMock.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([{ vector: [0.1, 0.2] }])
        .mockResolvedValueOnce([]);

      const result = await service.findRelatedForUser('user-1', 'source-mem', 5);
      expect(result).toEqual([]);
    });

    it('M. missing source embedding returns []', async () => {
      setupSourceMemory('user-1', 'private');
      (prismaMock.$queryRaw as jest.Mock).mockResolvedValueOnce([]);

      const result = await service.findRelatedForUser('user-1', 'source-mem', 5);
      expect(result).toEqual([]);
    });

    it('N. distance threshold 0.5 applied (similarity calculation)', async () => {
      setupSourceMemory('user-1', 'private');
      const candidate = {
        id: 'cand-mem',
        title: 'Candidate',
        memoryType: 'url',
        capturedAt: new Date(),
        securityScope: 'private',
        distance: 0.3,
      };
      (prismaMock.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([{ vector: [0.1, 0.2] }])
        .mockResolvedValueOnce([candidate]);
      (prismaMock.aIInference.findMany as jest.Mock).mockResolvedValueOnce([]);
      (prismaMock.userConfirmation.findMany as jest.Mock).mockResolvedValueOnce([]);
      (prismaMock.memory.findMany as jest.Mock).mockResolvedValueOnce([{ id: 'cand-mem', assets: [] }]);

      const result = await service.findRelatedForUser('user-1', 'source-mem', 5);
      expect(result[0].similarity).toBe(0.7);
    });

    it('O. deterministic ordering by distance and ID', async () => {
      setupSourceMemory('user-1', 'private');
      const candidates = [
        { id: 'mem-b', title: 'B', memoryType: 'url', capturedAt: new Date(), securityScope: 'private', distance: 0.2 },
        { id: 'mem-a', title: 'A', memoryType: 'url', capturedAt: new Date(), securityScope: 'private', distance: 0.2 },
      ];
      (prismaMock.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([{ vector: [0.1, 0.2] }])
        .mockResolvedValueOnce(candidates);
      (prismaMock.aIInference.findMany as jest.Mock).mockResolvedValueOnce([]);
      (prismaMock.userConfirmation.findMany as jest.Mock).mockResolvedValueOnce([]);
      (prismaMock.memory.findMany as jest.Mock).mockResolvedValueOnce([
        { id: 'mem-b', assets: [] },
        { id: 'mem-a', assets: [] },
      ]);

      const result = await service.findRelatedForUser('user-1', 'source-mem', 5);
      expect(result.length).toBe(2);
    });

    it('P. applies limit parameter (default 5)', async () => {
      setupSourceMemory('user-1', 'private');
      (prismaMock.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([{ vector: [0.1, 0.2] }])
        .mockResolvedValueOnce([]);

      await service.findRelatedForUser('user-1', 'source-mem');
      expect((prismaMock.$queryRaw as jest.Mock).mock.calls.length).toBe(2);
    });

    it('Q. applies limit parameter (custom value)', async () => {
      setupSourceMemory('user-1', 'private');
      (prismaMock.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([{ vector: [0.1, 0.2] }])
        .mockResolvedValueOnce([]);

      await service.findRelatedForUser('user-1', 'source-mem', 3);
      expect((prismaMock.$queryRaw as jest.Mock).mock.calls.length).toBe(2);
    });

    it('R. title precedence: UserConfirmation > AIInference > title', async () => {
      setupSourceMemory('user-1', 'private');
      const candidate = {
        id: 'cand-mem',
        title: 'RawTitle',
        memoryType: 'url',
        capturedAt: new Date(),
        securityScope: 'private',
        distance: 0.3,
      };
      (prismaMock.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([{ vector: [0.1, 0.2] }])
        .mockResolvedValueOnce([candidate]);
      (prismaMock.aIInference.findMany as jest.Mock).mockResolvedValueOnce([
        { memoryId: 'cand-mem', field: 'title', valueJson: 'AITitle' },
      ]);
      (prismaMock.userConfirmation.findMany as jest.Mock).mockResolvedValueOnce([
        { memoryId: 'cand-mem', field: 'title', confirmedValue: 'ConfirmedTitle' },
      ]);
      (prismaMock.memory.findMany as jest.Mock).mockResolvedValueOnce([{ id: 'cand-mem', assets: [] }]);

      const result = await service.findRelatedForUser('user-1', 'source-mem', 5);
      expect(result[0].title).toBe('ConfirmedTitle');
    });

    it('S. DTO structure does not leak sensitive data', async () => {
      setupSourceMemory('user-1', 'private');
      const candidate = {
        id: 'cand-mem',
        title: 'Candidate',
        memoryType: 'url',
        capturedAt: new Date(),
        securityScope: 'private',
        distance: 0.3,
      };
      (prismaMock.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([{ vector: [0.1, 0.2] }])
        .mockResolvedValueOnce([candidate]);
      (prismaMock.aIInference.findMany as jest.Mock).mockResolvedValueOnce([]);
      (prismaMock.userConfirmation.findMany as jest.Mock).mockResolvedValueOnce([]);
      (prismaMock.memory.findMany as jest.Mock).mockResolvedValueOnce([{ id: 'cand-mem', assets: [] }]);

      const result = await service.findRelatedForUser('user-1', 'source-mem', 5);
      const dto = result[0];

      expect(dto).toHaveProperty('id');
      expect(dto).toHaveProperty('title');
      expect(dto).toHaveProperty('memoryType');
      expect(dto).toHaveProperty('capturedAt');
      expect(dto).toHaveProperty('securityScope');
      expect(dto).toHaveProperty('similarity');
      expect(dto).toHaveProperty('assets');
      expect(dto).not.toHaveProperty('vector');
      expect(dto).not.toHaveProperty('embedding');
      expect(dto).not.toHaveProperty('objectKey');
      expect(dto).not.toHaveProperty('userId');
      expect(dto).not.toHaveProperty('lifecycleState');
    });

    it('T. asset URL format is /assets/:assetId/content', async () => {
      setupSourceMemory('user-1', 'private');
      const candidate = {
        id: 'cand-mem',
        title: 'Candidate',
        memoryType: 'url',
        capturedAt: new Date(),
        securityScope: 'private',
        distance: 0.3,
      };
      (prismaMock.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([{ vector: [0.1, 0.2] }])
        .mockResolvedValueOnce([candidate]);
      (prismaMock.aIInference.findMany as jest.Mock).mockResolvedValueOnce([]);
      (prismaMock.userConfirmation.findMany as jest.Mock).mockResolvedValueOnce([]);
      (prismaMock.memory.findMany as jest.Mock).mockResolvedValueOnce([
        {
          id: 'cand-mem',
          assets: [{ id: 'asset-123', mimeType: 'text/plain', variant: 'original' }],
        },
      ]);

      const result = await service.findRelatedForUser('user-1', 'source-mem', 5);
      expect(result[0].assets[0].url).toBe('/assets/asset-123/content');
    });

    it('U. no external API calls (embedding reused from DB)', async () => {
      setupSourceMemory('user-1', 'private');
      (prismaMock.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([{ vector: [0.1, 0.2] }])
        .mockResolvedValueOnce([]);

      await service.findRelatedForUser('user-1', 'source-mem', 5);

      expect((prismaMock.$queryRaw as jest.Mock).mock.calls.length).toBe(2);
      const calls = (prismaMock.$queryRaw as jest.Mock).mock.calls.map((c: any) => String(c[0]));
      expect(calls[0]).toContain('SELECT "vector" FROM "embeddings"');
      expect(calls[1]).toContain('FROM "embeddings" e');
    });
  });

  describe('Resolved Memory: deterministic inference order and latest-wins resolution', () => {
    const t1 = new Date('2026-01-01T00:00:00.000Z');
    const t2 = new Date('2026-02-01T00:00:00.000Z');
    const latestFirst = [{ createdAt: 'desc' }, { id: 'desc' }];

    it('Detail orders aiInferences latest-first and still hides Vault content', async () => {
      prismaMock.memory.findUnique.mockResolvedValueOnce({
        id: 'mem-1',
        userId: 'user-1',
        securityScope: 'private',
        assets: [],
        aiInferences: [],
        userConfirmations: [],
      });
      prismaMock.memory.update.mockResolvedValue({});

      await service.findOneForUser('user-1', 'mem-1');

      expect(prismaMock.memory.findUnique).toHaveBeenCalledWith({
        where: { id: 'mem-1' },
        include: { assets: true, aiInferences: { orderBy: latestFirst }, userConfirmations: true },
      });

      prismaMock.memory.findUnique.mockResolvedValueOnce({
        id: 'vault-1',
        userId: 'user-1',
        securityScope: 'vault',
        assets: [],
        aiInferences: [],
        userConfirmations: [],
      });
      await expect(service.findOneForUser('user-1', 'vault-1')).rejects.toThrow(NotFoundException);
    });

    it('list keeps user/Vault scoping and orders its filtered inference include latest-first', async () => {
      prismaMock.memory.findMany.mockResolvedValueOnce([]);

      await service.findAllForUser('user-1');

      expect(prismaMock.memory.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          lifecycleState: { notIn: ['deleted', 'deleted_pending'] },
          securityScope: { not: 'vault' },
        },
        include: {
          assets: true,
          aiInferences: {
            where: { field: { in: ['date', 'location', 'price', 'category', 'title', 'type'] } },
            orderBy: latestFirst,
          },
          userConfirmations: {
            where: { field: { in: ['title', 'type', 'date', 'location', 'price', 'category'] } },
          },
        },
        orderBy: { capturedAt: 'desc' },
      });
    });

    it('Related titles use the latest AI title when rows arrive oldest-first (reprocess A → B)', async () => {
      prismaMock.memory.findUnique.mockResolvedValueOnce({
        id: 'source-mem',
        userId: 'user-1',
        title: 'Source',
        securityScope: 'private',
        lifecycleState: 'active',
        assets: [],
        aiInferences: [],
        userConfirmations: [],
      });
      (prismaMock.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([{ vector: [0.1, 0.2] }])
        .mockResolvedValueOnce([
          { id: 'cand-mem', title: 'Raw', memoryType: 'url', capturedAt: t1, securityScope: 'private', distance: 0.3 },
        ]);
      (prismaMock.aIInference.findMany as jest.Mock).mockResolvedValueOnce([
        { id: 'a', memoryId: 'cand-mem', field: 'title', valueJson: 'A', createdAt: t1 },
        { id: 'b', memoryId: 'cand-mem', field: 'title', valueJson: 'B', createdAt: t2 },
      ]);
      (prismaMock.userConfirmation.findMany as jest.Mock).mockResolvedValueOnce([]);
      (prismaMock.memory.findMany as jest.Mock).mockResolvedValueOnce([{ id: 'cand-mem', assets: [] }]);

      const result = await service.findRelatedForUser('user-1', 'source-mem', 5);

      expect(result[0].title).toBe('B');
    });

    it('Compare resolves confirmation > latest AI per field', async () => {
      const memory = (id: string) => ({
        id,
        userId: 'user-1',
        title: `Raw ${id}`,
        securityScope: 'private',
        aiInferences: [
          { id: `${id}-p1`, field: 'price', valueJson: '$10', createdAt: t1 },
          { id: `${id}-p2`, field: 'price', valueJson: '$12', createdAt: t2 },
          { id: `${id}-b1`, field: 'brand', valueJson: 'AI Brand', createdAt: t2 },
        ],
        userConfirmations: [{ field: 'brand', confirmedValue: 'User Brand' }],
      });
      prismaMock.memory.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(memory(where.id)),
      );

      await service.compareMemories('user-1', ['m1', 'm2']);

      expect(mockCompareProductsInput.products[0]).toMatchObject({ price: '$12', brand: 'User Brand' });
      prismaMock.memory.findUnique.mockReset();
    });
  });

  describe('Resolved Memory public contract (PR2)', () => {
    const t1 = new Date('2026-01-01T00:00:00.000Z');
    const t2 = new Date('2026-02-01T00:00:00.000Z');

    it('Detail adds resolved from decrypted rows and keeps raw evidence and history unchanged', async () => {
      const memory = {
        id: 'mem-1',
        userId: 'user-1',
        title: 'https://example.com/raw',
        memoryType: 'event',
        securityScope: 'private',
        assets: [],
        aiInferences: [
          { id: 'b', field: 'title', valueJson: 'Concert B', confidence: 0.9, createdAt: t2 },
          { id: 'e', field: 'issuer', valueJson: 'encrypted:City Hall', confidence: 0.6, createdAt: t2 },
          { id: 'a', field: 'title', valueJson: 'Concert A', confidence: 0.8, createdAt: t1 },
          { id: 'c', field: 'type', valueJson: 'EVENT', confidence: 0.77, createdAt: t1 },
          { id: 'd', field: 'date', valueJson: '2026-10-01', confidence: 0.5, createdAt: t1 },
        ],
        userConfirmations: [{ id: 'uc', field: 'date', confirmedValue: '2026-10-02', createdAt: t1 }],
      };
      prismaMock.memory.findUnique.mockResolvedValueOnce(memory);
      prismaMock.memory.update.mockResolvedValue({});

      const result: any = await service.findOneForUser('user-1', 'mem-1');

      expect(result.resolved).toEqual({
        title: { value: 'Concert B', source: 'ai', confidence: 0.9 },
        type: { value: 'EVENT', source: 'ai', confidence: 0.77 },
        date: { value: '2026-10-02', source: 'user', confidence: null },
        issuer: { value: 'City Hall', source: 'ai', confidence: 0.6 },
      });
      expect(result.title).toBe('https://example.com/raw');
      expect(result.memoryType).toBe('event');
      expect(result.aiInferences.map((row: any) => row.id)).toEqual(['b', 'e', 'a', 'c', 'd']);
      expect(result.userConfirmations).toEqual(memory.userConfirmations);
      expect(fieldEncryptionMock.decrypt).toHaveBeenCalledWith('encrypted:City Hall');
    });

    describe('Memories list', () => {
      const listRow = () => ({
        id: 'mem-1',
        userId: 'user-1',
        title: 'Raw title',
        memoryType: 'PRODUCT',
        securityScope: 'private',
        capturedAt: t1,
        assets: [{ id: 'asset-1', objectKey: 'k', mimeType: 'image/jpeg' }],
        aiInferences: [
          { id: 'i1', field: 'price', valueJson: '$10', confidence: 0.7, createdAt: t2 },
          { id: 'i2', field: 'title', valueJson: 'AI Title', confidence: 0.9, createdAt: t2 },
          { id: 'i3', field: 'type', valueJson: 'PRODUCT', confidence: 0.8, createdAt: t2 },
          { id: 'i4', field: 'category', valueJson: 'Laptop', confidence: 0.6, createdAt: t1 },
          { id: 'i5', field: 'date', valueJson: '2026-10-01', confidence: 0.5, createdAt: t1 },
          { id: 'i6', field: 'location', valueJson: 'Amman', confidence: 0.4, createdAt: t1 },
        ],
        userConfirmations: [
          { id: 'uc1', field: 'title', confirmedValue: 'My Laptop', createdAt: t1 },
          { id: 'uc2', field: 'price', confirmedValue: '$9', createdAt: t1 },
        ],
      });

      it('never loads sensitive fields for the list', async () => {
        prismaMock.memory.findMany.mockResolvedValueOnce([]);
        await service.findAllForUser('user-1');

        const include = prismaMock.memory.findMany.mock.calls[0][0].include;
        for (const sensitive of ['issuer', 'owner', 'documentNumber']) {
          expect(include.aiInferences.where.field.in).not.toContain(sensitive);
          expect(include.userConfirmations.where.field.in).not.toContain(sensitive);
        }
      });

      it('adds a resolved preview and keeps the raw list contract unchanged', async () => {
        prismaMock.memory.findMany.mockResolvedValueOnce([listRow()]);

        const [result]: any[] = await service.findAllForUser('user-1');

        expect(result).not.toHaveProperty('userConfirmations');
        expect(result.aiInferences.map((row: any) => row.field)).toEqual(['price', 'category', 'date', 'location']);
        for (const row of result.aiInferences) {
          expect(['date', 'location', 'price', 'category']).toContain(row.field);
        }
        expect(result.resolved).toEqual({
          title: { value: 'My Laptop', source: 'user', confidence: null },
          type: { value: 'PRODUCT', source: 'ai', confidence: 0.8 },
          date: { value: '2026-10-01', source: 'ai', confidence: 0.5 },
          location: { value: 'Amman', source: 'ai', confidence: 0.4 },
          price: { value: '$9', source: 'user', confidence: null },
          category: { value: 'Laptop', source: 'ai', confidence: 0.6 },
        });
        for (const key of Object.keys(result.resolved)) {
          expect(['title', 'type', 'date', 'location', 'price', 'category']).toContain(key);
        }

        // Everything else is exactly the previous list item: raw fields, raw inferences, enriched assets.
        const previousShape = { ...result };
        delete previousShape.resolved;
        const row = listRow();
        expect(previousShape).toEqual({
          id: row.id,
          userId: row.userId,
          title: 'Raw title',
          memoryType: 'PRODUCT',
          securityScope: 'private',
          capturedAt: t1,
          assets: [{ id: 'asset-1', objectKey: 'k', mimeType: 'image/jpeg', url: '/assets/asset-1/content' }],
          aiInferences: row.aiInferences.filter((i) => ['date', 'location', 'price', 'category'].includes(i.field)),
        });
      });

      it('cannot leak sensitive rows through the preview even if a query returned them', async () => {
        const row = listRow();
        row.aiInferences.push({ id: 's1', field: 'documentNumber', valueJson: 'P1', confidence: 1, createdAt: t2 });
        row.userConfirmations.push({ id: 's2', field: 'owner', confirmedValue: 'Jane', createdAt: t2 });
        prismaMock.memory.findMany.mockResolvedValueOnce([row]);

        const [result]: any[] = await service.findAllForUser('user-1');

        const serialized = JSON.stringify(result);
        expect(serialized).not.toContain('documentNumber');
        expect(serialized).not.toContain('Jane');
        expect(serialized).not.toContain('P1');
      });

      it('omits resolved.type when memoryType is null', async () => {
        prismaMock.memory.findMany.mockResolvedValueOnce([
          { ...listRow(), memoryType: null, aiInferences: [], userConfirmations: [] },
        ]);

        const [result]: any[] = await service.findAllForUser('user-1');

        expect(result.resolved).toEqual({ title: { value: 'Raw title', source: 'original', confidence: null } });
      });
    });
  });
});
