import { AiQueueService } from './ai-queue.service';

// The complete-upload retry path relies on these queue options (PR29 review M2): jobId = memoryId
// makes adding a job for a Memory whose job still exists a no-op in BullMQ, and completed jobs are
// removed, so a new job is only possible after a run finished.
describe('AiQueueService', () => {
  it('uses the Memory id as a deterministic job id, with the documented retention options', async () => {
    const queue = { add: jest.fn().mockResolvedValue({}) };
    const service = new AiQueueService(queue as any);

    await service.enqueueUnderstanding('mem-1');
    await service.enqueueUnderstanding('mem-1');

    expect(queue.add).toHaveBeenCalledTimes(2);
    for (const call of queue.add.mock.calls) {
      expect(call).toEqual([
        'understand',
        { memoryId: 'mem-1' },
        {
          jobId: 'mem-1',
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      ]);
    }
  });
});
