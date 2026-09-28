import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { JobState, Queue } from 'bullmq';

export const AI_PROCESSING_QUEUE = 'ai-processing';

export interface AiProcessingJobData {
  memoryId: string;
}

// Finished states a job stays in only while retained (removeOnFail: false keeps failed jobs).
const FINISHED_STATES = ['failed', 'completed'] as const;
type FinishedState = (typeof FINISHED_STATES)[number];
const isFinished = (state: string): state is FinishedState =>
  (FINISHED_STATES as readonly string[]).includes(state);

/** A job state that is not finished: waiting, active, delayed, prioritized, waiting-children. */
export type LiveJobState = Exclude<JobState, FinishedState>;

/**
 * What an explicit reprocess did to the queue:
 * - enqueued: a normal job was added (no job existed, or it disappeared before its state was read).
 * - requeued: the Memory's job had finished (terminally failed, or completed and still retained);
 *   it was moved back to waiting with a fresh attempt budget, same jobId and options.
 * - pending: a job is still live and was left untouched; no second job is created. `state` is the
 *   observed BullMQ state. An `active` job may already have written its final Memory state (the
 *   processor does so before BullMQ moves the job out of active), so it guarantees no further run.
 */
export type ReprocessQueueOutcome =
  | { kind: 'enqueued' }
  | { kind: 'requeued' }
  | { kind: 'pending'; state: LiveJobState };

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
      return { kind: 'enqueued' };
    }

    const state = await existing.getState();
    if (state === 'unknown') {
      // Removed after getJob (e.g. completed and cleaned up): a normal add is safe.
      await this.enqueueUnderstanding(memoryId);
      return { kind: 'enqueued' };
    }
    if (!isFinished(state)) {
      return { kind: 'pending', state };
    }

    try {
      await existing.retry(state, { resetAttemptsMade: true, resetAttemptsStarted: true });
    } catch (err) {
      // A concurrent reprocess may have moved it first; that is the same outcome.
      const now = await existing.getState();
      if (now !== 'unknown' && !isFinished(now)) {
        return { kind: 'pending', state: now };
      }
      throw err;
    }
    this.logger.log(`Finished AI job (${state}) re-queued for explicit reprocess of Memory ${memoryId}`);
    return { kind: 'requeued' };
  }
}
