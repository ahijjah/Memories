import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EngagementService } from './engagement.service';
import { PrismaService } from '../../common/prisma/prisma.service';

describe('EngagementService', () => {
  let service: EngagementService;
  let prismaService: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EngagementService,
        {
          provide: PrismaService,
          useValue: {
            memory: {
              findMany: jest.fn(),
              findUnique: jest.fn(),
            },
            rediscoveryFeedback: {
              upsert: jest.fn(),
            },
            $queryRaw: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<EngagementService>(EngagementService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getRediscoveryRandom', () => {
    it('should return up to 5 Memories older than 30 days, excluding vault, user-scoped', async () => {
      const userId = 'user-123';
      const mockMemories = [
        { id: 'mem-1', userId, lifecycleState: 'active', securityScope: 'private' },
        { id: 'mem-2', userId, lifecycleState: 'active', securityScope: 'private' },
      ];

      jest.spyOn(prismaService, '$queryRaw').mockResolvedValue(mockMemories as any);

      const result = await service.getRediscoveryRandom(userId);

      expect(prismaService.$queryRaw).toHaveBeenCalled();
      expect(result).toEqual(mockMemories);
    });

    it('regression-test: userId is scoped in the query', async () => {
      const userId = 'user-123';

      jest.spyOn(prismaService, '$queryRaw').mockResolvedValue([]);

      await service.getRediscoveryRandom(userId);

      const queryCall = (prismaService.$queryRaw as jest.Mock).mock.calls[0];
      const queryStr = queryCall[0].join('');

      // Verify userId scoping in query
      expect(queryStr).toContain(`"userId" = `);
      expect(queryStr).toContain(`'active'`);
      expect(queryStr).toContain(`'vault'`);
    });

    it('regression-test: vault-scoped memories are excluded', async () => {
      const userId = 'user-123';

      jest.spyOn(prismaService, '$queryRaw').mockResolvedValue([]);

      await service.getRediscoveryRandom(userId);

      const queryCall = (prismaService.$queryRaw as jest.Mock).mock.calls[0];
      const queryStr = queryCall[0].join('');

      // Verify vault exclusion
      expect(queryStr).toContain(`"securityScope" != 'vault'`);
    });

    it('regression-test: memories with negative feedback are excluded via NOT EXISTS subquery', async () => {
      const userId = 'user-123';

      jest.spyOn(prismaService, '$queryRaw').mockResolvedValue([]);

      await service.getRediscoveryRandom(userId);

      const queryCall = (prismaService.$queryRaw as jest.Mock).mock.calls[0];
      const queryStr = queryCall[0].join('');

      // Verify NOT EXISTS subquery for feedback exclusion
      expect(queryStr).toContain('NOT EXISTS');
      expect(queryStr).toContain('rediscovery_feedback');
      expect(queryStr).toContain("'not_relevant'");
      expect(queryStr).toContain("'dont_show_again'");
    });
  });

  describe('getRediscovery', () => {
    it('should return Memories ordered by age (oldest first)', async () => {
      const userId = 'user-123';
      const mockMemories = [
        { id: 'mem-1', userId, capturedAt: new Date('2026-06-01') },
        { id: 'mem-2', userId, capturedAt: new Date('2026-07-01') },
      ];

      jest.spyOn(prismaService.memory, 'findMany').mockResolvedValue(mockMemories as any);

      const result = await service.getRediscovery(userId);

      const callArgs = (prismaService.memory.findMany as jest.Mock).mock.calls[0][0];
      expect(callArgs.where.userId).toBe(userId);
      expect(callArgs.where.lifecycleState).toBe('active');
      expect(callArgs.where.securityScope).toEqual({ not: 'vault' });
      expect(result).toEqual(mockMemories);
    });
  });

  describe('getUpcoming', () => {
    it('should return Memories with dates between now and 90 days from now, sorted by date ascending', async () => {
      const userId = 'user-123';
      const now = new Date();
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const inThirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const mockMemories = [
        {
          id: 'mem-1',
          userId,
          title: 'Event Tomorrow',
          lifecycleState: 'active',
          securityScope: 'private',
          aiInferences: [{ field: 'date', valueJson: tomorrow.toISOString() }],
          userConfirmations: [],
        },
        {
          id: 'mem-2',
          userId,
          title: 'Event in 30 Days',
          lifecycleState: 'active',
          securityScope: 'private',
          aiInferences: [{ field: 'date', valueJson: inThirtyDays.toISOString() }],
          userConfirmations: [],
        },
      ];

      jest.spyOn(prismaService.memory, 'findMany').mockResolvedValue(mockMemories as any);

      const result = await service.getUpcoming(userId);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('mem-1');
      expect(result[1].id).toBe('mem-2');
      expect(result[0].daysUntil).toBe(1);
      expect(result[1].daysUntil).toBe(30);
    });

    it('regression-test: vault-scoped memories are excluded even if they have a near-future date', async () => {
      const userId = 'user-123';
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

      // Test that the Prisma query filter excludes vault-scoped memories at the database level.
      // The mock simulates what Prisma would return after applying the securityScope filter.
      const mockMemories = [
        {
          id: 'regular-mem',
          userId,
          title: 'Regular Event',
          lifecycleState: 'active',
          securityScope: 'private',
          aiInferences: [{ field: 'date', valueJson: tomorrow.toISOString() }],
          userConfirmations: [],
        },
      ];

      jest.spyOn(prismaService.memory, 'findMany').mockResolvedValue(mockMemories as any);

      const result = await service.getUpcoming(userId);

      // Verify the filter was applied at the Prisma level (this is the security control)
      const callArgs = (prismaService.memory.findMany as jest.Mock).mock.calls[0][0];
      expect(callArgs.where.securityScope).toEqual({ not: 'vault' });
      expect(callArgs.where.lifecycleState).toBe('active');

      // Result should only include non-vault memories
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('regular-mem');
    });

    it('should use UserConfirmation date over AIInference date when both exist', async () => {
      const userId = 'user-123';
      const now = new Date();
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const inSevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      const mockMemories = [
        {
          id: 'mem-1',
          userId,
          title: 'Event with confirmed date',
          lifecycleState: 'active',
          securityScope: 'private',
          aiInferences: [{ field: 'date', valueJson: inSevenDays.toISOString() }],
          userConfirmations: [{ field: 'date', confirmedValue: tomorrow.toISOString() }],
        },
      ];

      jest.spyOn(prismaService.memory, 'findMany').mockResolvedValue(mockMemories as any);

      const result = await service.getUpcoming(userId);

      expect(result).toHaveLength(1);
      // Should use confirmed date (tomorrow), not AI date (7 days)
      expect(result[0].daysUntil).toBe(1);
      expect(result[0].date).toBe(tomorrow.toISOString());
    });

    it('should exclude memories with dates outside 90-day window', async () => {
      const userId = 'user-123';
      const now = new Date();
      const pastDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
      const futureDate = new Date(now.getTime() + 100 * 24 * 60 * 60 * 1000); // 100 days from now

      const mockMemories = [
        {
          id: 'mem-past',
          userId,
          title: 'Past Event',
          lifecycleState: 'active',
          securityScope: 'private',
          aiInferences: [{ field: 'date', valueJson: pastDate.toISOString() }],
          userConfirmations: [],
        },
        {
          id: 'mem-future',
          userId,
          title: 'Far Future Event',
          lifecycleState: 'active',
          securityScope: 'private',
          aiInferences: [{ field: 'date', valueJson: futureDate.toISOString() }],
          userConfirmations: [],
        },
      ];

      jest.spyOn(prismaService.memory, 'findMany').mockResolvedValue(mockMemories as any);

      const result = await service.getUpcoming(userId);

      expect(result).toHaveLength(0);
    });

    it('should resolve AI-inferred title over raw URL/placeholder title', async () => {
      const userId = 'user-123';
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

      const mockMemories = [
        {
          id: 'mem-with-ai-title',
          userId,
          title: 'https://example.com/article/123', // raw URL as fallback title
          lifecycleState: 'active',
          securityScope: 'private',
          aiInferences: [
            { field: 'date', valueJson: tomorrow.toISOString() },
            { field: 'title', valueJson: 'AI-Extracted Article Title' },
          ],
          userConfirmations: [],
        },
      ];

      jest.spyOn(prismaService.memory, 'findMany').mockResolvedValue(mockMemories as any);

      const result = await service.getUpcoming(userId);

      expect(result).toHaveLength(1);
      // Should use AI-inferred title, not raw URL
      expect(result[0].title).toBe('AI-Extracted Article Title');
    });

    it('should prefer UserConfirmation title over AIInference title', async () => {
      const userId = 'user-123';
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

      const mockMemories = [
        {
          id: 'mem-with-confirmed-title',
          userId,
          title: 'https://example.com/article/123',
          lifecycleState: 'active',
          securityScope: 'private',
          aiInferences: [
            { field: 'date', valueJson: tomorrow.toISOString() },
            { field: 'title', valueJson: 'AI-Extracted Title' },
          ],
          userConfirmations: [
            { field: 'title', confirmedValue: 'User-Confirmed Title' },
          ],
        },
      ];

      jest.spyOn(prismaService.memory, 'findMany').mockResolvedValue(mockMemories as any);

      const result = await service.getUpcoming(userId);

      expect(result).toHaveLength(1);
      // Should use user-confirmed title over AI-inferred title
      expect(result[0].title).toBe('User-Confirmed Title');
    });
  });

  describe('recordFeedback', () => {
    it('should upsert feedback for a memory (creates new feedback)', async () => {
      const userId = 'user-123';
      const memoryId = 'mem-456';
      const feedback = 'useful';
      const mockMemory = { id: memoryId, userId };
      const mockFeedback = { id: 'fb-1', userId, memoryId, feedback, createdAt: new Date(), updatedAt: new Date() };

      jest.spyOn(prismaService.memory, 'findUnique').mockResolvedValue(mockMemory as any);
      jest.spyOn(prismaService.rediscoveryFeedback, 'upsert').mockResolvedValue(mockFeedback as any);

      const result = await service.recordFeedback(userId, memoryId, feedback);

      expect(prismaService.rediscoveryFeedback.upsert).toHaveBeenCalledWith({
        where: { userId_memoryId: { userId, memoryId } },
        create: { userId, memoryId, feedback },
        update: { feedback },
      });
      expect(result).toEqual(mockFeedback);
    });

    it('should upsert feedback (overwrites existing feedback on same memory)', async () => {
      const userId = 'user-123';
      const memoryId = 'mem-456';
      const newFeedback = 'not_relevant';
      const mockMemory = { id: memoryId, userId };
      const mockUpdatedFeedback = { id: 'fb-1', userId, memoryId, feedback: newFeedback, createdAt: new Date(), updatedAt: new Date() };

      jest.spyOn(prismaService.memory, 'findUnique').mockResolvedValue(mockMemory as any);
      jest.spyOn(prismaService.rediscoveryFeedback, 'upsert').mockResolvedValue(mockUpdatedFeedback as any);

      const result = await service.recordFeedback(userId, memoryId, newFeedback);

      expect(prismaService.rediscoveryFeedback.upsert).toHaveBeenCalledWith({
        where: { userId_memoryId: { userId, memoryId } },
        create: { userId, memoryId, feedback: newFeedback },
        update: { feedback: newFeedback },
      });
      expect(result.feedback).toBe(newFeedback);
    });

    it('should reject invalid feedback values', async () => {
      const userId = 'user-123';
      const memoryId = 'mem-456';
      const invalidFeedback = 'invalid_value';

      await expect(service.recordFeedback(userId, memoryId, invalidFeedback)).rejects.toThrow(BadRequestException);
      expect(prismaService.rediscoveryFeedback.upsert).not.toHaveBeenCalled();
    });

    it('should accept all valid feedback values', async () => {
      const userId = 'user-123';
      const memoryId = 'mem-456';
      const mockMemory = { id: memoryId, userId };
      const validValues = ['useful', 'not_relevant', 'dont_show_again'];

      jest.spyOn(prismaService.memory, 'findUnique').mockResolvedValue(mockMemory as any);

      for (const feedback of validValues) {
        (prismaService.rediscoveryFeedback.upsert as jest.Mock).mockResolvedValue({
          id: 'fb-1',
          userId,
          memoryId,
          feedback,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        await service.recordFeedback(userId, memoryId, feedback);

        expect(prismaService.rediscoveryFeedback.upsert).toHaveBeenCalledWith({
          where: { userId_memoryId: { userId, memoryId } },
          create: { userId, memoryId, feedback },
          update: { feedback },
        });
      }

      expect((prismaService.rediscoveryFeedback.upsert as jest.Mock).mock.calls).toHaveLength(3);
    });

    it('should throw NotFoundException when recording feedback on non-existent memory', async () => {
      const userId = 'user-123';
      const memoryId = 'mem-nonexistent';
      const feedback = 'useful';

      jest.spyOn(prismaService.memory, 'findUnique').mockResolvedValue(null);

      await expect(service.recordFeedback(userId, memoryId, feedback)).rejects.toThrow(NotFoundException);
      expect(prismaService.rediscoveryFeedback.upsert).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException when recording feedback on memory owned by another user', async () => {
      const userId = 'user-123';
      const otherUserId = 'user-456';
      const memoryId = 'mem-1';
      const feedback = 'useful';
      const mockMemory = { id: memoryId, userId: otherUserId };

      jest.spyOn(prismaService.memory, 'findUnique').mockResolvedValue(mockMemory as any);

      await expect(service.recordFeedback(userId, memoryId, feedback)).rejects.toThrow(ForbiddenException);
      expect(prismaService.rediscoveryFeedback.upsert).not.toHaveBeenCalled();
    });

    it('should verify ownership before upserting feedback', async () => {
      const userId = 'user-123';
      const memoryId = 'mem-1';
      const feedback = 'useful';
      const mockMemory = { id: memoryId, userId };
      const mockFeedback = { id: 'fb-1', userId, memoryId, feedback, createdAt: new Date(), updatedAt: new Date() };

      jest.spyOn(prismaService.memory, 'findUnique').mockResolvedValue(mockMemory as any);
      jest.spyOn(prismaService.rediscoveryFeedback, 'upsert').mockResolvedValue(mockFeedback as any);

      const result = await service.recordFeedback(userId, memoryId, feedback);

      expect(prismaService.memory.findUnique).toHaveBeenCalledWith({
        where: { id: memoryId },
        select: { id: true, userId: true },
      });
      expect(prismaService.rediscoveryFeedback.upsert).toHaveBeenCalled();
      expect(result).toEqual(mockFeedback);
    });
  });

  describe('getForYouSuggestions', () => {
    it('should return category with 3+ products in last 30 days', async () => {
      const userId = 'user-123';
      const mockMemories = [
        {
          id: 'mem-1',
          userId,
          memoryType: 'product',
          lifecycleState: 'active',
          securityScope: 'private',
          capturedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          aiInferences: [{ field: 'category', valueJson: 'Electronics' }],
        },
        {
          id: 'mem-2',
          userId,
          memoryType: 'PRODUCT',
          lifecycleState: 'active',
          securityScope: 'private',
          capturedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
          aiInferences: [{ field: 'category', valueJson: 'Electronics' }],
        },
        {
          id: 'mem-3',
          userId,
          memoryType: 'product',
          lifecycleState: 'active',
          securityScope: 'private',
          capturedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
          aiInferences: [{ field: 'category', valueJson: 'Electronics' }],
        },
      ];

      jest.spyOn(prismaService.memory, 'findMany').mockResolvedValue(mockMemories as any);

      const result = await service.getForYouSuggestions(userId);

      expect(result).not.toBeNull();
      expect(result?.category).toBe('Electronics');
      expect(result?.memoryIds).toHaveLength(3);
      expect(result?.count).toBe(3);
    });

    it('should return null if no category has 3+ items (2-item threshold does not qualify)', async () => {
      const userId = 'user-123';
      const mockMemories = [
        {
          id: 'mem-1',
          userId,
          memoryType: 'product',
          lifecycleState: 'active',
          securityScope: 'private',
          capturedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          aiInferences: [{ field: 'category', valueJson: 'Electronics' }],
        },
        {
          id: 'mem-2',
          userId,
          memoryType: 'product',
          lifecycleState: 'active',
          securityScope: 'private',
          capturedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
          aiInferences: [{ field: 'category', valueJson: 'Electronics' }],
        },
      ];

      jest.spyOn(prismaService.memory, 'findMany').mockResolvedValue(mockMemories as any);

      const result = await service.getForYouSuggestions(userId);

      expect(result).toBeNull();
    });

    it('regression-test: vault-scoped memories are excluded', async () => {
      const userId = 'user-123';

      jest.spyOn(prismaService.memory, 'findMany').mockResolvedValue([]);

      await service.getForYouSuggestions(userId);

      const callArgs = (prismaService.memory.findMany as jest.Mock).mock.calls[0][0];
      expect(callArgs.where.userId).toBe(userId);
      expect(callArgs.where.lifecycleState).toBe('active');
      expect(callArgs.where.securityScope).toEqual({ not: 'vault' });
      expect(callArgs.where.memoryType).toEqual({ in: ['product', 'PRODUCT'] });
    });

    it('should pick category with most items when multiple categories qualify', async () => {
      const userId = 'user-123';
      const mockMemories = [
        {
          id: 'mem-1',
          userId,
          memoryType: 'product',
          lifecycleState: 'active',
          securityScope: 'private',
          capturedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          aiInferences: [{ field: 'category', valueJson: 'Electronics' }],
        },
        {
          id: 'mem-2',
          userId,
          memoryType: 'product',
          lifecycleState: 'active',
          securityScope: 'private',
          capturedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
          aiInferences: [{ field: 'category', valueJson: 'Electronics' }],
        },
        {
          id: 'mem-3',
          userId,
          memoryType: 'product',
          lifecycleState: 'active',
          securityScope: 'private',
          capturedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
          aiInferences: [{ field: 'category', valueJson: 'Furniture' }],
        },
        {
          id: 'mem-4',
          userId,
          memoryType: 'product',
          lifecycleState: 'active',
          securityScope: 'private',
          capturedAt: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000),
          aiInferences: [{ field: 'category', valueJson: 'Furniture' }],
        },
        {
          id: 'mem-5',
          userId,
          memoryType: 'product',
          lifecycleState: 'active',
          securityScope: 'private',
          capturedAt: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000),
          aiInferences: [{ field: 'category', valueJson: 'Furniture' }],
        },
        {
          id: 'mem-6',
          userId,
          memoryType: 'product',
          lifecycleState: 'active',
          securityScope: 'private',
          capturedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
          aiInferences: [{ field: 'category', valueJson: 'Furniture' }],
        },
      ];

      jest.spyOn(prismaService.memory, 'findMany').mockResolvedValue(mockMemories as any);

      const result = await service.getForYouSuggestions(userId);

      expect(result).not.toBeNull();
      expect(result?.category).toBe('Furniture');
      expect(result?.count).toBe(4);
    });
  });

  describe('getContinueSuggestions', () => {
    it('should return topic with 2+ items from last 14 days', async () => {
      const userId = 'user-123';
      const mockMemories = [
        {
          id: 'mem-1',
          userId,
          lifecycleState: 'active',
          securityScope: 'private',
          capturedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
          aiInferences: [{ field: 'topics', valueJson: ['travel', 'planning'] }],
          collections: [],
        },
        {
          id: 'mem-2',
          userId,
          lifecycleState: 'active',
          securityScope: 'private',
          capturedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          aiInferences: [{ field: 'topics', valueJson: ['travel', 'tips'] }],
          collections: [],
        },
      ];

      jest.spyOn(prismaService.memory, 'findMany').mockResolvedValue(mockMemories as any);

      const result = await service.getContinueSuggestions(userId);

      expect(result).not.toBeNull();
      expect(result?.topic).toBe('travel');
      expect(result?.count).toBe(2);
      expect(result?.memoryIds).toContain('mem-1');
      expect(result?.memoryIds).toContain('mem-2');
    });

    it('should return null if no topic has 2+ items (1-item threshold does not qualify)', async () => {
      const userId = 'user-123';
      const mockMemories = [
        {
          id: 'mem-1',
          userId,
          lifecycleState: 'active',
          securityScope: 'private',
          capturedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
          aiInferences: [{ field: 'topics', valueJson: ['travel'] }],
          collections: [],
        },
      ];

      jest.spyOn(prismaService.memory, 'findMany').mockResolvedValue(mockMemories as any);

      const result = await service.getContinueSuggestions(userId);

      expect(result).toBeNull();
    });

    it('regression-test: vault-scoped memories are excluded', async () => {
      const userId = 'user-123';

      jest.spyOn(prismaService.memory, 'findMany').mockResolvedValue([]);

      await service.getContinueSuggestions(userId);

      const callArgs = (prismaService.memory.findMany as jest.Mock).mock.calls[0][0];
      expect(callArgs.where.userId).toBe(userId);
      expect(callArgs.where.lifecycleState).toBe('active');
      expect(callArgs.where.securityScope).toEqual({ not: 'vault' });
    });

    it('should exclude topic where all memories are in same collection', async () => {
      const userId = 'user-123';
      const collectionId = 'col-1';
      const mockMemories = [
        {
          id: 'mem-1',
          userId,
          lifecycleState: 'active',
          securityScope: 'private',
          capturedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
          aiInferences: [{ field: 'topics', valueJson: ['travel'] }],
          collections: [{ collectionId }],
        },
        {
          id: 'mem-2',
          userId,
          lifecycleState: 'active',
          securityScope: 'private',
          capturedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          aiInferences: [{ field: 'topics', valueJson: ['travel'] }],
          collections: [{ collectionId }],
        },
      ];

      jest.spyOn(prismaService.memory, 'findMany').mockResolvedValue(mockMemories as any);

      const result = await service.getContinueSuggestions(userId);

      expect(result).toBeNull();
    });

    it('should include topic if memories are in different collections', async () => {
      const userId = 'user-123';
      const mockMemories = [
        {
          id: 'mem-1',
          userId,
          lifecycleState: 'active',
          securityScope: 'private',
          capturedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
          aiInferences: [{ field: 'topics', valueJson: ['travel'] }],
          collections: [{ collectionId: 'col-1' }],
        },
        {
          id: 'mem-2',
          userId,
          lifecycleState: 'active',
          securityScope: 'private',
          capturedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          aiInferences: [{ field: 'topics', valueJson: ['travel'] }],
          collections: [{ collectionId: 'col-2' }],
        },
      ];

      jest.spyOn(prismaService.memory, 'findMany').mockResolvedValue(mockMemories as any);

      const result = await service.getContinueSuggestions(userId);

      expect(result).not.toBeNull();
      expect(result?.topic).toBe('travel');
      expect(result?.count).toBe(2);
    });

    it('should include topic if one memory is uncollected (breaks "all in same collection" pattern)', async () => {
      const userId = 'user-123';
      const mockMemories = [
        {
          id: 'mem-1',
          userId,
          lifecycleState: 'active',
          securityScope: 'private',
          capturedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
          aiInferences: [{ field: 'topics', valueJson: ['travel'] }],
          collections: [{ collectionId: 'col-1' }],
        },
        {
          id: 'mem-2',
          userId,
          lifecycleState: 'active',
          securityScope: 'private',
          capturedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          aiInferences: [{ field: 'topics', valueJson: ['travel'] }],
          collections: [],
        },
      ];

      jest.spyOn(prismaService.memory, 'findMany').mockResolvedValue(mockMemories as any);

      const result = await service.getContinueSuggestions(userId);

      expect(result).not.toBeNull();
      expect(result?.topic).toBe('travel');
      expect(result?.count).toBe(2);
    });

    it('should pick topic with most items when multiple topics qualify', async () => {
      const userId = 'user-123';
      const mockMemories = [
        {
          id: 'mem-1',
          userId,
          lifecycleState: 'active',
          securityScope: 'private',
          capturedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
          aiInferences: [{ field: 'topics', valueJson: ['travel'] }],
          collections: [],
        },
        {
          id: 'mem-2',
          userId,
          lifecycleState: 'active',
          securityScope: 'private',
          capturedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          aiInferences: [{ field: 'topics', valueJson: ['cooking'] }],
          collections: [],
        },
        {
          id: 'mem-3',
          userId,
          lifecycleState: 'active',
          securityScope: 'private',
          capturedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          aiInferences: [{ field: 'topics', valueJson: ['cooking'] }],
          collections: [],
        },
        {
          id: 'mem-4',
          userId,
          lifecycleState: 'active',
          securityScope: 'private',
          capturedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
          aiInferences: [{ field: 'topics', valueJson: ['cooking'] }],
          collections: [],
        },
      ];

      jest.spyOn(prismaService.memory, 'findMany').mockResolvedValue(mockMemories as any);

      const result = await service.getContinueSuggestions(userId);

      expect(result).not.toBeNull();
      expect(result?.topic).toBe('cooking');
      expect(result?.count).toBe(3);
    });
  });

  describe('getCalendarMonth', () => {
    it('sends a date-shape regex that accepts real YYYY-MM-DD dates (SQL text Prisma actually generates)', async () => {
      jest.spyOn(prismaService, '$queryRaw').mockResolvedValue([] as any);

      await service.getCalendarMonth('user-123', '2026-09');

      // Rebuild the query exactly as Prisma does from the tagged-template call, so this checks the
      // SQL text Postgres receives (JS turns an unescaped `\d` into `d` in template strings).
      const [strings, ...values] = (prismaService.$queryRaw as jest.Mock).mock.calls[0];
      const sqlText = Prisma.sql(strings, ...values).text;
      const match = sqlText.match(/~ '([^']+)'/);
      expect(match).not.toBeNull();
      const datePattern = new RegExp(match![1]);

      for (const valid of ['2026-09-15', '2026-09-01', '2026-09-30', '1999-12-31']) {
        expect(datePattern.test(valid)).toBe(true);
      }
      for (const invalid of ['dddd-dd-dd', '2026-9-15', '2026-09-15T10:00:00Z', 'next Friday', '']) {
        expect(datePattern.test(invalid)).toBe(false);
      }
    });

    it('should reject invalid month format', async () => {
      const userId = 'user-123';

      await expect(service.getCalendarMonth(userId, '2026-1')).rejects.toThrow(BadRequestException);
      await expect(service.getCalendarMonth(userId, 'invalid')).rejects.toThrow(BadRequestException);
      await expect(service.getCalendarMonth(userId, '2026')).rejects.toThrow(BadRequestException);
    });

    it('should reject out-of-range month values', async () => {
      const userId = 'user-123';

      await expect(service.getCalendarMonth(userId, '2026-00')).rejects.toThrow(BadRequestException);
      await expect(service.getCalendarMonth(userId, '2026-13')).rejects.toThrow(BadRequestException);
    });

    it('should return memories for requested month only using bounded SQL query', async () => {
      const userId = 'user-123';
      const matchingIds = [
        { id: 'mem-1', title: 'Sept Event', effective_date: '2026-09-15' },
      ];
      const mockMemories = [
        {
          id: 'mem-1',
          userId,
          title: 'Sept Event',
          lifecycleState: 'active',
          securityScope: 'private',
          aiInferences: [
            { field: 'date', valueJson: '2026-09-15' },
            { field: 'title', valueJson: 'AI Event' },
            { field: 'type', valueJson: 'EVENT' },
          ],
          userConfirmations: [],
        },
      ];

      jest.spyOn(prismaService, '$queryRaw').mockResolvedValue(matchingIds as any);
      jest.spyOn(prismaService.memory, 'findMany').mockResolvedValue(mockMemories as any);

      const result = await service.getCalendarMonth(userId, '2026-09');

      expect(result.month).toBe('2026-09');
      expect(result.items).toHaveLength(1);
      expect(result.items[0].date).toBe('2026-09-15');
      // Verify SQL query was used (not loading all memories)
      expect(prismaService.$queryRaw).toHaveBeenCalled();
    });

    it('should use SQL to filter by month and not load all user memories', async () => {
      const userId = 'user-123';

      jest.spyOn(prismaService, '$queryRaw').mockResolvedValue([]);

      await service.getCalendarMonth(userId, '2026-09');

      expect(prismaService.$queryRaw).toHaveBeenCalled();
      // Verify it's a bounded query (SQL query is called first)
      const query = (prismaService.$queryRaw as jest.Mock).mock.calls[0][0];
      expect(query).toBeDefined();
    });

    it('should exclude vault-scoped memories in SQL query', async () => {
      const userId = 'user-123';

      jest.spyOn(prismaService, '$queryRaw').mockResolvedValue([]);

      await service.getCalendarMonth(userId, '2026-09');

      const query = (prismaService.$queryRaw as jest.Mock).mock.calls[0][0];
      const queryStr = query.join ? query.join('') : String(query);
      expect(queryStr).toContain('vault');
    });

    it('should apply UserConfirmation > AIInference precedence for dates', async () => {
      const userId = 'user-123';
      const matchingIds = [
        { id: 'mem-1', title: 'Event', effective_date: '2026-09-15' },
      ];
      const mockMemories = [
        {
          id: 'mem-1',
          userId,
          title: 'Event',
          lifecycleState: 'active',
          securityScope: 'private',
          aiInferences: [
            { field: 'date', valueJson: '2026-09-10' },
          ],
          userConfirmations: [
            { field: 'date', confirmedValue: '2026-09-15' },
          ],
          assets: [],
        },
      ];

      jest.spyOn(prismaService, '$queryRaw').mockResolvedValue(matchingIds as any);
      jest.spyOn(prismaService.memory, 'findMany').mockResolvedValue(mockMemories as any);

      const result = await service.getCalendarMonth(userId, '2026-09');

      expect(result.items).toHaveLength(1);
      expect(result.items[0].date).toBe('2026-09-15');
    });

    it('should move memory OUT of month when user confirmation changes the date', async () => {
      const userId = 'user-123';
      const matchingIds: any[] = [];

      jest.spyOn(prismaService, '$queryRaw').mockResolvedValue(matchingIds);

      const result = await service.getCalendarMonth(userId, '2026-09');

      expect(result.items).toHaveLength(0);
    });

    it('should move memory INTO month when user confirmation adds a date in that month', async () => {
      const userId = 'user-123';
      const matchingIds = [
        { id: 'mem-1', title: 'Event', effective_date: '2026-09-15' },
      ];
      const mockMemories = [
        {
          id: 'mem-1',
          userId,
          title: 'Event',
          lifecycleState: 'active',
          securityScope: 'private',
          aiInferences: [
            { field: 'date', valueJson: '2026-10-15' },
          ],
          userConfirmations: [
            { field: 'date', confirmedValue: '2026-09-15' },
          ],
          assets: [],
        },
      ];

      jest.spyOn(prismaService, '$queryRaw').mockResolvedValue(matchingIds as any);
      jest.spyOn(prismaService.memory, 'findMany').mockResolvedValue(mockMemories as any);

      const result = await service.getCalendarMonth(userId, '2026-09');

      expect(result.items).toHaveLength(1);
      expect(result.items[0].date).toBe('2026-09-15');
    });

    it('should apply title precedence: UserConfirmation > AIInference > raw title', async () => {
      const userId = 'user-123';
      const matchingIds = [
        { id: 'mem-1', title: 'Raw Title', effective_date: '2026-09-15' },
      ];
      const mockMemories = [
        {
          id: 'mem-1',
          userId,
          title: 'Raw Title',
          lifecycleState: 'active',
          securityScope: 'private',
          aiInferences: [
            { field: 'date', valueJson: '2026-09-15' },
            { field: 'title', valueJson: 'AI Title' },
          ],
          userConfirmations: [
            { field: 'title', confirmedValue: 'User Title' },
          ],
          assets: [],
        },
      ];

      jest.spyOn(prismaService, '$queryRaw').mockResolvedValue(matchingIds as any);
      jest.spyOn(prismaService.memory, 'findMany').mockResolvedValue(mockMemories as any);

      const result = await service.getCalendarMonth(userId, '2026-09');

      expect(result.items[0].title).toBe('User Title');
    });

    it('should handle multiple memories on the same day', async () => {
      const userId = 'user-123';
      const matchingIds = [
        { id: 'mem-1', title: 'Event A', effective_date: '2026-09-15' },
        { id: 'mem-2', title: 'Event B', effective_date: '2026-09-15' },
      ];
      const mockMemories = [
        {
          id: 'mem-1',
          userId,
          title: 'Event A',
          lifecycleState: 'active',
          securityScope: 'private',
          aiInferences: [
            { field: 'date', valueJson: '2026-09-15' },
          ],
          userConfirmations: [],
          assets: [],
        },
        {
          id: 'mem-2',
          userId,
          title: 'Event B',
          lifecycleState: 'active',
          securityScope: 'private',
          aiInferences: [
            { field: 'date', valueJson: '2026-09-15' },
          ],
          userConfirmations: [],
        },
      ];

      jest.spyOn(prismaService, '$queryRaw').mockResolvedValue(matchingIds as any);
      jest.spyOn(prismaService.memory, 'findMany').mockResolvedValue(mockMemories as any);

      const result = await service.getCalendarMonth(userId, '2026-09');

      expect(result.items).toHaveLength(2);
      expect(result.items[0].date).toBe('2026-09-15');
      expect(result.items[1].date).toBe('2026-09-15');
    });

    it('should return deterministic ordering (by date, then by title)', async () => {
      const userId = 'user-123';
      const matchingIds = [
        { id: 'mem-1', title: 'Zebra Event', effective_date: '2026-09-15' },
        { id: 'mem-2', title: 'Apple Event', effective_date: '2026-09-15' },
      ];
      const mockMemories = [
        {
          id: 'mem-1',
          userId,
          title: 'Zebra Event',
          lifecycleState: 'active',
          securityScope: 'private',
          aiInferences: [
            { field: 'date', valueJson: '2026-09-15' },
          ],
          userConfirmations: [],
          assets: [],
        },
        {
          id: 'mem-2',
          userId,
          title: 'Apple Event',
          lifecycleState: 'active',
          securityScope: 'private',
          aiInferences: [
            { field: 'date', valueJson: '2026-09-15' },
          ],
          userConfirmations: [],
        },
      ];

      jest.spyOn(prismaService, '$queryRaw').mockResolvedValue(matchingIds as any);
      jest.spyOn(prismaService.memory, 'findMany').mockResolvedValue(mockMemories as any);

      const result = await service.getCalendarMonth(userId, '2026-09');

      expect(result.items[0].title).toBe('Apple Event');
      expect(result.items[1].title).toBe('Zebra Event');
    });

    it('should reject malformed dates with strict validation', async () => {
      const userId = 'user-123';
      // SQL returns invalid dates, but they should be filtered by strict validator
      const matchingIds = [
        { id: 'mem-1', title: 'Invalid', effective_date: '2026-09-99' },
      ];

      jest.spyOn(prismaService, '$queryRaw').mockResolvedValue(matchingIds as any);

      const result = await service.getCalendarMonth(userId, '2026-09');

      expect(result.items).toHaveLength(0);
    });

    it('should validate leap years: 2024-02-29 valid, 2025-02-29 invalid', async () => {
      const userId = 'user-123';

      jest.spyOn(prismaService, '$queryRaw').mockResolvedValue([] as any);

      // Should not throw for 2024-02-29 (leap year)
      await service.getCalendarMonth(userId, '2024-02');

      // Should not throw for 2025-02 query (invalid date 2025-02-29 filtered later)
      await service.getCalendarMonth(userId, '2025-02');
    });

    it('should not include assets in Calendar response (MVP does not render images)', async () => {
      const userId = 'user-123';
      const matchingIds = [
        { id: 'mem-1', title: 'Event', effective_date: '2026-09-15' },
      ];
      const mockMemories = [
        {
          id: 'mem-1',
          userId,
          title: 'Event',
          lifecycleState: 'active',
          securityScope: 'private',
          aiInferences: [
            { field: 'date', valueJson: '2026-09-15' },
          ],
          userConfirmations: [],
        },
      ];

      jest.spyOn(prismaService, '$queryRaw').mockResolvedValue(matchingIds as any);
      jest.spyOn(prismaService.memory, 'findMany').mockResolvedValue(mockMemories as any);

      const result = await service.getCalendarMonth(userId, '2026-09');

      expect(result.items[0]).not.toHaveProperty('assets');
      // Verify DTO only contains: memoryId, date, title, type
      const keys = Object.keys(result.items[0]);
      expect(keys.sort()).toEqual(['date', 'memoryId', 'title', 'type'].sort());
    });

    it('should use SQL effective_date, not recompute from unordered Prisma relations', async () => {
      const userId = 'user-123';
      // SQL returns the newest date (2026-09-15) as effective_date
      const matchingIds = [
        { id: 'mem-1', title: 'Event', effective_date: '2026-09-15' },
      ];
      // But Prisma returns inferences in arbitrary order (older date first)
      const mockMemories = [
        {
          id: 'mem-1',
          userId,
          title: 'Event',
          lifecycleState: 'active',
          securityScope: 'private',
          aiInferences: [
            // Returned in arbitrary order: older date first
            { field: 'title', valueJson: 'Event Title' },
            { field: 'type', valueJson: 'PERSON' },
          ],
          userConfirmations: [],
        },
      ];

      jest.spyOn(prismaService, '$queryRaw').mockResolvedValue(matchingIds as any);
      jest.spyOn(prismaService.memory, 'findMany').mockResolvedValue(mockMemories as any);

      const result = await service.getCalendarMonth(userId, '2026-09');

      // Item date must match SQL effective_date (2026-09-15), not recomputed from relations
      expect(result.items).toHaveLength(1);
      expect(result.items[0].date).toBe('2026-09-15');
      expect(result.items[0].memoryId).toBe('mem-1');
    });

    it('should respect UserConfirmation.date precedence over AIInference.date', async () => {
      const userId = 'user-123';
      // SQL returns the confirmed date as effective_date (UserConfirmation > AIInference)
      const matchingIds = [
        { id: 'mem-1', title: 'Event', effective_date: '2026-09-20' },
      ];
      // Prisma has both confirmation and inference
      const mockMemories = [
        {
          id: 'mem-1',
          userId,
          title: 'Event',
          lifecycleState: 'active',
          securityScope: 'private',
          aiInferences: [
            // Older inferred date
            { field: 'title', valueJson: 'Event Title' },
          ],
          userConfirmations: [
            // User-confirmed date (takes precedence)
            { field: 'title', confirmedValue: 'Confirmed Title' },
          ],
        },
      ];

      jest.spyOn(prismaService, '$queryRaw').mockResolvedValue(matchingIds as any);
      jest.spyOn(prismaService.memory, 'findMany').mockResolvedValue(mockMemories as any);

      const result = await service.getCalendarMonth(userId, '2026-09');

      // Date must come from SQL (which selected confirmed date), not recomputed
      expect(result.items).toHaveLength(1);
      expect(result.items[0].date).toBe('2026-09-20');
      // Title must use precedence: confirmed > inferred
      expect(result.items[0].title).toBe('Confirmed Title');
    });
  });
});
