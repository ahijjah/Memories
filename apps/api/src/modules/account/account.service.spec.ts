import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import { AccountService } from './account.service';
import { PrismaService } from '../../common/prisma/prisma.service';

jest.mock('@aws-sdk/client-s3');
jest.mock('@clerk/backend');

describe('AccountService', () => {
  let service: AccountService;
  let prisma: PrismaService;
  let config: ConfigService;

  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    displayName: 'Test User',
    locale: 'en',
    plan: 'free',
    preferences: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    clerkUserId: 'clerk-1',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountService,
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: jest.fn(),
              delete: jest.fn(),
            },
            memory: {
              findMany: jest.fn(),
            },
            memoryAsset: {
              findMany: jest.fn(),
            },
            collection: {
              findMany: jest.fn(),
            },
            reminder: {
              findMany: jest.fn(),
            },
          },
        },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => {
              const config: Record<string, string> = {
                OBJECT_STORAGE_ENDPOINT: 'http://localhost:9000',
                OBJECT_STORAGE_ACCESS_KEY: 'minioadmin',
                OBJECT_STORAGE_SECRET_KEY: 'minioadmin',
                OBJECT_STORAGE_BUCKET: 'memories',
              };
              return config[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get<AccountService>(AccountService);
    prisma = module.get<PrismaService>(PrismaService);
    config = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('export', () => {
    it('should return all user data scoped to userId', async () => {
      const memories = [
        { id: 'mem-1', title: 'Memory 1', securityScope: 'private', assets: [] },
        { id: 'mem-2', title: 'Memory 2', securityScope: 'vault', assets: [] },
      ];
      const collections = [
        {
          id: 'col-1',
          name: 'Collection 1',
          memories: [{ memoryId: 'mem-1' }],
        },
      ];
      const reminders = [
        {
          id: 'rem-1',
          memoryId: 'mem-1',
          status: 'pending',
        },
      ];

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.memory.findMany as jest.Mock).mockResolvedValue(memories);
      (prisma.collection.findMany as jest.Mock).mockResolvedValue(collections);
      (prisma.reminder.findMany as jest.Mock).mockResolvedValue(reminders);

      const result = await service.export('user-1');

      expect(result.user).toEqual(mockUser);
      expect(result.memories).toContainEqual(
        expect.objectContaining({ id: 'mem-2', securityScope: 'vault' }),
      );
      expect(result.collections).toHaveLength(1);
      expect(result.reminders).toHaveLength(1);
    });

    it('should include vault-scoped memories in export', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.memory.findMany as jest.Mock).mockResolvedValue([
        { id: 'mem-1', securityScope: 'vault', assets: [] },
      ]);
      (prisma.collection.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.reminder.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.export('user-1');

      expect(result.memories).toContainEqual(
        expect.objectContaining({ securityScope: 'vault' }),
      );
    });
  });

  describe('deleteAccount', () => {
    it('should throw BadRequestException if email does not match', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      await expect(
        service.deleteAccount('user-1', 'wrong@example.com'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should perform case-insensitive email match', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.memoryAsset.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.user.delete as jest.Mock).mockResolvedValue(mockUser);

      const result = await service.deleteAccount('user-1', 'TEST@EXAMPLE.COM');

      expect(result.deleted).toBe(true);
      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
    });

    it('should fetch and delete all assets before user deletion', async () => {
      const assets = [
        { objectKey: 'memories/mem-1/asset-1' },
        { objectKey: 'memories/mem-1/asset-2' },
      ];

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.memoryAsset.findMany as jest.Mock).mockResolvedValue(assets);
      (prisma.user.delete as jest.Mock).mockResolvedValue(mockUser);

      await service.deleteAccount('user-1', 'test@example.com');

      expect(prisma.memoryAsset.findMany).toHaveBeenCalledWith({
        where: { memory: { userId: 'user-1' } },
        select: { objectKey: true },
      });
      expect(prisma.user.delete).toHaveBeenCalled();
    });

    it('should handle asset deletion failures gracefully', async () => {
      const assets = [
        { objectKey: 'memories/mem-1/asset-1' },
        { objectKey: 'memories/mem-1/asset-2' },
      ];

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.memoryAsset.findMany as jest.Mock).mockResolvedValue(assets);
      (prisma.user.delete as jest.Mock).mockResolvedValue(mockUser);

      (S3Client.prototype.send as jest.Mock) = jest
        .fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({});

      const result = await service.deleteAccount('user-1', 'test@example.com');

      expect(result.assetCleanupFailures).toBe(1);
      expect(result.deleted).toBe(true);
    });

    it('should delete user via Prisma cascade', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.memoryAsset.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.user.delete as jest.Mock).mockResolvedValue(mockUser);

      await service.deleteAccount('user-1', 'test@example.com');

      expect(prisma.user.delete).toHaveBeenCalledWith({
        where: { id: 'user-1' },
      });
    });

    it('should return { deleted: true, assetCleanupFailures: 0 } on success', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.memoryAsset.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.user.delete as jest.Mock).mockResolvedValue(mockUser);

      const result = await service.deleteAccount('user-1', 'test@example.com');

      expect(result).toEqual({
        deleted: true,
        assetCleanupFailures: 0,
      });
    });
  });
});
