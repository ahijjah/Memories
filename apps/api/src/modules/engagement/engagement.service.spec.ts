import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
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
  });

  describe('recordFeedback', () => {
    it('should upsert feedback for a memory (creates new feedback)', async () => {
      const userId = 'user-123';
      const memoryId = 'mem-456';
      const feedback = 'useful';
      const mockFeedback = { id: 'fb-1', userId, memoryId, feedback, createdAt: new Date(), updatedAt: new Date() };

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
      const mockUpdatedFeedback = { id: 'fb-1', userId, memoryId, feedback: newFeedback, createdAt: new Date(), updatedAt: new Date() };

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
      const validValues = ['useful', 'not_relevant', 'dont_show_again'];

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
  });
});
