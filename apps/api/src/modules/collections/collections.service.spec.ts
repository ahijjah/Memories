import { Test, TestingModule } from '@nestjs/testing';
import { CollectionsService } from './collections.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

describe('CollectionsService', () => {
  let service: CollectionsService;
  let prismaService: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CollectionsService,
        {
          provide: PrismaService,
          useValue: {
            collection: {
              create: jest.fn(),
              findUnique: jest.fn(),
              findMany: jest.fn(),
              delete: jest.fn(),
            },
            collectionMemory: {
              upsert: jest.fn(),
              deleteMany: jest.fn(),
            },
            memory: {
              findUnique: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<CollectionsService>(CollectionsService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a collection owned by the user', async () => {
      const userId = 'user-123';
      const mockCollection = {
        id: 'coll-1',
        userId,
        name: 'My Collection',
        description: 'A test collection',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest.spyOn(prismaService.collection, 'create').mockResolvedValue(mockCollection as any);

      const result = await service.create(userId, {
        name: 'My Collection',
        description: 'A test collection',
      });

      expect(prismaService.collection.create).toHaveBeenCalledWith({
        data: {
          userId,
          name: 'My Collection',
          description: 'A test collection',
        },
      });
      expect(result.id).toBe('coll-1');
      expect(result.userId).toBe(userId);
    });
  });

  describe('findAllForUser', () => {
    it('should list the user\'s own collections', async () => {
      const userId = 'user-123';
      const mockCollections = [
        { id: 'coll-1', userId, name: 'Collection 1' },
        { id: 'coll-2', userId, name: 'Collection 2' },
      ];

      jest.spyOn(prismaService.collection, 'findMany').mockResolvedValue(mockCollections as any);

      const result = await service.findAllForUser(userId);

      expect(prismaService.collection.findMany).toHaveBeenCalledWith({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual(mockCollections);
    });
  });

  describe('findOneForUser', () => {
    it('should retrieve a collection with its memories', async () => {
      const userId = 'user-123';
      const collectionId = 'coll-1';
      const mockCollection = {
        id: collectionId,
        userId,
        name: 'My Collection',
        memories: [
          {
            memory: {
              id: 'mem-1',
              userId,
              securityScope: 'private',
            },
            addedAt: new Date(),
          },
        ],
      };

      jest.spyOn(prismaService.collection, 'findUnique').mockResolvedValue(mockCollection as any);

      const result = await service.findOneForUser(userId, collectionId);

      expect(prismaService.collection.findUnique).toHaveBeenCalledWith({
        where: { id: collectionId },
        include: {
          memories: {
            include: { memory: true },
            orderBy: { addedAt: 'desc' },
          },
        },
      });
      expect(result.id).toBe(collectionId);
      expect(result.memories.length).toBe(1);
    });

    it('should exclude vault-scoped memories as defense-in-depth', async () => {
      const userId = 'user-123';
      const collectionId = 'coll-1';
      const mockCollection = {
        id: collectionId,
        userId,
        name: 'My Collection',
        memories: [
          {
            memory: {
              id: 'mem-1',
              userId,
              securityScope: 'private',
            },
            addedAt: new Date(),
          },
          {
            memory: {
              id: 'mem-2',
              userId,
              securityScope: 'vault',
            },
            addedAt: new Date(),
          },
        ],
      };

      jest.spyOn(prismaService.collection, 'findUnique').mockResolvedValue(mockCollection as any);

      const result = await service.findOneForUser(userId, collectionId);

      expect(result.memories.length).toBe(1);
      expect(result.memories[0].memory.id).toBe('mem-1');
    });

    it('should throw NotFoundException when collection not found', async () => {
      const userId = 'user-123';
      const collectionId = 'coll-1';

      jest.spyOn(prismaService.collection, 'findUnique').mockResolvedValue(null);

      await expect(service.findOneForUser(userId, collectionId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException when collection belongs to another user', async () => {
      const userId = 'user-123';
      const otherUserId = 'user-456';
      const collectionId = 'coll-1';
      const mockCollection = {
        id: collectionId,
        userId: otherUserId,
        memories: [],
      };

      jest.spyOn(prismaService.collection, 'findUnique').mockResolvedValue(mockCollection as any);

      await expect(service.findOneForUser(userId, collectionId)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('delete', () => {
    it('should delete a collection owned by the user', async () => {
      const userId = 'user-123';
      const collectionId = 'coll-1';
      const mockCollection = { id: collectionId, userId };

      jest.spyOn(prismaService.collection, 'findUnique').mockResolvedValue(mockCollection as any);
      jest.spyOn(prismaService.collection, 'delete').mockResolvedValue(mockCollection as any);

      const result = await service.delete(userId, collectionId);

      expect(prismaService.collection.findUnique).toHaveBeenCalledWith({
        where: { id: collectionId },
        select: { id: true, userId: true },
      });
      expect(prismaService.collection.delete).toHaveBeenCalledWith({
        where: { id: collectionId },
      });
      expect(result.id).toBe(collectionId);
    });

    it('should throw ForbiddenException when deleting another user\'s collection', async () => {
      const userId = 'user-123';
      const otherUserId = 'user-456';
      const collectionId = 'coll-1';
      const mockCollection = { id: collectionId, userId: otherUserId };

      jest.spyOn(prismaService.collection, 'findUnique').mockResolvedValue(mockCollection as any);

      await expect(service.delete(userId, collectionId)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('addMemory', () => {
    it('should add a memory the user owns to the collection', async () => {
      const userId = 'user-123';
      const collectionId = 'coll-1';
      const memoryId = 'mem-1';
      const mockCollection = { id: collectionId, userId };
      const mockMemory = { id: memoryId, userId, securityScope: 'private' };
      const mockCollectionMemory = { id: 'cm-1', collectionId, memoryId };

      jest.spyOn(prismaService.collection, 'findUnique').mockResolvedValue(mockCollection as any);
      jest.spyOn(prismaService.memory, 'findUnique').mockResolvedValue(mockMemory as any);
      jest.spyOn(prismaService.collectionMemory, 'upsert').mockResolvedValue(mockCollectionMemory as any);

      const result = await service.addMemory(userId, collectionId, memoryId);

      expect(prismaService.collection.findUnique).toHaveBeenCalledWith({
        where: { id: collectionId },
        select: { id: true, userId: true },
      });
      expect(prismaService.memory.findUnique).toHaveBeenCalledWith({
        where: { id: memoryId },
        select: { id: true, userId: true, securityScope: true },
      });
      expect(prismaService.collectionMemory.upsert).toHaveBeenCalled();
      expect(result.id).toBe('cm-1');
    });

    it('should throw BadRequestException when adding a vault-scoped memory', async () => {
      const userId = 'user-123';
      const collectionId = 'coll-1';
      const memoryId = 'mem-1';
      const mockCollection = { id: collectionId, userId };
      const mockMemory = { id: memoryId, userId, securityScope: 'vault' };

      jest.spyOn(prismaService.collection, 'findUnique').mockResolvedValue(mockCollection as any);
      jest.spyOn(prismaService.memory, 'findUnique').mockResolvedValue(mockMemory as any);

      await expect(service.addMemory(userId, collectionId, memoryId)).rejects.toThrow(
        BadRequestException,
      );
      expect(
        await service.addMemory(userId, collectionId, memoryId).catch((e) => e.message),
      ).toContain('Vault content cannot be added to a Collection');
    });

    it('should throw ForbiddenException when adding a memory owned by someone else', async () => {
      const userId = 'user-123';
      const otherUserId = 'user-456';
      const collectionId = 'coll-1';
      const memoryId = 'mem-1';
      const mockCollection = { id: collectionId, userId };
      const mockMemory = { id: memoryId, userId: otherUserId, securityScope: 'private' };

      jest.spyOn(prismaService.collection, 'findUnique').mockResolvedValue(mockCollection as any);
      jest.spyOn(prismaService.memory, 'findUnique').mockResolvedValue(mockMemory as any);

      await expect(service.addMemory(userId, collectionId, memoryId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw NotFoundException when collection doesn\'t exist', async () => {
      const userId = 'user-123';
      const collectionId = 'coll-1';
      const memoryId = 'mem-1';

      jest.spyOn(prismaService.collection, 'findUnique').mockResolvedValue(null);

      await expect(service.addMemory(userId, collectionId, memoryId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when memory doesn\'t exist', async () => {
      const userId = 'user-123';
      const collectionId = 'coll-1';
      const memoryId = 'mem-1';
      const mockCollection = { id: collectionId, userId };

      jest.spyOn(prismaService.collection, 'findUnique').mockResolvedValue(mockCollection as any);
      jest.spyOn(prismaService.memory, 'findUnique').mockResolvedValue(null);

      await expect(service.addMemory(userId, collectionId, memoryId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('removeMemory', () => {
    it('should remove a memory from the collection', async () => {
      const userId = 'user-123';
      const collectionId = 'coll-1';
      const memoryId = 'mem-1';
      const mockCollection = { id: collectionId, userId };

      jest.spyOn(prismaService.collection, 'findUnique').mockResolvedValue(mockCollection as any);
      jest.spyOn(prismaService.collectionMemory, 'deleteMany').mockResolvedValue({ count: 1 });

      const result = await service.removeMemory(userId, collectionId, memoryId);

      expect(prismaService.collection.findUnique).toHaveBeenCalledWith({
        where: { id: collectionId },
        select: { id: true, userId: true },
      });
      expect(prismaService.collectionMemory.deleteMany).toHaveBeenCalledWith({
        where: { collectionId, memoryId },
      });
      expect(result.success).toBe(true);
    });

    it('should throw ForbiddenException when removing from another user\'s collection', async () => {
      const userId = 'user-123';
      const otherUserId = 'user-456';
      const collectionId = 'coll-1';
      const memoryId = 'mem-1';
      const mockCollection = { id: collectionId, userId: otherUserId };

      jest.spyOn(prismaService.collection, 'findUnique').mockResolvedValue(mockCollection as any);

      await expect(service.removeMemory(userId, collectionId, memoryId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw NotFoundException when memory not in collection', async () => {
      const userId = 'user-123';
      const collectionId = 'coll-1';
      const memoryId = 'mem-1';
      const mockCollection = { id: collectionId, userId };

      jest.spyOn(prismaService.collection, 'findUnique').mockResolvedValue(mockCollection as any);
      jest.spyOn(prismaService.collectionMemory, 'deleteMany').mockResolvedValue({ count: 0 });

      await expect(service.removeMemory(userId, collectionId, memoryId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
