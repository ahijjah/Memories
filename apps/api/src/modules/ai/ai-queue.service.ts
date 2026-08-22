import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export const AI_PROCESSING_QUEUE = 'ai-processing';

export interface AiProcessingJobData {
  memoryId: string;
}

@Injectable()
export class AiQueueService {
  constructor(
    @InjectQueue(AI_PROCESSING_QUEUE) private readonly queue: Queue<AiProcessingJobData>,
  ) {}

  // Idempotency: jobId = memoryId means re-enqueueing the same Memory
  // (e.g. on retry) does not create a duplicate job (spec §8, §17).
  async enqueueUnderstanding(memoryId: string) {
    await this.queue.add(
      'understand',
      { memoryId },
      {
        jobId: memoryId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false, // keep failures for dead-letter inspection, spec §17
      },
    );
  }
}
