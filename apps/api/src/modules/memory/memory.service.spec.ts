import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FieldEncryptionService } from '../../common/crypto/field-encryption.service';
import { AiQueueService } from '../ai/ai-queue.service';
import { AssetsService } from '../assets/assets.service';
import { MemoryDeletionQueueService } from './deletion-queue.service';

describe('MemoryService', () => {
  let service: MemoryService;
  const prismaMock = {
    memory: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
    },
  };
  const aiQueueMock = { enqueueUnderstanding: jest.fn() };
  const assetsMock = { getViewUrl: jest.fn().mockReturnValue('http://mock-url') };
  const deletionQueueMock = { enqueueFinalization: jest.fn(), cancelFinalization: jest.fn() };
  const fieldEncryptionMock = {
    encrypt: jest.fn((val) => `encrypted:${val}`),
    decrypt: jest.fn((val) => val.replace(/^encrypted:/, '')),
  };
  const configMock = {
    getOrThrow: (key: string) => {
      if (key === 'ANTHROPIC_API_KEY') return 'test-api-key';
      throw new Error(`Unknown config key: ${key}`);
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        MemoryService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AiQueueService, useValue: aiQueueMock },
        { provide: AssetsService, useValue: assetsMock },
        { provide: MemoryDeletionQueueService, useValue: deletionQueueMock },
        { provide: FieldEncryptionService, useValue: fieldEncryptionMock },
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();

    service = moduleRef.get(MemoryService);
  });

  it('creates a new Memory and enqueues AI understanding (spec §8)', async () => {
    prismaMock.memory.findUnique.mockResolvedValue(null);
    prismaMock.memory.create.mockResolvedValue({ id: 'mem-1', userId: 'user-1' });

    const result = await service.create('user-1', {
      sourceType: 'url',
      sourceUri: 'https://example.com',
      idempotencyKey: 'key-1',
    } as any);

    expect(prismaMock.memory.create).toHaveBeenCalledTimes(1);
    expect(aiQueueMock.enqueueUnderstanding).toHaveBeenCalledWith('mem-1');
    expect(result.id).toBe('mem-1');
  });

  it('returns the existing Memory instead of duplicating on retry (BR §3, spec §17)', async () => {
    prismaMock.memory.findUnique.mockResolvedValue({ id: 'mem-1', userId: 'user-1' });

    const result = await service.create('user-1', {
      sourceType: 'url',
      idempotencyKey: 'key-1',
    } as any);

    expect(prismaMock.memory.create).not.toHaveBeenCalled();
    expect(aiQueueMock.enqueueUnderstanding).not.toHaveBeenCalled();
    expect(result.id).toBe('mem-1');
  });

  it('rejects retrying another user\'s idempotency key (FR-SEC-001)', async () => {
    prismaMock.memory.findUnique.mockResolvedValue({ id: 'mem-1', userId: 'someone-else' });

    await expect(
      service.create('user-1', { sourceType: 'url', idempotencyKey: 'key-1' } as any),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws NotFoundException when retrieving a vault-scoped Memory via findOneForUser', async () => {
    const vaultMemory = {
      id: 'mem-1',
      userId: 'user-1',
      securityScope: 'vault',
      assets: [],
      aiInferences: [],
      userConfirmations: [],
    };
    prismaMock.memory.findUnique.mockResolvedValue(vaultMemory);

    await expect(service.findOneForUser('user-1', 'mem-1')).rejects.toThrow(
      NotFoundException,
    );
  });
});
