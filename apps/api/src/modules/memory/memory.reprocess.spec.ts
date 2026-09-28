import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FieldEncryptionService } from '../../common/crypto/field-encryption.service';
import { AiQueueService } from '../ai/ai-queue.service';
import { AssetsService } from '../assets/assets.service';
import { MemoryDeletionQueueService } from './deletion-queue.service';

// FACEBOOK-SCREENSHOT-UX-03: POST /memories/:id/reprocess state semantics.
describe('MemoryService.reprocessMemory', () => {
  let service: MemoryService;
  const UPDATED_AT = new Date('2026-09-28T10:00:00.000Z');
  const prisma = { memory: { findUnique: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
  const aiQueue = { enqueueUnderstanding: jest.fn(), requeueForReprocess: jest.fn() };

  const memory = (overrides: Record<string, unknown> = {}) => ({
    id: 'mem-1',
    userId: 'user-1',
    securityScope: 'private',
    processingState: 'failed',
    updatedAt: UPDATED_AT,
    ...overrides,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    aiQueue.requeueForReprocess.mockResolvedValue({ kind: 'requeued' });
    prisma.memory.updateMany.mockResolvedValue({ count: 1 });
    const moduleRef = await Test.createTestingModule({
      providers: [
        MemoryService,
        { provide: PrismaService, useValue: prisma },
        { provide: AiQueueService, useValue: aiQueue },
        { provide: AssetsService, useValue: {} },
        { provide: MemoryDeletionQueueService, useValue: {} },
        { provide: FieldEncryptionService, useValue: {} },
        { provide: ConfigService, useValue: { getOrThrow: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(MemoryService);
  });

  it.each(['failed', 'partial', 'understood'])(
    '%s Memory: requeues, then marks queued only if nothing wrote the Memory since it was read',
    async (processingState) => {
      prisma.memory.findUnique.mockResolvedValue(memory({ processingState }));

      await expect(service.reprocessMemory('user-1', 'mem-1')).resolves.toEqual({ id: 'mem-1', processingState: 'queued' });

      expect(aiQueue.requeueForReprocess).toHaveBeenCalledWith('mem-1');
      expect(aiQueue.enqueueUnderstanding).not.toHaveBeenCalled();
      expect(prisma.memory.updateMany).toHaveBeenCalledWith({
        where: { id: 'mem-1', processingState, updatedAt: UPDATED_AT },
        data: { processingState: 'queued' },
      });
      // The state write happens after the queue operation succeeded.
      expect(aiQueue.requeueForReprocess.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.memory.updateMany.mock.invocationCallOrder[0],
      );
    },
  );

  it.each(['queued', 'processing'])('%s Memory: no state write (the job owns the state)', async (processingState) => {
    prisma.memory.findUnique.mockResolvedValue(memory({ processingState }));

    await service.reprocessMemory('user-1', 'mem-1');

    expect(prisma.memory.updateMany).not.toHaveBeenCalled();
  });

  it('queue failure propagates and the Memory is never marked queued', async () => {
    prisma.memory.findUnique.mockResolvedValue(memory({ processingState: 'failed' }));
    aiQueue.requeueForReprocess.mockRejectedValueOnce(new Error('redis unavailable'));

    await expect(service.reprocessMemory('user-1', 'mem-1')).rejects.toThrow('redis unavailable');

    expect(prisma.memory.updateMany).not.toHaveBeenCalled();
  });

  // Outcomes that guarantee a processor run starting after the read: the guarded queued write.
  it.each([
    ['no job: enqueued', { kind: 'enqueued' }],
    ['terminally failed job: requeued', { kind: 'requeued' }],
    ['waiting job', { kind: 'pending', state: 'waiting' }],
    ['delayed automatic retry', { kind: 'pending', state: 'delayed' }],
    ['prioritized job', { kind: 'pending', state: 'prioritized' }],
    ['waiting-children job', { kind: 'pending', state: 'waiting-children' }],
  ])('%s: a failed Memory is marked queued (guarded)', async (_label, outcome) => {
    prisma.memory.findUnique.mockResolvedValue(memory({ processingState: 'failed' }));
    aiQueue.requeueForReprocess.mockResolvedValueOnce(outcome);

    await expect(service.reprocessMemory('user-1', 'mem-1')).resolves.toEqual({ id: 'mem-1', processingState: 'queued' });

    expect(prisma.memory.updateMany).toHaveBeenCalledWith({
      where: { id: 'mem-1', processingState: 'failed', updatedAt: UPDATED_AT },
      data: { processingState: 'queued' },
    });
  });

  // PR30 review MEDIUM 1: the processor writes its final state before BullMQ moves the job out of
  // active. A request that reads that final state and then sees the job still active must not mark
  // the Memory queued: the job will not run again, so it would stay queued with no job.
  it.each(['partial', 'failed'])(
    'DB already %s while the BullMQ job is still active: no queued write, state reported unchanged',
    async (processingState) => {
      prisma.memory.findUnique.mockResolvedValue(memory({ processingState }));
      aiQueue.requeueForReprocess.mockResolvedValueOnce({ kind: 'pending', state: 'active' });

      await expect(service.reprocessMemory('user-1', 'mem-1')).resolves.toEqual({ id: 'mem-1', processingState });

      expect(aiQueue.requeueForReprocess).toHaveBeenCalledWith('mem-1');
      expect(prisma.memory.updateMany).not.toHaveBeenCalled();
    },
  );

  it('a newer processor write after the read is never overwritten by the queued write', async () => {
    // Simulated row: updateMany applies its where clause like Postgres would.
    const row = { id: 'mem-1', processingState: 'failed', updatedAt: UPDATED_AT };
    prisma.memory.findUnique.mockResolvedValue(memory({ ...row }));
    prisma.memory.updateMany.mockImplementation(async ({ where, data }: any) => {
      const match =
        where.id === row.id &&
        where.processingState === row.processingState &&
        where.updatedAt.getTime() === row.updatedAt.getTime();
      if (match) Object.assign(row, data, { updatedAt: new Date(row.updatedAt.getTime() + 1) });
      return { count: match ? 1 : 0 };
    });
    // The re-queued job starts and finishes (partial) before the request's state write.
    aiQueue.requeueForReprocess.mockImplementationOnce(async () => {
      Object.assign(row, { processingState: 'processing', updatedAt: new Date(UPDATED_AT.getTime() + 5) });
      Object.assign(row, { processingState: 'partial', updatedAt: new Date(UPDATED_AT.getTime() + 9) });
      return { kind: 'requeued' };
    });

    await service.reprocessMemory('user-1', 'mem-1');

    expect(prisma.memory.updateMany).toHaveBeenCalledTimes(1);
    expect(row.processingState).toBe('partial');
  });

  it('Vault Memory: 404, nothing queued or written (unchanged)', async () => {
    prisma.memory.findUnique.mockResolvedValue(memory({ securityScope: 'vault' }));

    await expect(service.reprocessMemory('user-1', 'mem-1')).rejects.toBeInstanceOf(NotFoundException);

    expect(aiQueue.requeueForReprocess).not.toHaveBeenCalled();
    expect(prisma.memory.updateMany).not.toHaveBeenCalled();
  });

  it("another user's Memory: forbidden, nothing queued (unchanged)", async () => {
    prisma.memory.findUnique.mockResolvedValue(memory({ userId: 'user-2' }));

    await expect(service.reprocessMemory('user-1', 'mem-1')).rejects.toBeInstanceOf(ForbiddenException);

    expect(aiQueue.requeueForReprocess).not.toHaveBeenCalled();
  });

  it('missing Memory: 404', async () => {
    prisma.memory.findUnique.mockResolvedValue(null);

    await expect(service.reprocessMemory('user-1', 'mem-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
