import { Test, TestingModule } from '@nestjs/testing';
import { VaultService } from './vault.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FieldEncryptionService } from '../../common/crypto/field-encryption.service';
import { AssetsService } from '../assets/assets.service';
import { MemoryDeletionQueueService } from '../memory/deletion-queue.service';
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
        {
          provide: AssetsService,
          useValue: {
            getViewUrl: jest.fn().mockReturnValue('http://mock-url'),
          },
        },
        {
          provide: MemoryDeletionQueueService,
          useValue: {
            enqueueFinalization: jest.fn(),
            cancelFinalization: jest.fn(),
          },
        },
        {
          provide: FieldEncryptionService,
          useValue: {
            encrypt: jest.fn((val) => `encrypted:${val}`),
            decrypt: jest.fn((val) => val.replace(/^encrypted:/, '')),
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
        lifecycleState: { notIn: ['deleted', 'deleted_pending'] },
        securityScope: 'vault',
      },
      include: { assets: true },
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
      include: {
        assets: true,
        aiInferences: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
        userConfirmations: true,
      },
    });
    // Existing shape unchanged, plus the additive `resolved` object (nothing resolvable here).
    expect(result).toEqual({ ...mockMemory, resolved: {} });
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

  it('should get processing status for a vault memory', async () => {
    const userId = 'user-123';
    const memoryId = 'mem-1';
    const mockProcessingStatus = {
      id: memoryId,
      userId,
      processingState: 'processing',
      updatedAt: new Date(),
      securityScope: 'vault',
    };

    jest.spyOn(prismaService.memory, 'findUnique').mockResolvedValue(mockProcessingStatus as any);

    const result = await service.getProcessingStatus(userId, memoryId);

    expect(prismaService.memory.findUnique).toHaveBeenCalledWith({
      where: { id: memoryId },
      select: { id: true, userId: true, processingState: true, updatedAt: true, securityScope: true },
    });
    expect(result.processingState).toBe('processing');
  });

  it('should throw NotFoundException when getting processing status for non-existent memory', async () => {
    const userId = 'user-123';
    const memoryId = 'mem-1';

    jest.spyOn(prismaService.memory, 'findUnique').mockResolvedValue(null);

    await expect(service.getProcessingStatus(userId, memoryId)).rejects.toThrow(NotFoundException);
  });

  it('should throw ForbiddenException when getting processing status for memory owned by another user', async () => {
    const userId = 'user-123';
    const otherUserId = 'user-456';
    const memoryId = 'mem-1';
    const mockMemory = {
      id: memoryId,
      userId: otherUserId,
      processingState: 'processing',
      updatedAt: new Date(),
      securityScope: 'vault',
    };

    jest.spyOn(prismaService.memory, 'findUnique').mockResolvedValue(mockMemory as any);

    await expect(service.getProcessingStatus(userId, memoryId)).rejects.toThrow(ForbiddenException);
  });

  it('should throw NotFoundException when getting processing status for non-vault memory', async () => {
    const userId = 'user-123';
    const memoryId = 'mem-1';
    const mockMemory = {
      id: memoryId,
      userId,
      processingState: 'processing',
      updatedAt: new Date(),
      securityScope: 'private',
    };

    jest.spyOn(prismaService.memory, 'findUnique').mockResolvedValue(mockMemory as any);

    await expect(service.getProcessingStatus(userId, memoryId)).rejects.toThrow(NotFoundException);
  });

  describe('Resolved Memory public contract (PR2)', () => {
    const t1 = new Date('2026-01-01T00:00:00.000Z');
    const t2 = new Date('2026-02-01T00:00:00.000Z');
    const vaultMemory = () => ({
      id: 'vault-1',
      userId: 'user-123',
      title: 'Raw scan',
      memoryType: 'DOCUMENT',
      securityScope: 'vault',
      assets: [],
      aiInferences: [
        { id: 'b', field: 'documentNumber', valueJson: 'encrypted:P7654321', confidence: 0.9, createdAt: t2 },
        { id: 'a', field: 'title', valueJson: 'Passport', confidence: 0.8, createdAt: t1 },
        { id: 'c', field: 'type', valueJson: 'DOCUMENT', confidence: 0.75, createdAt: t1 },
      ],
      userConfirmations: [
        { id: 'uc1', field: 'owner', confirmedValue: 'encrypted:Jane Doe', createdAt: t1 },
        { id: 'uc2', field: 'notes', confirmedValue: 'Keep in the safe', createdAt: t1 },
      ],
    });

    it('adds resolved from decrypted rows, excludes notes, and keeps the raw arrays', async () => {
      jest.spyOn(prismaService.memory, 'findUnique').mockResolvedValue(vaultMemory() as any);

      const result: any = await service.findOneForUser('user-123', 'vault-1');

      expect(result.resolved).toEqual({
        title: { value: 'Passport', source: 'ai', confidence: 0.8 },
        type: { value: 'DOCUMENT', source: 'ai', confidence: 0.75 },
        documentNumber: { value: 'P7654321', source: 'ai', confidence: 0.9 },
        owner: { value: 'Jane Doe', source: 'user', confidence: null },
      });
      expect(result.resolved).not.toHaveProperty('notes');
      expect(JSON.stringify(result.resolved)).not.toContain('encrypted:');
      // Raw evidence and history unchanged (existing decryption still applies to them).
      expect(result.title).toBe('Raw scan');
      expect(result.memoryType).toBe('DOCUMENT');
      expect(result.aiInferences.map((row: any) => row.id)).toEqual(['b', 'a', 'c']);
      expect(result.aiInferences[0].valueJson).toBe('P7654321');
      expect(result.userConfirmations.map((row: any) => row.field)).toEqual(['owner', 'notes']);
      expect(result.userConfirmations[1].confirmedValue).toBe('Keep in the safe');
    });

    it('keeps ownership and Vault scoping before any resolution', async () => {
      jest.spyOn(prismaService.memory, 'findUnique').mockResolvedValue({ ...vaultMemory(), userId: 'other-user' } as any);
      await expect(service.findOneForUser('user-123', 'vault-1')).rejects.toThrow(ForbiddenException);

      jest.spyOn(prismaService.memory, 'findUnique').mockResolvedValue({ ...vaultMemory(), securityScope: 'private' } as any);
      await expect(service.findOneForUser('user-123', 'vault-1')).rejects.toThrow(NotFoundException);
    });
  });
});
