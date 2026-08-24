import { Test, TestingModule } from '@nestjs/testing';
import { VaultService } from './vault.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

describe('VaultService', () => {
  let service: VaultService;
  let prismaService: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VaultService,
        {
          provide: PrismaService,
          useValue: {
            memory: {
              findUnique: jest.fn(),
              findMany: jest.fn(),
              update: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<VaultService>(VaultService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should lock a memory the user owns', async () => {
    const userId = 'user-123';
    const memoryId = 'mem-1';
    const mockMemory = { id: memoryId, userId };
    const lockedMemory = { ...mockMemory, securityScope: 'vault' };

    jest.spyOn(prismaService.memory, 'findUnique').mockResolvedValue(mockMemory as any);
    jest.spyOn(prismaService.memory, 'update').mockResolvedValue(lockedMemory as any);

    const result = await service.lock(userId, memoryId);

    expect(prismaService.memory.findUnique).toHaveBeenCalledWith({
      where: { id: memoryId },
      select: { id: true, userId: true },
    });
    expect(prismaService.memory.update).toHaveBeenCalledWith({
      where: { id: memoryId },
      data: { securityScope: 'vault' },
    });
    expect(result.securityScope).toBe('vault');
  });

  it('should throw ForbiddenException when locking a memory owned by someone else', async () => {
    const userId = 'user-123';
    const otherUserId = 'user-456';
    const memoryId = 'mem-1';
    const mockMemory = { id: memoryId, userId: otherUserId };

    jest.spyOn(prismaService.memory, 'findUnique').mockResolvedValue(mockMemory as any);

    await expect(service.lock(userId, memoryId)).rejects.toThrow(ForbiddenException);
  });

  it('should throw NotFoundException when locking a non-existent memory', async () => {
    const userId = 'user-123';
    const memoryId = 'mem-1';

    jest.spyOn(prismaService.memory, 'findUnique').mockResolvedValue(null);

    await expect(service.lock(userId, memoryId)).rejects.toThrow(NotFoundException);
  });

  it('should unlock a vault memory', async () => {
    const userId = 'user-123';
    const memoryId = 'mem-1';
    const mockMemory = { id: memoryId, userId };
    const unlockedMemory = { ...mockMemory, securityScope: 'private' };

    jest.spyOn(prismaService.memory, 'findUnique').mockResolvedValue(mockMemory as any);
    jest.spyOn(prismaService.memory, 'update').mockResolvedValue(unlockedMemory as any);

    const result = await service.unlock(userId, memoryId);

    expect(prismaService.memory.update).toHaveBeenCalledWith({
      where: { id: memoryId },
      data: { securityScope: 'private' },
    });
    expect(result.securityScope).toBe('private');
  });

  it('should list only vault memories for user', async () => {
    const userId = 'user-123';
    const mockMemories = [
      { id: 'mem-1', userId, securityScope: 'vault' },
      { id: 'mem-2', userId, securityScope: 'vault' },
    ];

    jest.spyOn(prismaService.memory, 'findMany').mockResolvedValue(mockMemories as any);

    const result = await service.findAllForUser(userId);

    expect(prismaService.memory.findMany).toHaveBeenCalledWith({
      where: {
        userId,
        lifecycleState: { not: 'deleted' },
        securityScope: 'vault',
      },
      orderBy: { capturedAt: 'desc' },
    });
    expect(result).toEqual(mockMemories);
  });

  it('should retrieve a single vault memory for user', async () => {
    const userId = 'user-123';
    const memoryId = 'mem-1';
    const mockMemory = {
      id: memoryId,
      userId,
      securityScope: 'vault',
      assets: [],
      aiInferences: [],
      userConfirmations: [],
    };

    jest.spyOn(prismaService.memory, 'findUnique').mockResolvedValue(mockMemory as any);

    const result = await service.findOneForUser(userId, memoryId);

    expect(prismaService.memory.findUnique).toHaveBeenCalledWith({
      where: { id: memoryId },
      include: { assets: true, aiInferences: true, userConfirmations: true },
    });
    expect(result).toEqual(mockMemory);
  });

  it('should throw NotFoundException when retrieving a non-vault memory via vault endpoint', async () => {
    const userId = 'user-123';
    const memoryId = 'mem-1';
    const mockMemory = {
      id: memoryId,
      userId,
      securityScope: 'private',
      assets: [],
      aiInferences: [],
      userConfirmations: [],
    };

    jest.spyOn(prismaService.memory, 'findUnique').mockResolvedValue(mockMemory as any);

    await expect(service.findOneForUser(userId, memoryId)).rejects.toThrow(
      NotFoundException,
    );
  });
});
