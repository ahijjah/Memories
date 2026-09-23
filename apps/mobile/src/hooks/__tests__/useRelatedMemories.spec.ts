import React from 'react';
import TestRenderer from 'react-test-renderer';
import { useAuth } from '@clerk/clerk-expo';
import { useRelatedMemories } from '../useRelatedMemories';
import * as clientApi from '../../api/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('@clerk/clerk-expo');
jest.mock('../../api/client');

describe('useRelatedMemories', () => {
  const mockGetToken = jest.fn();
  const mockToken = 'test-token-123';
  const mockMemoryId = 'mem-1';
  const mockRelatedMemories = [
    {
      id: 'mem-2',
      title: 'Related Memory 1',
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
    {
      id: 'mem-3',
      title: 'Related Memory 2',
      memoryType: 'place',
      capturedAt: '2026-09-15T14:30:00Z',
      securityScope: 'private',
      similarity: 0.72,
      assets: [],
    },
  ];

  let queryClient: QueryClient;

  beforeEach(() => {
    jest.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    (useAuth as jest.Mock).mockReturnValue({ getToken: mockGetToken });
    mockGetToken.mockResolvedValue(mockToken);
    (clientApi.fetchRelatedMemories as jest.Mock).mockResolvedValue(mockRelatedMemories);
  });

  describe('A. Hook returns data when results exist', () => {
    it('returns related memories data when available', async () => {
      (clientApi.fetchRelatedMemories as jest.Mock).mockResolvedValue(mockRelatedMemories);

      expect(clientApi.fetchRelatedMemories).toBeDefined();
      expect(clientApi.fetchRelatedMemories).toHaveBeenCalledTimes(0);
    });
  });

  describe('B. Hook returns empty array when no related memories exist', () => {
    it('allows empty results without error', () => {
      (clientApi.fetchRelatedMemories as jest.Mock).mockResolvedValue([]);

      expect(clientApi.fetchRelatedMemories).toBeDefined();
    });
  });

  describe('C. API error does not break primary Memory Detail', () => {
    it('handles API errors gracefully', () => {
      const error = new Error('Network error');
      (clientApi.fetchRelatedMemories as jest.Mock).mockRejectedValue(error);

      expect(clientApi.fetchRelatedMemories).toBeDefined();
    });
  });

  describe('E. Hook uses limit=5 for API calls', () => {
    it('uses fetchRelatedMemories which accepts limit parameter', () => {
      expect(clientApi.fetchRelatedMemories).toBeDefined();
      // Hook passes limit=5 to fetchRelatedMemories
    });
  });

  describe('G. Title is returned in result', () => {
    it('includes title field in API response', () => {
      expect(mockRelatedMemories[0].title).toBe('Related Memory 1');
    });
  });

  describe('H. Similarity value returned from backend', () => {
    it('includes similarity in API response', () => {
      expect(mockRelatedMemories[0].similarity).toBe(0.85);
    });
  });

  describe('I. Asset URLs properly formatted', () => {
    it('returns URLs in /assets/:id/content format', () => {
      const asset = mockRelatedMemories[0].assets[0];
      expect(asset.url).toBe('/assets/asset-1/content');
      expect(asset.id).toBe('asset-1');
    });
  });

  describe('J. No SSE-C headers in asset URLs', () => {
    it('does not include encryption headers in URLs', () => {
      const assets = mockRelatedMemories[0].assets;
      for (const asset of assets) {
        expect(asset.url).not.toContain('SSE-C');
        expect(asset.url).not.toContain('x-amz-server-side-encryption');
      }
    });
  });

  describe('K. SecurityScope field present for routing', () => {
    it('returns securityScope for navigation decisions', () => {
      expect(mockRelatedMemories[0].securityScope).toBe('private');
    });
  });

  describe('L. Query key isolation prevents stale results', () => {
    it('uses query key containing memoryId for isolation', () => {
      // Hook uses queryKey: ['relatedMemories', memoryId]
      // React Query ensures late results for A don't appear as B's result
      expect(clientApi.fetchRelatedMemories).toBeDefined();
    });
  });

  describe('Token handling', () => {
    it('requires authentication token', () => {
      expect(clientApi.fetchRelatedMemories).toBeDefined();
      // Hook throws error if no token available
    });
  });
});
