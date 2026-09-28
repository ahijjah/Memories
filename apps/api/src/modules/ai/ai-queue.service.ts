import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export const AI_PROCESSING_QUEUE = 'ai-processing';

export interface AiProcessingJobData {
  memoryId: string;
}

/**
 * What an explicit reprocess did to the queue:
 * - enqueued: no job existed for the Memory; a normal job was added.
 * - requeued: the Memory's job had finished (terminally failed, or completed and still retained);
 *   it was moved back to waiting with a fresh attempt budget, same jobId and options.
 * - pending: a job is still live (waiting, active, delayed between automatic retries, ...);
 *   it is left untouched and no second job is created.
 */
export type ReprocessQueueOutcome = 'enqueued' | 'requeued' | 'pending';

// Finished states a job stays in only while retained (removeOnFail: false keeps failed jobs).
const FINISHED_STATES = ['failed', 'completed'] as const;
type FinishedState = (typeof FINISHED_STATES)[number];
const isFinished = (state: string): state is FinishedState =>
  (FINISHED_STATES as readonly string[]).includes(state);

@Injectable()
export class AiQueueService {
  private readonly logger = new Logger(AiQueueService.name);

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

  /**
   * Queue a Memory for a user-requested reprocess. With jobId = memoryId, a plain add is a no-op
   * while the previous job is retained, and failed jobs are retained (removeOnFail: false), so a
   * reprocess of a failed Memory would silently do nothing. A retained finished job is therefore
   * moved back to waiting with BullMQ's atomic retry, which only acts if the job is still in that
   * finished set; any live job (including one delayed between automatic retries) is left as is.
   * Errors propagate; nothing here creates a second job for the Memory.
   */
  async requeueForReprocess(memoryId: string): Promise<ReprocessQueueOutcome> {
    const existing = await this.queue.getJob(memoryId);
    if (!existing) {
      await this.enqueueUnderstanding(memoryId);
      return 'enqueued';
    }

    const state = await existing.getState();
    if (state === 'unknown') {
      // Removed after getJob (e.g. completed and cleaned up): a normal add is safe.
      await this.enqueueUnderstanding(memoryId);
      return 'enqueued';
    }
    if (!isFinished(state)) {
      return 'pending';
    }

    try {
      await existing.retry(state, { resetAttemptsMade: true, resetAttemptsStarted: true });
    } catch (err) {
      // A concurrent reprocess may have moved it first; that is the same outcome.
      const now = await existing.getState();
      if (now !== 'unknown' && !isFinished(now)) {
        return 'pending';
      }
      throw err;
    }
    this.logger.log(`Finished AI job (${state}) re-queued for explicit reprocess of Memory ${memoryId}`);
    return 'requeued';
  }
}
