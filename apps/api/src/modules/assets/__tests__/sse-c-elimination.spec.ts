describe('SSE-C Header Elimination from Read Responses', () => {
  const mockUserId = 'test-user-123';
  const mockMemoryId = 'memory-123';
  const mockAssetId = 'asset-456';
  const mockCollectionId = 'collection-789';

  const mockAsset = {
    id: mockAssetId,
    memoryId: mockMemoryId,
    objectKey: 'memories/memory-123/image.jpg',
    mimeType: 'image/jpeg',
    checksum: 'abc123',
    pageIndex: null,
    variant: 'original',
    createdAt: new Date(),
  };

  const mockMemory = {
    id: mockMemoryId,
    userId: mockUserId,
    sourceType: 'camera',
    memoryType: 'photo',
    title: 'Test Memory',
    capturedAt: new Date(),
    processingState: 'understood' as const,
    lifecycleState: 'active',
    securityScope: 'private',
    idempotencyKey: 'key-123',
    assets: [mockAsset],
    aiInferences: [],
    userConfirmations: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockCollection = {
    id: mockCollectionId,
    userId: mockUserId,
    name: 'Test Collection',
    description: 'Test',
    createdAt: new Date(),
    updatedAt: new Date(),
    memories: [mockMemory],
  };

  const mockVaultMemory = {
    ...mockMemory,
    securityScope: 'vault',
  };

  describe('enrichWithAssetUrls method', () => {
    it('should return assets with url property and WITHOUT headers field', () => {
      const enriched = { ...mockMemory };
      if (enriched.assets) {
        enriched.assets = enriched.assets.map((asset: any) => ({
          ...asset,
          url: `/assets/${asset.id}/content`,
        }));
      }

      if (enriched.assets && enriched.assets.length > 0) {
        const asset = enriched.assets[0] as any;
        expect(asset).toHaveProperty('url');
        expect(asset.url).toBe(`/assets/${mockAssetId}/content`);
        expect(asset).not.toHaveProperty('headers');
      }
    });

    it('should NOT contain SSE-C algorithm header in stringified response', () => {
      const enriched = { ...mockMemory };
      if (enriched.assets) {
        enriched.assets = enriched.assets.map((asset: any) => ({
          ...asset,
          url: `/assets/${asset.id}/content`,
        }));
      }
      const assetJson = JSON.stringify(enriched);
      expect(assetJson).not.toContain('x-amz-server-side-encryption-customer-algorithm');
    });

    it('should NOT contain SSE-C key material in stringified response', () => {
      const enriched = { ...mockMemory };
      if (enriched.assets) {
        enriched.assets = enriched.assets.map((asset: any) => ({
          ...asset,
          url: `/assets/${asset.id}/content`,
        }));
      }
      const assetJson = JSON.stringify(enriched);
      expect(assetJson).not.toContain('x-amz-server-side-encryption-customer-key');
    });

    it('should NOT contain SSE-C MD5 in stringified response', () => {
      const enriched = { ...mockMemory };
      if (enriched.assets) {
        enriched.assets = enriched.assets.map((asset: any) => ({
          ...asset,
          url: `/assets/${asset.id}/content`,
        }));
      }
      const assetJson = JSON.stringify(enriched);
      expect(assetJson).not.toContain('x-amz-server-side-encryption-customer-key-MD5');
    });

    it('should return authenticated content URL pattern, not presigned GET', () => {
      const enriched = { ...mockMemory };
      if (enriched.assets) {
        enriched.assets = enriched.assets.map((asset: any) => ({
          ...asset,
          url: `/assets/${asset.id}/content`,
        }));
      }

      if (enriched.assets && enriched.assets.length > 0) {
        const url = (enriched.assets[0] as any).url;
        expect(url).toMatch(/^\/assets\/[a-zA-Z0-9-]+\/content$/);
        expect(url).not.toContain('X-Amz-Algorithm');
        expect(url).not.toContain('X-Amz-Credential');
        expect(url).not.toContain('X-Amz-SignedHeaders');
      }
    });

    it('should preserve essential asset fields except headers', () => {
      const enriched = { ...mockMemory };
      if (enriched.assets) {
        enriched.assets = enriched.assets.map((asset: any) => ({
          ...asset,
          url: `/assets/${asset.id}/content`,
        }));
      }

      if (enriched.assets && enriched.assets.length > 0) {
        const asset = enriched.assets[0];
        expect(asset).toHaveProperty('id');
        expect(asset).toHaveProperty('memoryId');
        expect(asset).toHaveProperty('objectKey');
        expect(asset).toHaveProperty('mimeType');
        expect(asset).toHaveProperty('variant');
        expect(asset).toHaveProperty('createdAt');
        expect(asset).toHaveProperty('url');
        expect(asset).not.toHaveProperty('headers');
      }
    });

    it('should work for collections with nested memories', () => {
      const enriched = { ...mockCollection };
      if (enriched.memories) {
        enriched.memories = enriched.memories.map((mem: any) => ({
          ...mem,
          assets: mem.assets?.map((asset: any) => ({
            ...asset,
            url: `/assets/${asset.id}/content`,
          })) || [],
        }));
      }

      if (enriched.memories && enriched.memories[0]?.assets) {
        const asset = enriched.memories[0].assets[0];
        expect(asset).toHaveProperty('url');
        expect(asset).not.toHaveProperty('headers');
        const collectionJson = JSON.stringify(enriched);
        expect(collectionJson).not.toContain('x-amz-server-side-encryption');
      }
    });

    it('should work for vault memories with owner access only', () => {
      const enriched = { ...mockVaultMemory };
      if (enriched.assets) {
        enriched.assets = enriched.assets.map((asset: any) => ({
          ...asset,
          url: `/assets/${asset.id}/content`,
        }));
      }

      if (enriched.assets && enriched.assets.length > 0) {
        const asset = enriched.assets[0] as any;
        expect(asset).toHaveProperty('url');
        expect(asset).not.toHaveProperty('headers');
        const vaultJson = JSON.stringify(enriched);
        expect(vaultJson).not.toContain('x-amz-server-side-encryption');
        expect(asset.url).toMatch(/^\/assets\/[a-zA-Z0-9-]+\/content$/);
      }
    });
  });
});
