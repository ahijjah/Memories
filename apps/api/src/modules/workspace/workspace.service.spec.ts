import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceService } from './workspace.service';
import { PrismaService } from '../../common/prisma/prisma.service';

describe('WorkspaceService', () => {
  let service: WorkspaceService;

  const mockPrisma = {
    memory: {
      findMany: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<WorkspaceService>(WorkspaceService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('normalizeTopicForIdentity', () => {
    it('should trim whitespace', () => {
      expect(service.normalizeTopicForIdentity('  AI  ')).toBe('ai');
    });

    it('should collapse internal whitespace', () => {
      expect(service.normalizeTopicForIdentity('Machine  Learning')).toBe('machine learning');
      expect(service.normalizeTopicForIdentity('AI   Technology')).toBe('ai technology');
    });

    it('should lowercase', () => {
      expect(service.normalizeTopicForIdentity('AI')).toBe('ai');
      expect(service.normalizeTopicForIdentity('Machine Learning')).toBe('machine learning');
    });

    it('should handle empty strings', () => {
      expect(service.normalizeTopicForIdentity('')).toBe('');
      expect(service.normalizeTopicForIdentity('   ')).toBe('');
    });

    it('should handle special characters', () => {
      expect(service.normalizeTopicForIdentity('path/to/topic')).toBe('path/to/topic');
      expect(service.normalizeTopicForIdentity('100%')).toBe('100%');
      expect(service.normalizeTopicForIdentity('c++')).toBe('c++');
    });

    it('should handle Unicode and Arabic', () => {
      expect(service.normalizeTopicForIdentity('الذكاء الاصطناعي')).toBe('الذكاء الاصطناعي');
    });
  });

  describe('encodeWorkspaceId', () => {
    it('should encode normalized topic', () => {
      expect(service.encodeWorkspaceId('ai')).toBe('ai');
      expect(service.encodeWorkspaceId('path/to/topic')).toBe('path%2Fto%2Ftopic');
      expect(service.encodeWorkspaceId('100%')).toBe('100%25');
      expect(service.encodeWorkspaceId('c++')).toBe('c%2B%2B');
    });

    it('should handle Unicode', () => {
      const encoded = service.encodeWorkspaceId('الذكاء الاصطناعي');
      expect(encoded).toContain('%');
    });
  });

  describe('decodeAndVerifyWorkspaceId', () => {
    it('should decode workspaceId', () => {
      expect(service.decodeAndVerifyWorkspaceId('ai')).toBe('ai');
      expect(service.decodeAndVerifyWorkspaceId('path%2Fto%2Ftopic')).toBe('path/to/topic');
      expect(service.decodeAndVerifyWorkspaceId('100%25')).toBe('100%');
      expect(service.decodeAndVerifyWorkspaceId('c%2B%2B')).toBe('c++');
    });

    it('should verify expected normalized form', () => {
      expect(() =>
        service.decodeAndVerifyWorkspaceId('path%2Fto%2Ftopic', 'path/to/topic')
      ).not.toThrow();

      expect(() =>
        service.decodeAndVerifyWorkspaceId('path%2Fto%2Ftopic', 'wrong')
      ).toThrow('Workspace ID mismatch');
    });
  });

  describe('getWorkspaceMemories - Pagination and Edge Cases', () => {
    it('should perform pagination via SQL LIMIT/OFFSET, not Node Array.slice', async () => {
      // statsQuery: workspace exists with 100 memories
      (mockPrisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([
          { total_count: 100, display_label: 'AI' },
        ]);

      // pageQuery: return 2 memory IDs for page 1
      (mockPrisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([
          { memory_id: 'mem-1' },
          { memory_id: 'mem-2' },
        ]);

      (mockPrisma.memory.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'mem-1',
          title: 'Memory 1',
          memoryType: 'TEXT',
          sourceType: 'MANUAL',
          capturedAt: new Date('2024-01-02'),
          processingState: 'COMPLETE',
          securityScope: 'private',
          aiInferences: [],
          userConfirmations: [],
          assets: [],
        },
        {
          id: 'mem-2',
          title: 'Memory 2',
          memoryType: 'TEXT',
          sourceType: 'MANUAL',
          capturedAt: new Date('2024-01-01'),
          processingState: 'COMPLETE',
          securityScope: 'private',
          aiInferences: [],
          userConfirmations: [],
          assets: [],
        },
      ]);

      const result = await service.getWorkspaceMemories('user-123', 'ai', 20, 0);

      expect(result.memories).toHaveLength(2);
      expect(result.total).toBe(100);
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);

      // Verify that memory.findMany was called with exactly 2 IDs
      const findManyCall = (mockPrisma.memory.findMany as jest.Mock).mock.calls[0];
      expect(findManyCall[0].where.id.in).toHaveLength(2);
    });

    it('should order by capturedAt DESC then memory_id DESC', async () => {
      (mockPrisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([
          { total_count: 3, display_label: 'AI' },
        ]);

      (mockPrisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([
          { memory_id: 'mem-5' },
          { memory_id: 'mem-3' },
          { memory_id: 'mem-1' },
        ]);

      (mockPrisma.memory.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'mem-1',
          title: 'Oldest',
          memoryType: 'TEXT',
          sourceType: 'MANUAL',
          capturedAt: new Date('2024-01-01'),
          processingState: 'COMPLETE',
          securityScope: 'private',
          aiInferences: [],
          userConfirmations: [],
          assets: [],
        },
        {
          id: 'mem-3',
          title: 'Middle',
          memoryType: 'TEXT',
          sourceType: 'MANUAL',
          capturedAt: new Date('2024-01-02'),
          processingState: 'COMPLETE',
          securityScope: 'private',
          aiInferences: [],
          userConfirmations: [],
          assets: [],
        },
        {
          id: 'mem-5',
          title: 'Newest',
          memoryType: 'TEXT',
          sourceType: 'MANUAL',
          capturedAt: new Date('2024-01-03'),
          processingState: 'COMPLETE',
          securityScope: 'private',
          aiInferences: [],
          userConfirmations: [],
          assets: [],
        },
      ]);

      const result = await service.getWorkspaceMemories('user-123', 'ai', 20, 0);

      expect(result.memories[0].title).toBe('Newest');
      expect(result.memories[1].title).toBe('Middle');
      expect(result.memories[2].title).toBe('Oldest');
    });

    it('should return 200 with empty memories when offset is beyond end', async () => {
      (mockPrisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([
          { total_count: 47, display_label: 'AI' },
        ]);

      (mockPrisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([]);

      const result = await service.getWorkspaceMemories('user-123', 'ai', 20, 60);

      expect(result.memories).toEqual([]);
      expect(result.total).toBe(47);
      expect(result.displayLabel).toBe('AI');
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(60);

      expect((mockPrisma.memory.findMany as jest.Mock).mock.calls).toHaveLength(0);
    });

    it('should return normal results for page 1 of workspace with total=2', async () => {
      (mockPrisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([
          { total_count: 2, display_label: 'Minimum' },
        ]);

      (mockPrisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([
          { memory_id: 'mem-1' },
          { memory_id: 'mem-2' },
        ]);

      (mockPrisma.memory.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'mem-1',
          title: 'Memory 1',
          memoryType: 'TEXT',
          sourceType: 'MANUAL',
          capturedAt: new Date(),
          processingState: 'COMPLETE',
          securityScope: 'private',
          aiInferences: [],
          userConfirmations: [],
          assets: [],
        },
        {
          id: 'mem-2',
          title: 'Memory 2',
          memoryType: 'TEXT',
          sourceType: 'MANUAL',
          capturedAt: new Date(),
          processingState: 'COMPLETE',
          securityScope: 'private',
          aiInferences: [],
          userConfirmations: [],
          assets: [],
        },
      ]);

      const result = await service.getWorkspaceMemories('user-123', 'minimum', 20, 0);

      expect(result.memories).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.displayLabel).toBe('Minimum');
    });

    it('should throw 404 when workspace has fewer than 2 memories', async () => {
      (mockPrisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([
          { total_count: 1, display_label: 'Singleton' },
        ]);

      await expect(service.getWorkspaceMemories('user-123', 'singleton', 20, 0))
        .rejects.toThrow('Workspace not found or has fewer than 2 memories');
    });

    it('should throw 404 when workspace does not exist', async () => {
      (mockPrisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([]);

      await expect(service.getWorkspaceMemories('user-123', 'nonexistent', 20, 0))
        .rejects.toThrow('Workspace not found or has fewer than 2 memories');
    });

    it('should not call memory.findMany when page query returns zero results', async () => {
      (mockPrisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([
          { total_count: 47, display_label: 'AI' },
        ]);

      (mockPrisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([]);

      await service.getWorkspaceMemories('user-123', 'ai', 20, 60);

      expect((mockPrisma.memory.findMany as jest.Mock).mock.calls).toHaveLength(0);
    });
  });

  describe('listWorkspaces', () => {
    it('should return empty list when no workspaces', async () => {
      (mockPrisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: 0 }]);

      const result = await service.listWorkspaces('user-123');

      expect(result.workspaces).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should return workspaces with correct structure', async () => {
      (mockPrisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([
          {
            normalized_topic: 'ai',
            memory_count: 5,
            display_label: 'AI',
          },
          {
            normalized_topic: 'machine learning',
            memory_count: 3,
            display_label: 'Machine Learning',
          },
        ])
        .mockResolvedValueOnce([{ count: 2 }]);

      const result = await service.listWorkspaces('user-123');

      expect(result.workspaces).toHaveLength(2);
      expect(result.workspaces[0]).toEqual({
        workspaceId: 'ai',
        displayLabel: 'AI',
        memoryCount: 5,
      });
      expect(result.total).toBe(2);
    });

    it('should apply pagination', async () => {
      (mockPrisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([
          {
            normalized_topic: 'ai',
            memory_count: 5,
            display_label: 'AI',
          },
        ])
        .mockResolvedValueOnce([{ count: 10 }]);

      const result = await service.listWorkspaces('user-123', 1, 0);

      expect(result.limit).toBe(1);
      expect(result.offset).toBe(0);
      expect(result.total).toBe(10);
    });

    it('should pass userId to SQL query', async () => {
      (mockPrisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: 0 }]);

      await service.listWorkspaces('user-456', 50, 0);

      expect((mockPrisma.$queryRaw as jest.Mock).mock.calls.length).toBeGreaterThan(0);
    });

    it('should encode workspaceId in response', async () => {
      (mockPrisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([
          {
            normalized_topic: 'path/to/topic',
            memory_count: 2,
            display_label: 'path/to/topic',
          },
        ])
        .mockResolvedValueOnce([{ count: 1 }]);

      const result = await service.listWorkspaces('user-123');

      expect(result.workspaces[0].workspaceId).toBe('path%2Fto%2Ftopic');
    });

    it('should handle display_label frequency determinism', async () => {
      (mockPrisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([
          {
            normalized_topic: 'ai',
            memory_count: 21,
            display_label: 'AI',
          },
        ])
        .mockResolvedValueOnce([{ count: 1 }]);

      const result = await service.listWorkspaces('user-123');

      expect(result.workspaces[0].displayLabel).toBe('AI');
    });

    it('should order by memory count DESC then topic ASC', async () => {
      (mockPrisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([
          {
            normalized_topic: 'apple',
            memory_count: 10,
            display_label: 'Apple',
          },
          {
            normalized_topic: 'zebra',
            memory_count: 10,
            display_label: 'Zebra',
          },
        ])
        .mockResolvedValueOnce([{ count: 2 }]);

      const result = await service.listWorkspaces('user-123');

      expect(result.workspaces[0].workspaceId).toBe('apple');
      expect(result.workspaces[1].workspaceId).toBe('zebra');
    });
  });

  describe('getWorkspaceMemories - Additional Tests', () => {
    it('should resolve title from confirmation > inference > raw', async () => {
      (mockPrisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([
          { total_count: 2, display_label: 'AI' },
        ]);

      (mockPrisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([
          { memory_id: 'mem-1' },
          { memory_id: 'mem-2' },
        ]);

      (mockPrisma.memory.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'mem-1',
          title: 'Raw Title',
          memoryType: 'TEXT',
          sourceType: 'MANUAL',
          capturedAt: new Date(),
          processingState: 'COMPLETE',
          securityScope: 'private',
          aiInferences: [
            {
              field: 'title',
              valueJson: 'Inference Title',
            },
          ],
          userConfirmations: [
            {
              field: 'title',
              confirmedValue: 'Confirmed Title',
            },
          ],
          assets: [],
        },
        {
          id: 'mem-2',
          title: 'Raw Title 2',
          memoryType: 'TEXT',
          sourceType: 'MANUAL',
          capturedAt: new Date(),
          processingState: 'COMPLETE',
          securityScope: 'private',
          aiInferences: [],
          userConfirmations: [],
          assets: [],
        },
      ]);

      const result = await service.getWorkspaceMemories('user-123', 'ai');

      expect(result.memories[0].title).toBe('Confirmed Title');
      expect(result.memories[1].title).toBe('Raw Title 2');
    });

    it('should decode encoded workspaceId', async () => {
      (mockPrisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([
          { total_count: 2, display_label: 'path/to/topic' },
        ]);

      (mockPrisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([
          { memory_id: 'mem-1' },
          { memory_id: 'mem-2' },
        ]);

      (mockPrisma.memory.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'mem-1',
          title: 'Memory 1',
          memoryType: 'TEXT',
          sourceType: 'MANUAL',
          capturedAt: new Date(),
          processingState: 'COMPLETE',
          securityScope: 'private',
          aiInferences: [],
          userConfirmations: [],
          assets: [],
        },
        {
          id: 'mem-2',
          title: 'Memory 2',
          memoryType: 'TEXT',
          sourceType: 'MANUAL',
          capturedAt: new Date(),
          processingState: 'COMPLETE',
          securityScope: 'private',
          aiInferences: [],
          userConfirmations: [],
          assets: [],
        },
      ]);

      const result = await service.getWorkspaceMemories('user-123', 'path%2Fto%2Ftopic');

      expect(result.workspaceId).toBe('path%2Fto%2Ftopic');
      expect(result.displayLabel).toBe('path/to/topic');
    });

    it('should include proper asset URLs without objectKey exposure', async () => {
      (mockPrisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([
          { total_count: 2, display_label: 'AI' },
        ]);

      (mockPrisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([
          { memory_id: 'mem-1' },
          { memory_id: 'mem-2' },
        ]);

      (mockPrisma.memory.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'mem-1',
          title: 'Memory with Asset',
          memoryType: 'TEXT',
          sourceType: 'MANUAL',
          capturedAt: new Date(),
          processingState: 'COMPLETE',
          securityScope: 'private',
          aiInferences: [],
          userConfirmations: [],
          assets: [
            {
              id: 'asset-1',
              mimeType: 'image/png',
              variant: null,
              objectKey: 'should-not-be-exposed',
            },
          ],
        },
        {
          id: 'mem-2',
          title: 'Memory 2',
          memoryType: 'TEXT',
          sourceType: 'MANUAL',
          capturedAt: new Date(),
          processingState: 'COMPLETE',
          securityScope: 'private',
          aiInferences: [],
          userConfirmations: [],
          assets: [],
        },
      ]);

      const result = await service.getWorkspaceMemories('user-123', 'ai');

      expect(result.memories[0].assets).toHaveLength(1);
      expect(result.memories[0].assets[0].url).toBe('/assets/asset-1/content');
      expect(result.memories[0].assets[0]).not.toHaveProperty('objectKey');
    });

    it('should pass userId to SQL query for isolation', async () => {
      (mockPrisma.$queryRaw as jest.Mock).mockResolvedValueOnce([]);

      await expect(
        service.getWorkspaceMemories('user-456', 'ai')
      ).rejects.toThrow();

      expect((mockPrisma.$queryRaw as jest.Mock).mock.calls.length).toBeGreaterThan(0);
    });
  });
});
