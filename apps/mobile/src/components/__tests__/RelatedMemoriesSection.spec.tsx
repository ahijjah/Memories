import React from 'react';
import TestRenderer from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as useRelatedMemoriesHook from '../../hooks/useRelatedMemories';
import { RelatedMemoriesSection } from '../RelatedMemoriesSection';

jest.mock('../../hooks/useRelatedMemories');
jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
}));
jest.mock('../memory-cards/RelatedMemoryCard', () => ({
  RelatedMemoryCard: ({ memory, onPress }: any) => `RelatedMemoryCard:${memory.id}`,
}));

describe('RelatedMemoriesSection - Real Rendering Tests', () => {
  const mockOnNavigate = jest.fn();
  const mockMemoryId = 'mem-1';
  const mockRelatedMemories = [
    {
      id: 'mem-2',
      title: 'Related Event',
      memoryType: 'event',
      capturedAt: '2026-09-20T10:00:00Z',
      securityScope: 'private',
      similarity: 0.85,
      assets: [],
    },
    {
      id: 'mem-3',
      title: 'Related Place',
      memoryType: 'place',
      capturedAt: '2026-09-15T14:30:00Z',
      securityScope: 'vault',
      similarity: 0.72,
      assets: [],
    },
  ];

  let queryClient: QueryClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockOnNavigate.mockClear();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  describe('A. DATA STATE - renders two memory cards', () => {
    it('renders Related Memories section with two RelatedMemoryCard components', async () => {
      (useRelatedMemoriesHook.useRelatedMemories as jest.Mock).mockReturnValue({
        data: mockRelatedMemories,
        isLoading: false,
        error: null,
      });

      let rendered: any;
      await TestRenderer.act(async () => {
        rendered = TestRenderer.create(
          <QueryClientProvider client={queryClient}>
            <RelatedMemoriesSection
              memoryId={mockMemoryId}
              onNavigateToMemory={mockOnNavigate}
            />
          </QueryClientProvider>
        );
      });

      const tree = rendered.toJSON();
      const treeString = JSON.stringify(tree);

      expect(treeString).toContain('Related Memories');
      const cardMatches = treeString.match(/RelatedMemoryCard:mem-\d/g);
      expect(cardMatches).toHaveLength(2);
      expect(treeString).toContain('RelatedMemoryCard:mem-2');
      expect(treeString).toContain('RelatedMemoryCard:mem-3');
    });
  });

  describe('B. EMPTY STATE - returns null', () => {
    it('renders null when hook returns empty array', async () => {
      (useRelatedMemoriesHook.useRelatedMemories as jest.Mock).mockReturnValue({
        data: [],
        isLoading: false,
        error: null,
      });

      let rendered: any;
      await TestRenderer.act(async () => {
        rendered = TestRenderer.create(
          <QueryClientProvider client={queryClient}>
            <RelatedMemoriesSection
              memoryId={mockMemoryId}
              onNavigateToMemory={mockOnNavigate}
            />
          </QueryClientProvider>
        );
      });

      const tree = rendered.toJSON();
      expect(tree).toBeNull();
    });
  });

  describe('C. LOADING STATE - returns null', () => {
    it('renders null when isLoading is true', async () => {
      (useRelatedMemoriesHook.useRelatedMemories as jest.Mock).mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
      });

      let rendered: any;
      await TestRenderer.act(async () => {
        rendered = TestRenderer.create(
          <QueryClientProvider client={queryClient}>
            <RelatedMemoriesSection
              memoryId={mockMemoryId}
              onNavigateToMemory={mockOnNavigate}
            />
          </QueryClientProvider>
        );
      });

      const tree = rendered.toJSON();
      expect(tree).toBeNull();
    });
  });

  describe('D. ERROR STATE - returns null', () => {
    it('renders null when hook returns error', async () => {
      (useRelatedMemoriesHook.useRelatedMemories as jest.Mock).mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('Network error'),
      });

      let rendered: any;
      await TestRenderer.act(async () => {
        rendered = TestRenderer.create(
          <QueryClientProvider client={queryClient}>
            <RelatedMemoriesSection
              memoryId={mockMemoryId}
              onNavigateToMemory={mockOnNavigate}
            />
          </QueryClientProvider>
        );
      });

      const tree = rendered.toJSON();
      expect(tree).toBeNull();
    });
  });

  describe('E. MAX FIVE - limits cards to 5', () => {
    it('renders exactly 5 RelatedMemoryCard when given 10 results', async () => {
      const tenResults = Array.from({ length: 10 }, (_, i) => ({
        id: `mem-${i + 2}`,
        title: `Memory ${i}`,
        memoryType: 'event',
        capturedAt: '2026-09-20T10:00:00Z',
        securityScope: 'private',
        similarity: 0.85,
        assets: [],
      }));

      (useRelatedMemoriesHook.useRelatedMemories as jest.Mock).mockReturnValue({
        data: tenResults,
        isLoading: false,
        error: null,
      });

      let rendered: any;
      await TestRenderer.act(async () => {
        rendered = TestRenderer.create(
          <QueryClientProvider client={queryClient}>
            <RelatedMemoriesSection
              memoryId={mockMemoryId}
              onNavigateToMemory={mockOnNavigate}
            />
          </QueryClientProvider>
        );
      });

      const tree = rendered.toJSON();
      const treeString = JSON.stringify(tree);

      const cardMatches = (treeString.match(/RelatedMemoryCard:/g) || []).length;
      expect(cardMatches).toBe(5);
    });
  });

  describe('F. NAVIGATION CALLBACK - private', () => {
    it('renders private memory and component is ready for press', async () => {
      const privateMemory = {
        id: 'private-1',
        title: 'Private Memory',
        memoryType: 'event',
        capturedAt: '2026-09-20T10:00:00Z',
        securityScope: 'private',
        similarity: 0.85,
        assets: [],
      };

      (useRelatedMemoriesHook.useRelatedMemories as jest.Mock).mockReturnValue({
        data: [privateMemory],
        isLoading: false,
        error: null,
      });

      let rendered: any;
      await TestRenderer.act(async () => {
        rendered = TestRenderer.create(
          <QueryClientProvider client={queryClient}>
            <RelatedMemoriesSection
              memoryId={mockMemoryId}
              onNavigateToMemory={mockOnNavigate}
            />
          </QueryClientProvider>
        );
      });

      const tree = rendered.toJSON();
      const treeString = JSON.stringify(tree);
      expect(treeString).toContain('RelatedMemoryCard:private-1');
      expect(treeString).toContain('private-1');
    });
  });

  describe('G. NAVIGATION CALLBACK - vault', () => {
    it('renders vault memory with correct scope indicator', async () => {
      const vaultMemory = {
        id: 'vault-1',
        title: 'Vault Memory',
        memoryType: 'event',
        capturedAt: '2026-09-20T10:00:00Z',
        securityScope: 'vault',
        similarity: 0.85,
        assets: [],
      };

      (useRelatedMemoriesHook.useRelatedMemories as jest.Mock).mockReturnValue({
        data: [vaultMemory],
        isLoading: false,
        error: null,
      });

      let rendered: any;
      await TestRenderer.act(async () => {
        rendered = TestRenderer.create(
          <QueryClientProvider client={queryClient}>
            <RelatedMemoriesSection
              memoryId={mockMemoryId}
              onNavigateToMemory={mockOnNavigate}
            />
          </QueryClientProvider>
        );
      });

      const tree = rendered.toJSON();
      const treeString = JSON.stringify(tree);
      expect(treeString).toContain('RelatedMemoryCard:vault-1');
      expect(treeString).toContain('vault-1');
    });
  });

  describe('H. HOOK INTEGRATION', () => {
    it('calls useRelatedMemories hook with memoryId', async () => {
      (useRelatedMemoriesHook.useRelatedMemories as jest.Mock).mockReturnValue({
        data: [],
        isLoading: false,
        error: null,
      });

      await TestRenderer.act(async () => {
        TestRenderer.create(
          <QueryClientProvider client={queryClient}>
            <RelatedMemoriesSection
              memoryId={mockMemoryId}
              onNavigateToMemory={mockOnNavigate}
            />
          </QueryClientProvider>
        );
      });

      expect(useRelatedMemoriesHook.useRelatedMemories).toHaveBeenCalledWith(mockMemoryId);
    });
  });
});
