import React from 'react';
import TestRenderer from 'react-test-renderer';
import { RelatedMemoryCard } from '../memory-cards/RelatedMemoryCard';

jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  Image: 'Image',
}));

jest.mock('../AuthenticatedAssetImage', () => ({
  AuthenticatedAssetImage: ({ assetId }: any) => `AuthenticatedAssetImage:${assetId}`,
}));

describe('RelatedMemoryCard', () => {
  const mockOnPress = jest.fn();
  const mockMemory = {
    id: 'mem-1',
    title: 'Test Memory',
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
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('A. Renders successfully with required props', () => {
    it('renders without error', async () => {
      let rendered: any;
      await TestRenderer.act(async () => {
        rendered = TestRenderer.create(
          <RelatedMemoryCard memory={mockMemory} onPress={mockOnPress} />
        );
      });

      const tree = rendered.toJSON();
      expect(tree).not.toBeNull();
    });
  });

  describe('B. Renders memory information', () => {
    it('renders card with memory title and metadata', async () => {
      let rendered: any;
      await TestRenderer.act(async () => {
        rendered = TestRenderer.create(
          <RelatedMemoryCard memory={mockMemory} onPress={mockOnPress} />
        );
      });

      const tree = rendered.toJSON();
      const treeString = JSON.stringify(tree);

      expect(treeString).toContain('Test Memory');
    });
  });

  describe('C. Handles empty assets array', () => {
    it('renders successfully without thumbnail when assets are empty', async () => {
      const memoryNoAssets = {
        ...mockMemory,
        assets: [],
      };

      let rendered: any;
      await TestRenderer.act(async () => {
        rendered = TestRenderer.create(
          <RelatedMemoryCard memory={memoryNoAssets} onPress={mockOnPress} />
        );
      });

      const tree = rendered.toJSON();
      expect(tree).not.toBeNull();
    });
  });

  describe('D. Supports both private and vault scopes', () => {
    it('renders private scope memory', async () => {
      let rendered: any;
      await TestRenderer.act(async () => {
        rendered = TestRenderer.create(
          <RelatedMemoryCard memory={mockMemory} onPress={mockOnPress} />
        );
      });

      expect(rendered).not.toBeNull();
    });

    it('renders vault scope memory', async () => {
      const vaultMemory = {
        ...mockMemory,
        securityScope: 'vault',
      };

      let rendered: any;
      await TestRenderer.act(async () => {
        rendered = TestRenderer.create(
          <RelatedMemoryCard memory={vaultMemory} onPress={mockOnPress} />
        );
      });

      expect(rendered).not.toBeNull();
    });
  });

  describe('E. Does not display similarity score', () => {
    it('ignores similarity field in rendering', async () => {
      let rendered: any;
      await TestRenderer.act(async () => {
        rendered = TestRenderer.create(
          <RelatedMemoryCard memory={mockMemory} onPress={mockOnPress} />
        );
      });

      const tree = rendered.toJSON();
      const treeString = JSON.stringify(tree);

      expect(treeString).not.toContain('0.85');
      expect(treeString).not.toContain('similarity');
    });
  });

  describe('F. Pressable with onPress callback', () => {
    it('renders Pressable component with onPress prop', async () => {
      let rendered: any;
      await TestRenderer.act(async () => {
        rendered = TestRenderer.create(
          <RelatedMemoryCard memory={mockMemory} onPress={mockOnPress} />
        );
      });

      const tree = rendered.toJSON();
      const treeString = JSON.stringify(tree);

      expect(treeString).toContain('Pressable');
    });
  });

  describe('G. Renders with asset image when available', () => {
    it('includes AuthenticatedAssetImage when image asset exists', async () => {
      let rendered: any;
      await TestRenderer.act(async () => {
        rendered = TestRenderer.create(
          <RelatedMemoryCard memory={mockMemory} onPress={mockOnPress} />
        );
      });

      const tree = rendered.toJSON();
      const treeString = JSON.stringify(tree);

      expect(treeString).toContain('AuthenticatedAssetImage');
    });
  });

  describe('H. Different memory types', () => {
    it('renders event type memory', async () => {
      let rendered: any;
      await TestRenderer.act(async () => {
        rendered = TestRenderer.create(
          <RelatedMemoryCard memory={{ ...mockMemory, memoryType: 'event' }} onPress={mockOnPress} />
        );
      });

      expect(rendered).not.toBeNull();
    });

    it('renders place type memory', async () => {
      let rendered: any;
      await TestRenderer.act(async () => {
        rendered = TestRenderer.create(
          <RelatedMemoryCard memory={{ ...mockMemory, memoryType: 'place' }} onPress={mockOnPress} />
        );
      });

      expect(rendered).not.toBeNull();
    });
  });
});
