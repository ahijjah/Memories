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

  // Helper to mock SQL query responses for listWorkspaces
  const mockListWorkspacesQuery = (workspaces: Array<{ normalized_topic: string; memory_count: number; variant_frequencies: string }>) => {
    (mockPrisma.$queryRaw as jest.Mock).mockResolvedValueOnce(workspaces);
    (mockPrisma.$queryRaw as jest.Mock).mockResolvedValueOnce([{ count: workspaces.length }]);
  };

  // Helper to mock SQL query responses for getWorkspaceMemories
  const mockDetailQuery = (memories: Array<{ memory_id: string; raw_topic: string }>, totalCount: number) => {
    (mockPrisma.$queryRaw as jest.Mock).mockResolvedValueOnce(memories);
    (mockPrisma.$queryRaw as jest.Mock).mockResolvedValueOnce([{ total_count: totalCount }]);
  };

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

    it('should handle Unicode/Arabic', () => {
      const arabic = 'مصر';
      const normalized = service.normalizeTopicForIdentity(arabic);
      expect(normalized).toBe('مصر');
    });

    it('should handle special characters', () => {
      expect(service.normalizeTopicForIdentity('C++')).toBe('c++');
      expect(service.normalizeTopicForIdentity('path/to/topic')).toBe('path/to/topic');
    });
  });

  describe('encodeWorkspaceId', () => {
    it('should encode normalized topic safely', () => {
      const encoded = service.encodeWorkspaceId('machine learning');
      expect(encoded).toBe('machine%20learning');
    });

    it('should handle special characters', () => {
      expect(service.encodeWorkspaceId('c++')).toBe('c%2B%2B');
      expect(service.encodeWorkspaceId('path/to/topic')).toBe('path%2Fto%2Ftopic');
    });

    it('should handle Unicode', () => {
      const encoded = service.encodeWorkspaceId('مصر');
      expect(encoded).toContain('%');
    });
  });

  describe('decodeAndVerifyWorkspaceId', () => {
    it('should decode workspaceId correctly', () => {
      const encoded = service.encodeWorkspaceId('machine learning');
      const decoded = service.decodeAndVerifyWorkspaceId(encoded);
      expect(decoded).toBe('machine learning');
    });

    it('should verify normalized form matches', () => {
      const encoded = service.encodeWorkspaceId('ai');
      expect(() => {
        service.decodeAndVerifyWorkspaceId(encoded, 'ai');
      }).not.toThrow();
    });

    it('should reject if normalized form does not match', () => {
      const encoded = service.encodeWorkspaceId('ai');
      expect(() => {
        service.decodeAndVerifyWorkspaceId(encoded, 'different');
      }).toThrow();
    });
  });

  describe('selectDisplayLabel', () => {
    it('should select most frequent variant', () => {
      const variants = ['AI', 'AI', 'Ai', 'ai'];
      const label = service.selectDisplayLabel(variants);
      expect(label).toBe('AI');
    });

    it('should tie-break deterministically (when equal frequency)', () => {
      const variants = ['Ai', 'AI'];
      // Both have frequency 1; result should be deterministic
      const result1 = service.selectDisplayLabel(variants);
      const result2 = service.selectDisplayLabel(variants);
      expect(result1).toBe(result2);
      expect(['Ai', 'AI']).toContain(result1);
    });

    it('should handle empty array', () => {
      expect(service.selectDisplayLabel([])).toBe('');
    });

    it('should handle single variant', () => {
      expect(service.selectDisplayLabel(['Machine Learning'])).toBe('Machine Learning');
    });

    it('should preserve original case from variants (most frequent wins)', () => {
      const variants = ['Machine Learning', 'Machine Learning', 'machine learning'];
      const result = service.selectDisplayLabel(variants);
      expect(result).toBe('Machine Learning');
    });
  });

  describe('listWorkspaces', () => {
    it('should return empty list when no memories', async () => {
      mockPrisma.memory.findMany.mockResolvedValue([]);

      const result = await service.listWorkspaces('user-123');

      expect(result.workspaces).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should exclude memories without topics', async () => {
      mockPrisma.memory.findMany.mockResolvedValue([
        {
          id: 'mem-1',
          userId: 'user-123',
          aiInferences: [],
        },
      ]);

      const result = await service.listWorkspaces('user-123');

      expect(result.workspaces).toEqual([]);
    });

    it('should exclude workspaces with fewer than 2 memories', async () => {
      mockPrisma.memory.findMany.mockResolvedValue([
        {
          id: 'mem-1',
          userId: 'user-123',
          aiInferences: [
            {
              field: 'topics',
              valueJson: ['AI'],
            },
          ],
        },
      ]);

      const result = await service.listWorkspaces('user-123');

      expect(result.workspaces).toEqual([]);
    });

    it('should deduplicate topics within same memory', async () => {
      mockPrisma.memory.findMany.mockResolvedValue([
        {
          id: 'mem-1',
          userId: 'user-123',
          aiInferences: [
            {
              field: 'topics',
              valueJson: ['AI', 'AI', 'technology'],
            },
          ],
        },
        {
          id: 'mem-2',
          userId: 'user-123',
          aiInferences: [
            {
              field: 'topics',
              valueJson: ['AI'],
            },
          ],
        },
      ]);

      const result = await service.listWorkspaces('user-123');

      // Should have one workspace "ai" with 2 memories
      expect(result.workspaces).toHaveLength(1);
      expect(result.workspaces[0].memoryCount).toBe(2);
    });

    it('should normalize topics correctly', async () => {
      mockPrisma.memory.findMany.mockResolvedValue([
        {
          id: 'mem-1',
          userId: 'user-123',
          aiInferences: [
            {
              field: 'topics',
              valueJson: ['AI'],
            },
          ],
        },
        {
          id: 'mem-2',
          userId: 'user-123',
          aiInferences: [
            {
              field: 'topics',
              valueJson: [' ai '],
            },
          ],
        },
        {
          id: 'mem-3',
          userId: 'user-123',
          aiInferences: [
            {
              field: 'topics',
              valueJson: ['AI  '],
            },
          ],
        },
      ]);

      const result = await service.listWorkspaces('user-123');

      // All should normalize to "ai" and count as one workspace with 3 memories
      expect(result.workspaces).toHaveLength(1);
      expect(result.workspaces[0].memoryCount).toBe(3);
    });

    it('should not merge different topics', async () => {
      mockPrisma.memory.findMany.mockResolvedValue([
        {
          id: 'mem-1',
          userId: 'user-123',
          aiInferences: [
            {
              field: 'topics',
              valueJson: ['AI'],
            },
          ],
        },
        {
          id: 'mem-2',
          userId: 'user-123',
          aiInferences: [
            {
              field: 'topics',
              valueJson: ['AI'],
            },
          ],
        },
        {
          id: 'mem-3',
          userId: 'user-123',
          aiInferences: [
            {
              field: 'topics',
              valueJson: ['Artificial Intelligence'],
            },
          ],
        },
        {
          id: 'mem-4',
          userId: 'user-123',
          aiInferences: [
            {
              field: 'topics',
              valueJson: ['Artificial Intelligence'],
            },
          ],
        },
      ]);

      const result = await service.listWorkspaces('user-123');

      // Should be two separate workspaces (ai and artificial intelligence)
      expect(result.workspaces.length).toBe(2);
    });

    it('should use display label from raw variants', async () => {
      mockPrisma.memory.findMany.mockResolvedValue([
        {
          id: 'mem-1',
          userId: 'user-123',
          aiInferences: [
            {
              field: 'topics',
              valueJson: ['AI'],
            },
          ],
        },
        {
          id: 'mem-2',
          userId: 'user-123',
          aiInferences: [
            {
              field: 'topics',
              valueJson: [' AI '],
            },
          ],
        },
      ]);

      const result = await service.listWorkspaces('user-123');

      // Display label should be "AI" (most common variant)
      expect(result.workspaces[0].displayLabel).toBe('AI');
    });

    it('should sort by memory count descending', async () => {
      mockPrisma.memory.findMany.mockResolvedValue([
        {
          id: 'mem-1',
          userId: 'user-123',
          aiInferences: [
            {
              field: 'topics',
              valueJson: ['AI'],
            },
          ],
        },
        {
          id: 'mem-2',
          userId: 'user-123',
          aiInferences: [
            {
              field: 'topics',
              valueJson: ['AI'],
            },
          ],
        },
        {
          id: 'mem-3',
          userId: 'user-123',
          aiInferences: [
            {
              field: 'topics',
              valueJson: ['Technology'],
            },
          ],
        },
        {
          id: 'mem-4',
          userId: 'user-123',
          aiInferences: [
            {
              field: 'topics',
              valueJson: ['Technology'],
            },
          ],
        },
        {
          id: 'mem-5',
          userId: 'user-123',
          aiInferences: [
            {
              field: 'topics',
              valueJson: ['Technology'],
            },
          ],
        },
      ]);

      const result = await service.listWorkspaces('user-123');

      expect(result.workspaces[0].memoryCount).toBe(3);
      expect(result.workspaces[1].memoryCount).toBe(2);
    });

    it('should apply pagination', async () => {
      mockPrisma.memory.findMany.mockResolvedValue([
        {
          id: 'mem-1',
          userId: 'user-123',
          aiInferences: [{ field: 'topics', valueJson: ['Topic1'] }],
        },
        {
          id: 'mem-2',
          userId: 'user-123',
          aiInferences: [{ field: 'topics', valueJson: ['Topic1'] }],
        },
        {
          id: 'mem-3',
          userId: 'user-123',
          aiInferences: [{ field: 'topics', valueJson: ['Topic2'] }],
        },
        {
          id: 'mem-4',
          userId: 'user-123',
          aiInferences: [{ field: 'topics', valueJson: ['Topic2'] }],
        },
      ]);

      const result = await service.listWorkspaces('user-123', 1, 0);

      expect(result.workspaces).toHaveLength(1);
      expect(result.total).toBe(2);
      expect(result.offset).toBe(0);
      expect(result.limit).toBe(1);
    });

    it('should handle non-array valueJson gracefully', async () => {
      mockPrisma.memory.findMany.mockResolvedValue([
        {
          id: 'mem-1',
          userId: 'user-123',
          aiInferences: [
            {
              field: 'topics',
              valueJson: 'not an array',
            },
          ],
        },
        {
          id: 'mem-2',
          userId: 'user-123',
          aiInferences: [
            {
              field: 'topics',
              valueJson: ['AI'],
            },
          ],
        },
      ]);

      const result = await service.listWorkspaces('user-123');

      // Should ignore the non-array and continue
      expect(result.workspaces).toHaveLength(0);
    });

    it('should filter out empty/whitespace-only topics', async () => {
      mockPrisma.memory.findMany.mockResolvedValue([
        {
          id: 'mem-1',
          userId: 'user-123',
          aiInferences: [
            {
              field: 'topics',
              valueJson: ['', '   ', 'AI'],
            },
          ],
        },
        {
          id: 'mem-2',
          userId: 'user-123',
          aiInferences: [
            {
              field: 'topics',
              valueJson: ['AI'],
            },
          ],
        },
      ]);

      const result = await service.listWorkspaces('user-123');

      // Should have one workspace with 2 memories
      expect(result.workspaces).toHaveLength(1);
      expect(result.workspaces[0].memoryCount).toBe(2);
    });

    it('should filter by user isolation', async () => {
      mockPrisma.memory.findMany.mockResolvedValue([]);

      await service.listWorkspaces('user-123');

      expect(mockPrisma.memory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-123',
          }),
        })
      );
    });

    it('should filter by private scope only', async () => {
      mockPrisma.memory.findMany.mockResolvedValue([]);

      await service.listWorkspaces('user-123');

      expect(mockPrisma.memory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            securityScope: 'private',
          }),
        })
      );
    });

    it('should exclude deleted and deleted_pending', async () => {
      mockPrisma.memory.findMany.mockResolvedValue([]);

      await service.listWorkspaces('user-123');

      expect(mockPrisma.memory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            lifecycleState: { notIn: ['deleted', 'deleted_pending'] },
          }),
        })
      );
    });
  });

  describe('getWorkspaceMemories', () => {
    it('should throw error if workspace has fewer than 2 memories', async () => {
      mockPrisma.memory.findMany.mockResolvedValue([
        {
          id: 'mem-1',
          userId: 'user-123',
          aiInferences: [
            {
              field: 'topics',
              valueJson: ['AI'],
            },
          ],
          userConfirmations: [],
          assets: [],
        },
      ]);

      const encoded = service.encodeWorkspaceId('ai');
      await expect(service.getWorkspaceMemories('user-123', encoded)).rejects.toThrow(
        'Workspace not found'
      );
    });

    it('should return 404 if workspace does not exist for user', async () => {
      mockPrisma.memory.findMany.mockResolvedValue([]);

      const encoded = service.encodeWorkspaceId('nonexistent');
      await expect(service.getWorkspaceMemories('user-123', encoded)).rejects.toThrow();
    });

    it('should decode workspaceId correctly', async () => {
      mockPrisma.memory.findMany.mockResolvedValue([
        {
          id: 'mem-1',
          userId: 'user-123',
          aiInferences: [{ field: 'topics', valueJson: ['AI'] }],
          userConfirmations: [],
          assets: [],
        },
        {
          id: 'mem-2',
          userId: 'user-123',
          aiInferences: [{ field: 'topics', valueJson: ['AI'] }],
          userConfirmations: [],
          assets: [],
        },
      ]);

      const encoded = service.encodeWorkspaceId('ai');
      const result = await service.getWorkspaceMemories('user-123', encoded);

      expect(result.workspaceId).toBe(encoded);
      expect(result.memories).toHaveLength(2);
    });

    it('should resolve title from confirmation > inference > raw', async () => {
      mockPrisma.memory.findMany.mockResolvedValue([
        {
          id: 'mem-1',
          userId: 'user-123',
          title: 'Raw Title',
          aiInferences: [{ field: 'topics', valueJson: ['AI'] }],
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
          userId: 'user-123',
          title: null,
          aiInferences: [
            { field: 'topics', valueJson: ['AI'] },
            { field: 'title', valueJson: 'Inference Title' },
          ],
          userConfirmations: [],
          assets: [],
        },
      ]);

      const encoded = service.encodeWorkspaceId('ai');
      const result = await service.getWorkspaceMemories('user-123', encoded);

      expect(result.memories[0].title).toBe('Confirmed Title');
      expect(result.memories[1].title).toBe('Inference Title');
    });

    it('should apply pagination', async () => {
      const memories = Array.from({ length: 25 }, (_, i) => ({
        id: `mem-${i}`,
        userId: 'user-123',
        title: `Memory ${i}`,
        sourceType: 'text',
        aiInferences: [{ field: 'topics', valueJson: ['AI'] }],
        userConfirmations: [],
        assets: [],
        memoryType: 'GENERIC',
        capturedAt: new Date(),
        processingState: 'understood',
        securityScope: 'private',
      }));

      mockPrisma.memory.findMany.mockResolvedValue(memories);

      const encoded = service.encodeWorkspaceId('ai');
      const result = await service.getWorkspaceMemories('user-123', encoded, 10, 0);

      expect(result.memories).toHaveLength(10);
      expect(result.total).toBe(25);
      expect(result.offset).toBe(0);
      expect(result.limit).toBe(10);
    });

    it('should not include vault content', async () => {
      mockPrisma.memory.findMany.mockResolvedValue([]);

      const encoded = service.encodeWorkspaceId('ai');

      try {
        await service.getWorkspaceMemories('user-123', encoded);
      } catch {
        // Expected to throw
      }

      expect(mockPrisma.memory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            securityScope: 'private',
          }),
        })
      );
    });

    it('should include proper asset URLs', async () => {
      mockPrisma.memory.findMany.mockResolvedValue([
        {
          id: 'mem-1',
          userId: 'user-123',
          title: 'Memory 1',
          sourceType: 'text',
          aiInferences: [{ field: 'topics', valueJson: ['AI'] }],
          userConfirmations: [],
          assets: [
            {
              id: 'asset-1',
              mimeType: 'image/jpeg',
              variant: 'original',
            },
          ],
          memoryType: 'GENERIC',
          capturedAt: new Date(),
          processingState: 'understood',
          securityScope: 'private',
        },
        {
          id: 'mem-2',
          userId: 'user-123',
          title: 'Memory 2',
          sourceType: 'text',
          aiInferences: [{ field: 'topics', valueJson: ['AI'] }],
          userConfirmations: [],
          assets: [],
          memoryType: 'GENERIC',
          capturedAt: new Date(),
          processingState: 'understood',
          securityScope: 'private',
        },
      ]);

      const encoded = service.encodeWorkspaceId('ai');
      const result = await service.getWorkspaceMemories('user-123', encoded);

      expect(result.memories[0].assets[0].url).toBe('/assets/asset-1/content');
      expect(result.memories[0].assets[0]).not.toHaveProperty('objectKey');
    });
  });
});
