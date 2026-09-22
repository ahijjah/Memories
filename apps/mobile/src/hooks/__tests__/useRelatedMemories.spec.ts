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
    (clientApi.fetchRelatedVaultMemories as jest.Mock).mockResolvedValue(mockRelatedMemories);
  });

  describe('A. Related section renders when results exist', () => {
    it('returns related memories data when available', async () => {
      let instance: any;

      await TestRenderer.act(async () => {
        const TestComponent = () => {
          const result = useRelatedMemories(mockMemoryId);
          instance = result;
          return React.createElement('div', null, result.data ? 'loaded' : 'loading');
        };
        TestRenderer.create(
          React.createElement(
            QueryClientProvider,
            { client: queryClient },
            React.createElement(TestComponent)
          )
        );
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(instance.data).toEqual(mockRelatedMemories);
    });
  });

  describe('B. [] hides Related section', () => {
    it('returns empty array when no related memories exist', async () => {
      (clientApi.fetchRelatedMemories as jest.Mock).mockResolvedValue([]);

      let instance: any;

      await TestRenderer.act(async () => {
        const TestComponent = () => {
          const result = useRelatedMemories(mockMemoryId);
          instance = result;
          return React.createElement('div', null, instance?.data?.length ?? 'loading');
        };
        TestRenderer.create(
          React.createElement(
            QueryClientProvider,
            { client: queryClient },
            React.createElement(TestComponent)
          )
        );
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(instance.data).toEqual([]);
    });
  });

  describe('C. API error does not break primary Memory Detail', () => {
    it('handles API errors gracefully', async () => {
      const error = new Error('Network error');
      (clientApi.fetchRelatedMemories as jest.Mock).mockRejectedValue(error);

      let instance: any;

      await TestRenderer.act(async () => {
        const TestComponent = () => {
          const result = useRelatedMemories(mockMemoryId);
          instance = result;
          return React.createElement('div', null, instance?.error ? 'error' : 'ok');
        };
        TestRenderer.create(
          React.createElement(
            QueryClientProvider,
            { client: queryClient },
            React.createElement(TestComponent)
          )
        );
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(instance.error).toBeDefined();
    });
  });

  describe('E. Request limit is 5', () => {
    it('fetches related memories with limit=5', async () => {
      await TestRenderer.act(async () => {
        const TestComponent = () => {
          useRelatedMemories(mockMemoryId);
          return React.createElement('div', null);
        };
        TestRenderer.create(
          React.createElement(
            QueryClientProvider,
            { client: queryClient },
            React.createElement(TestComponent)
          )
        );
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(clientApi.fetchRelatedMemories).toHaveBeenCalledWith(
        mockToken,
        mockMemoryId,
        5
      );
    });
  });

  describe('G. Title renders in result', () => {
    it('includes title in returned result', async () => {
      let instance: any;

      await TestRenderer.act(async () => {
        const TestComponent = () => {
          const result = useRelatedMemories(mockMemoryId);
          instance = result;
          return React.createElement('div', null);
        };
        TestRenderer.create(
          React.createElement(
            QueryClientProvider,
            { client: queryClient },
            React.createElement(TestComponent)
          )
        );
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(instance.data?.[0]?.title).toBe('Related Memory 1');
    });
  });

  describe('H. Similarity value returned but not for UI display', () => {
    it('hook returns similarity value from backend', async () => {
      let instance: any;

      await TestRenderer.act(async () => {
        const TestComponent = () => {
          const result = useRelatedMemories(mockMemoryId);
          instance = result;
          return React.createElement('div', null);
        };
        TestRenderer.create(
          React.createElement(
            QueryClientProvider,
            { client: queryClient },
            React.createElement(TestComponent)
          )
        );
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Hook returns similarity value (backend provides it)
      expect(instance.data?.[0]?.similarity).toBe(0.85);
    });
  });

  describe('I. Related image asset URLs properly formatted', () => {
    it('returns asset URLs formatted for AuthenticatedAssetImage', async () => {
      let instance: any;

      await TestRenderer.act(async () => {
        const TestComponent = () => {
          const result = useRelatedMemories(mockMemoryId);
          instance = result;
          return React.createElement('div', null);
        };
        TestRenderer.create(
          React.createElement(
            QueryClientProvider,
            { client: queryClient },
            React.createElement(TestComponent)
          )
        );
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const asset = instance.data?.[0]?.assets?.[0];
      expect(asset?.url).toBe('/assets/asset-1/content');
      expect(asset?.id).toBe('asset-1');
    });
  });

  describe('J. No SSE-C headers in asset URLs', () => {
    it('does not include SSE-C material in asset URLs', async () => {
      let instance: any;

      await TestRenderer.act(async () => {
        const TestComponent = () => {
          const result = useRelatedMemories(mockMemoryId);
          instance = result;
          return React.createElement('div', null);
        };
        TestRenderer.create(
          React.createElement(
            QueryClientProvider,
            { client: queryClient },
            React.createElement(TestComponent)
          )
        );
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const assets = instance.data?.[0]?.assets || [];
      for (const asset of assets) {
        expect(asset.url).not.toContain('SSE-C');
        expect(asset.url).not.toContain('x-amz-server-side-encryption');
      }
    });
  });

  describe('K. Private securityScope for routing', () => {
    it('returns private securityScope for private memories', async () => {
      let instance: any;

      await TestRenderer.act(async () => {
        const TestComponent = () => {
          const result = useRelatedMemories(mockMemoryId);
          instance = result;
          return React.createElement('div', null);
        };
        TestRenderer.create(
          React.createElement(
            QueryClientProvider,
            { client: queryClient },
            React.createElement(TestComponent)
          )
        );
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(instance.data?.[0]?.securityScope).toBe('private');
    });
  });

  describe('L. Vault endpoint when isVault=true', () => {
    it('uses vault-specific endpoint when isVault=true', async () => {
      const vaultResults = [{ ...mockRelatedMemories[0], securityScope: 'vault' }];
      (clientApi.fetchRelatedVaultMemories as jest.Mock).mockResolvedValue(vaultResults);

      let instance: any;

      await TestRenderer.act(async () => {
        const TestComponent = () => {
          const result = useRelatedMemories(mockMemoryId, { isVault: true });
          instance = result;
          return React.createElement('div', null);
        };
        TestRenderer.create(
          React.createElement(
            QueryClientProvider,
            { client: queryClient },
            React.createElement(TestComponent)
          )
        );
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(clientApi.fetchRelatedVaultMemories).toHaveBeenCalledWith(
        mockToken,
        mockMemoryId,
        5
      );
    });
  });

  describe('M. New request on memoryId change', () => {
    it('fetches new related memories when memoryId changes', async () => {
      let renderCount = 0;
      let testRenderer: any;

      const TestComponent = ({ id }: { id: string }) => {
        const result = useRelatedMemories(id);
        renderCount++;
        return React.createElement('div', null, result?.data?.length ?? 0);
      };

      await TestRenderer.act(async () => {
        testRenderer = TestRenderer.create(
          React.createElement(
            QueryClientProvider,
            { client: queryClient },
            React.createElement(TestComponent, { id: mockMemoryId })
          )
        );
      });

      await new Promise((resolve) => setTimeout(resolve, 100));
      const firstCallCount = (clientApi.fetchRelatedMemories as jest.Mock).mock.calls.length;

      // Update memory ID
      await TestRenderer.act(async () => {
        testRenderer.update(
          React.createElement(
            QueryClientProvider,
            { client: queryClient },
            React.createElement(TestComponent, { id: 'mem-new' })
          )
        );
      });

      await new Promise((resolve) => setTimeout(resolve, 100));
      const secondCallCount = (clientApi.fetchRelatedMemories as jest.Mock).mock.calls.length;

      expect(secondCallCount).toBeGreaterThan(firstCallCount);
    });
  });

  describe('Token handling', () => {
    it('handles missing auth token', async () => {
      mockGetToken.mockResolvedValue(null);

      let instance: any;

      await TestRenderer.act(async () => {
        const TestComponent = () => {
          const result = useRelatedMemories(mockMemoryId);
          instance = result;
          return React.createElement('div', null);
        };
        TestRenderer.create(
          React.createElement(
            QueryClientProvider,
            { client: queryClient },
            React.createElement(TestComponent)
          )
        );
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(instance.error).toBeDefined();
    });
  });
});
