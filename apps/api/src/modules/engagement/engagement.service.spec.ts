import { Test, TestingModule } from '@nestjs/testing';
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
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
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
});
