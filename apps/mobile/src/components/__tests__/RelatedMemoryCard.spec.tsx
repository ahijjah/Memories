import React from 'react';
import TestRenderer from 'react-test-renderer';
import { RelatedMemoryCard } from '../memory-cards/RelatedMemoryCard';

jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  Image: 'Image',
}));

let capturedAssetImageProps: Map<string, any> = new Map();

const mockCapturedAssetImageProps = new Map<string, any>();

jest.mock('../AuthenticatedAssetImage', () => ({
  AuthenticatedAssetImage: (props: any) => {
    mockCapturedAssetImageProps.set(props.assetId, props);
    return `AuthenticatedAssetImage:${props.assetId}`;
  },
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

  describe('F. Pressable component receives onPress callback', () => {
    it('component structure includes Pressable wrapper', async () => {
      let rendered: any;
      await TestRenderer.act(async () => {
        rendered = TestRenderer.create(
          <RelatedMemoryCard memory={mockMemory} onPress={mockOnPress} />
        );
      });

      const tree = rendered.toJSON();
      const treeString = JSON.stringify(tree);
      expect(treeString).toContain('Pressable');
      expect(mockOnPress).not.toHaveBeenCalled();
    });
  });

  describe('G. AuthenticatedAssetImage props validation', () => {
    it('passes correct assetId and contentUrl to AuthenticatedAssetImage', async () => {
      mockCapturedAssetImageProps.clear();

      let rendered: any;
      await TestRenderer.act(async () => {
        rendered = TestRenderer.create(
          <RelatedMemoryCard memory={mockMemory} onPress={mockOnPress} />
        );
      });

      const assetProps = mockCapturedAssetImageProps.get('asset-1');
      expect(assetProps).toBeDefined();
      expect(assetProps.assetId).toBe('asset-1');
      expect(assetProps.contentUrl).toBe('/assets/asset-1/content');
    });

    it('does not render AuthenticatedAssetImage when no image asset', async () => {
      mockCapturedAssetImageProps.clear();

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

      expect(mockCapturedAssetImageProps.size).toBe(0);
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
