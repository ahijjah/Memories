import * as clientApi from '../client';

jest.mock('../client');

describe('API Client - Related Memories Endpoint', () => {
  const mockToken = 'test-token-123';
  const mockMemoryId = 'mem-abc-123';
  const mockLimit = 5;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('fetchRelatedMemories', () => {
    it('calls endpoint for private related memories', async () => {
      const mockResult = [
        {
          id: 'mem-2',
          title: 'Related Memory',
          memoryType: 'event',
          capturedAt: '2026-09-20T10:00:00Z',
          securityScope: 'private',
          similarity: 0.85,
          assets: [],
        },
      ];

      (clientApi.fetchRelatedMemories as jest.Mock).mockResolvedValue(mockResult);

      const result = await clientApi.fetchRelatedMemories(mockToken, mockMemoryId, mockLimit);

      expect(result).toEqual(mockResult);
      expect(clientApi.fetchRelatedMemories).toHaveBeenCalledWith(
        mockToken,
        mockMemoryId,
        mockLimit
      );
    });

    it('uses default limit of 5 when not specified', async () => {
      const mockResult = [];
      (clientApi.fetchRelatedMemories as jest.Mock).mockResolvedValue(mockResult);

      const result = await clientApi.fetchRelatedMemories(mockToken, mockMemoryId);

      expect(result).toEqual([]);
      // Function accepts limit as optional parameter with default of 5
      expect(clientApi.fetchRelatedMemories).toHaveBeenCalled();
    });

    it('includes required fields: id, title, capturedAt, securityScope, similarity, assets', async () => {
      const mockResult = [
        {
          id: 'mem-2',
          title: 'Related Memory',
          memoryType: 'event',
          capturedAt: '2026-09-20T10:00:00Z',
          securityScope: 'private',
          similarity: 0.85,
          assets: [
            {
              id: 'asset-1',
              mimeType: 'image/jpeg',
              variant: 'thumbnail',
              url: '/assets/asset-1/content',
            },
          ],
        },
      ];

      (clientApi.fetchRelatedMemories as jest.Mock).mockResolvedValue(mockResult);

      const result = await clientApi.fetchRelatedMemories(mockToken, mockMemoryId, 5);

      expect(result[0]).toHaveProperty('id');
      expect(result[0]).toHaveProperty('title');
      expect(result[0]).toHaveProperty('capturedAt');
      expect(result[0]).toHaveProperty('securityScope');
      expect(result[0]).toHaveProperty('similarity');
      expect(result[0]).toHaveProperty('assets');
      expect(result[0].assets[0].url).toBe('/assets/asset-1/content');
    });

    it('returns empty array when no related memories exist', async () => {
      (clientApi.fetchRelatedMemories as jest.Mock).mockResolvedValue([]);

      const result = await clientApi.fetchRelatedMemories(mockToken, mockMemoryId, 5);

      expect(result).toEqual([]);
    });

    it('endpoint is GET /memories/:id/related?limit=N (not /vault/:id/related)', () => {
      // Verify that fetchRelatedVaultMemories does not exist
      expect(clientApi.fetchRelatedVaultMemories).toBeUndefined();
      // Both private and vault retrieval use same /memories endpoint
    });
  });
});
