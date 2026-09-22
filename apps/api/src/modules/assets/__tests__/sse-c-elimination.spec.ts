import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { FieldEncryptionService } from '../../../common/crypto/field-encryption.service';
import { AiQueueService } from '../../ai/ai-queue.service';
import { MemoryDeletionQueueService } from '../../memory/deletion-queue.service';
import { MemoryService } from '../../memory/memory.service';
import { CollectionsService } from '../../collections/collections.service';
import { VaultService } from '../../vault/vault.service';
import { AssetsService } from '../assets.service';

describe('SSE-C Header Elimination from Read Responses', () => {
  let memoryService: MemoryService;
  let collectionsService: CollectionsService;
  let vaultService: VaultService;
  let prismaService: PrismaService;

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
    variant: 'original' as const,
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
    lifecycleState: 'active' as const,
    securityScope: 'private' as const,
    idempotencyKey: 'key-123',
    assets: [mockAsset],
    aiInferences: [],
    userConfirmations: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockVaultMemory = {
    ...mockMemory,
    securityScope: 'vault' as const,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemoryService,
        CollectionsService,
        VaultService,
        {
          provide: PrismaService,
          useValue: {
            memory: {
              findUnique: jest.fn(),
              findMany: jest.fn(),
              update: jest.fn(),
            },
            collection: {
              findUnique: jest.fn(),
            },
          },
        },
        {
          provide: AiQueueService,
          useValue: {
            enqueueUnderstanding: jest.fn(),
          },
        },
        {
          provide: MemoryDeletionQueueService,
          useValue: {},
        },
        {
          provide: FieldEncryptionService,
          useValue: {
            encrypt: jest.fn(),
            decrypt: jest.fn(),
          },
        },
        {
          provide: AssetsService,
          useValue: {},
        },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn(),
          },
        },
      ],
    }).compile();

    memoryService = module.get<MemoryService>(MemoryService);
    collectionsService = module.get<CollectionsService>(CollectionsService);
    vaultService = module.get<VaultService>(VaultService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  describe('MemoryService.findOneForUser enrichment', () => {
    it('should return assets with url property and WITHOUT headers field', async () => {
      (prismaService.memory.findUnique as jest.Mock).mockResolvedValue({
        ...mockMemory,
        memory: mockMemory,
      });

      const result = await memoryService.findOneForUser(mockUserId, mockMemoryId);

      expect(result).toBeDefined();
      if (result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        expect(asset).toHaveProperty('url');
        expect(asset.url).toBe(`/assets/${mockAssetId}/content`);
        expect(asset).not.toHaveProperty('headers');
      }
    });

    it('should NOT contain SSE-C algorithm header in stringified response', async () => {
      (prismaService.memory.findUnique as jest.Mock).mockResolvedValue(mockMemory);

      const result = await memoryService.findOneForUser(mockUserId, mockMemoryId);
      const assetJson = JSON.stringify(result);

      expect(assetJson).not.toContain('x-amz-server-side-encryption-customer-algorithm');
    });

    it('should NOT contain SSE-C key material in stringified response', async () => {
      (prismaService.memory.findUnique as jest.Mock).mockResolvedValue(mockMemory);

      const result = await memoryService.findOneForUser(mockUserId, mockMemoryId);
      const assetJson = JSON.stringify(result);

      expect(assetJson).not.toContain('x-amz-server-side-encryption-customer-key');
    });

    it('should NOT contain SSE-C MD5 in stringified response', async () => {
      (prismaService.memory.findUnique as jest.Mock).mockResolvedValue(mockMemory);

      const result = await memoryService.findOneForUser(mockUserId, mockMemoryId);
      const assetJson = JSON.stringify(result);

      expect(assetJson).not.toContain('x-amz-server-side-encryption-customer-key-MD5');
    });

    it('should return authenticated content URL pattern, not presigned GET', async () => {
      (prismaService.memory.findUnique as jest.Mock).mockResolvedValue(mockMemory);

      const result = await memoryService.findOneForUser(mockUserId, mockMemoryId);

      if (result.assets && result.assets.length > 0) {
        const url = (result.assets[0] as any).url;
        expect(url).toMatch(/^\/assets\/[a-zA-Z0-9-]+\/content$/);
        expect(url).not.toContain('X-Amz-Algorithm');
        expect(url).not.toContain('X-Amz-Credential');
        expect(url).not.toContain('X-Amz-SignedHeaders');
      }
    });

    it('should preserve essential asset fields except headers', async () => {
      (prismaService.memory.findUnique as jest.Mock).mockResolvedValue(mockMemory);

      const result = await memoryService.findOneForUser(mockUserId, mockMemoryId);

      if (result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
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
  });

  describe('CollectionsService.findOneForUser enrichment', () => {
    it('should enrich nested memories with asset URLs without SSE-C headers', async () => {
      const mockCollection = {
        id: mockCollectionId,
        userId: mockUserId,
        name: 'Test Collection',
        description: 'Test',
        createdAt: new Date(),
        updatedAt: new Date(),
        memories: [
          {
            addedAt: new Date(),
            memory: mockMemory,
          },
        ],
      };

      (prismaService.collection.findUnique as jest.Mock).mockResolvedValue(mockCollection);

      const result = await collectionsService.findOneForUser(mockUserId, mockCollectionId);

      expect(result).toBeDefined();
      if (result.memories && result.memories[0]?.memory?.assets) {
        const asset = result.memories[0].memory.assets[0];
        expect(asset).toHaveProperty('url');
        expect(asset).not.toHaveProperty('headers');
        const collectionJson = JSON.stringify(result);
        expect(collectionJson).not.toContain('x-amz-server-side-encryption');
      }
    });
  });

  describe('VaultService.findOneForUser enrichment', () => {
    it('should enrich vault memories with asset URLs without SSE-C headers', async () => {
      (prismaService.memory.findUnique as jest.Mock).mockResolvedValue(mockVaultMemory);

      const result = await vaultService.findOneForUser(mockUserId, mockMemoryId);

      expect(result).toBeDefined();
      if (result.assets && result.assets.length > 0) {
        const asset = result.assets[0] as any;
        expect(asset).toHaveProperty('url');
        expect(asset).not.toHaveProperty('headers');
        const vaultJson = JSON.stringify(result);
        expect(vaultJson).not.toContain('x-amz-server-side-encryption');
        expect(asset.url).toMatch(/^\/assets\/[a-zA-Z0-9-]+\/content$/);
      }
    });
  });
});
