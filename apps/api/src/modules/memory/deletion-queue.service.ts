import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export const MEMORY_DELETION_QUEUE = 'memory-deletion';

export interface MemoryDeletionJobData {
  memoryId: string;
}

@Injectable()
export class MemoryDeletionQueueService {
  constructor(
    @InjectQueue(MEMORY_DELETION_QUEUE) private readonly queue: Queue<MemoryDeletionJobData>,
  ) {}

  async enqueueFinalization(memoryId: string) {
    await this.queue.add(
      'finalize',
      { memoryId },
      {
        jobId: memoryId,
        delay: 30 * 24 * 60 * 60 * 1000, // 30 days
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }

  async cancelFinalization(memoryId: string) {
    try {
      const job = await this.queue.getJob(memoryId);
      if (job) {
        await job.remove();
      }
    } catch (err) {
      // Job doesn't exist or already processed — this is fine
    }
  }
}
