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

  describe('A. Hook calls getToken and fetchRelatedMemories on mount', () => {
    it('calls getToken() and fetchRelatedMemories(token, memoryId, 5)', async () => {
      const TestComponent = () => {
        const query = useRelatedMemories(mockMemoryId);
        return null;
      };

      await TestRenderer.act(async () => {
        TestRenderer.create(
          <QueryClientProvider client={queryClient}>
            <TestComponent />
          </QueryClientProvider>
        );
      });

      expect(mockGetToken).toHaveBeenCalled();
      expect(clientApi.fetchRelatedMemories).toHaveBeenCalledWith(mockToken, mockMemoryId, 5);
    });
  });

  describe('B. Hook returns empty array when no related memories exist', () => {
    it('allows empty results without error', async () => {
      (clientApi.fetchRelatedMemories as jest.Mock).mockResolvedValue([]);

      let result: any;
      const TestComponent = () => {
        result = useRelatedMemories(mockMemoryId);
        return null;
      };

      await TestRenderer.act(async () => {
        TestRenderer.create(
          <QueryClientProvider client={queryClient}>
            <TestComponent />
          </QueryClientProvider>
        );
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(result.data).toEqual([]);
      expect(result.error).toBeNull();
    });
  });

  describe('C. API error handling', () => {
    it('hook can be mounted even when API call fails', async () => {
      const networkError = new Error('Network error');
      (clientApi.fetchRelatedMemories as jest.Mock).mockRejectedValue(networkError);

      let result: any;
      let renderError: any;

      const TestComponent = () => {
        try {
          result = useRelatedMemories(mockMemoryId);
          return null;
        } catch (e) {
          renderError = e;
          return null;
        }
      };

      let rendered: any;
      await TestRenderer.act(async () => {
        rendered = TestRenderer.create(
          <QueryClientProvider client={queryClient}>
            <TestComponent />
          </QueryClientProvider>
        );
      });

      expect(renderError).toBeUndefined();
      expect(rendered).not.toBeNull();
    });
  });

  describe('E. Hook uses limit=5 for API calls', () => {
    it('passes limit=5 to fetchRelatedMemories', async () => {
      const TestComponent = () => {
        useRelatedMemories(mockMemoryId);
        return null;
      };

      await TestRenderer.act(async () => {
        TestRenderer.create(
          <QueryClientProvider client={queryClient}>
            <TestComponent />
          </QueryClientProvider>
        );
      });

      expect(clientApi.fetchRelatedMemories).toHaveBeenCalledWith(mockToken, mockMemoryId, 5);
    });
  });

  describe('G. Title is returned in result', () => {
    it('includes title field in successful API response', async () => {
      let result: any;
      const TestComponent = () => {
        result = useRelatedMemories(mockMemoryId);
        return null;
      };

      await TestRenderer.act(async () => {
        TestRenderer.create(
          <QueryClientProvider client={queryClient}>
            <TestComponent />
          </QueryClientProvider>
        );
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(result.data[0].title).toBe('Related Memory 1');
    });
  });

  describe('H. Similarity value returned from backend', () => {
    it('includes similarity in API response', async () => {
      let result: any;
      const TestComponent = () => {
        result = useRelatedMemories(mockMemoryId);
        return null;
      };

      await TestRenderer.act(async () => {
        TestRenderer.create(
          <QueryClientProvider client={queryClient}>
            <TestComponent />
          </QueryClientProvider>
        );
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(result.data[0].similarity).toBe(0.85);
    });
  });

  describe('I. Asset URLs properly formatted', () => {
    it('returns URLs in /assets/:id/content format', async () => {
      let result: any;
      const TestComponent = () => {
        result = useRelatedMemories(mockMemoryId);
        return null;
      };

      await TestRenderer.act(async () => {
        TestRenderer.create(
          <QueryClientProvider client={queryClient}>
            <TestComponent />
          </QueryClientProvider>
        );
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(result.data[0].assets[0].url).toBe('/assets/asset-1/content');
      expect(result.data[0].assets[0].id).toBe('asset-1');
    });
  });

  describe('J. No SSE-C headers in asset URLs', () => {
    it('does not include encryption headers in URLs', async () => {
      let result: any;
      const TestComponent = () => {
        result = useRelatedMemories(mockMemoryId);
        return null;
      };

      await TestRenderer.act(async () => {
        TestRenderer.create(
          <QueryClientProvider client={queryClient}>
            <TestComponent />
          </QueryClientProvider>
        );
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      for (const asset of result.data[0].assets) {
        expect(asset.url).not.toContain('SSE-C');
        expect(asset.url).not.toContain('x-amz-server-side-encryption');
      }
    });
  });

  describe('K. SecurityScope field present for routing', () => {
    it('returns securityScope for navigation decisions', async () => {
      let result: any;
      const TestComponent = () => {
        result = useRelatedMemories(mockMemoryId);
        return null;
      };

      await TestRenderer.act(async () => {
        TestRenderer.create(
          <QueryClientProvider client={queryClient}>
            <TestComponent />
          </QueryClientProvider>
        );
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(result.data[0].securityScope).toBe('private');
    });
  });

  describe('L. Query key isolation prevents stale results', () => {
    it('prevents late results from A replacing results for B via memoryId isolation', async () => {
      let promiseA: Promise<any>;
      let promiseB: Promise<any>;
      let resolveA: any;
      let resolveB: any;

      promiseA = new Promise(resolve => { resolveA = resolve; });
      promiseB = new Promise(resolve => { resolveB = resolve; });

      let callCount = 0;
      (clientApi.fetchRelatedMemories as jest.Mock).mockImplementation((token, memoryId) => {
        callCount++;
        if (memoryId === 'mem-A') {
          return promiseA;
        } else if (memoryId === 'mem-B') {
          return promiseB;
        }
      });

      let resultA: any;
      let resultB: any;

      const TestComponentA = () => {
        resultA = useRelatedMemories('mem-A');
        return null;
      };

      const TestComponentB = () => {
        resultB = useRelatedMemories('mem-B');
        return null;
      };

      let renderA: any;
      let renderB: any;

      await TestRenderer.act(async () => {
        renderA = TestRenderer.create(
          <QueryClientProvider client={queryClient}>
            <TestComponentA />
          </QueryClientProvider>
        );
      });

      await TestRenderer.act(async () => {
        renderB = TestRenderer.create(
          <QueryClientProvider client={queryClient}>
            <TestComponentB />
          </QueryClientProvider>
        );
      });

      const dataB = [{ id: 'mem-related-b' }];
      const dataA = [{ id: 'mem-related-a' }];

      await TestRenderer.act(async () => {
        resolveB(dataB);
        await promiseB;
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(resultB.data).toEqual(dataB);
      expect(resultA.isLoading).toBe(true);

      await TestRenderer.act(async () => {
        resolveA(dataA);
        await promiseA;
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(resultA.data).toEqual(dataA);
      expect(resultB.data).toEqual(dataB);
    });
  });

  describe('Token handling', () => {
    it('hook still mounts when token is unavailable', async () => {
      mockGetToken.mockResolvedValue(null);

      let result: any;
      let renderError: any;

      const TestComponent = () => {
        try {
          result = useRelatedMemories(mockMemoryId);
          return null;
        } catch (e) {
          renderError = e;
          return null;
        }
      };

      let rendered: any;
      await TestRenderer.act(async () => {
        rendered = TestRenderer.create(
          <QueryClientProvider client={queryClient}>
            <TestComponent />
          </QueryClientProvider>
        );
      });

      expect(renderError).toBeUndefined();
      expect(rendered).not.toBeNull();
      expect(mockGetToken).toHaveBeenCalled();
    });
  });
});
