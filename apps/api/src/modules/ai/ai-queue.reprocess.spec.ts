import { Logger } from '@nestjs/common';
import { AiQueueService } from './ai-queue.service';

// FACEBOOK-SCREENSHOT-UX-03: explicit reprocess must actually re-run a failed Memory (failed jobs are
// retained, so a plain add with jobId = memoryId is a no-op) without ever touching a live job.
describe('AiQueueService.requeueForReprocess', () => {
  const QUEUE_OPTIONS = {
    jobId: 'mem-1',
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: true,
    removeOnFail: false,
  };

  const jobIn = (...states: string[]) => {
    const sequence = [...states];
    return {
      getState: jest.fn(async () => (sequence.length > 1 ? sequence.shift() : sequence[0])),
      retry: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn(),
    };
  };
  const setup = (job: ReturnType<typeof jobIn> | undefined) => {
    const queue = { add: jest.fn().mockResolvedValue({}), getJob: jest.fn().mockResolvedValue(job) };
    return { queue, service: new AiQueueService(queue as any) };
  };

  beforeEach(() => jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('no existing job: enqueues normally with jobId = memoryId and the usual options', async () => {
    const { queue, service } = setup(undefined);

    await expect(service.requeueForReprocess('mem-1')).resolves.toBe('enqueued');

    expect(queue.getJob).toHaveBeenCalledWith('mem-1');
    expect(queue.add).toHaveBeenCalledWith('understand', { memoryId: 'mem-1' }, QUEUE_OPTIONS);
  });

  it('job removed between lookup and state read (unknown): enqueues normally', async () => {
    const job = jobIn('unknown');
    const { queue, service } = setup(job);

    await expect(service.requeueForReprocess('mem-1')).resolves.toBe('enqueued');

    expect(queue.add).toHaveBeenCalledWith('understand', { memoryId: 'mem-1' }, QUEUE_OPTIONS);
    expect(job.retry).not.toHaveBeenCalled();
  });

  it('terminally failed job: re-queued atomically with a fresh attempt budget, same job id, no second job', async () => {
    const job = jobIn('failed');
    const { queue, service } = setup(job);

    await expect(service.requeueForReprocess('mem-1')).resolves.toBe('requeued');

    expect(job.retry).toHaveBeenCalledWith('failed', { resetAttemptsMade: true, resetAttemptsStarted: true });
    expect(job.remove).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('retained completed job: re-queued the same way', async () => {
    const job = jobIn('completed');
    const { queue, service } = setup(job);

    await expect(service.requeueForReprocess('mem-1')).resolves.toBe('requeued');

    expect(job.retry).toHaveBeenCalledWith('completed', { resetAttemptsMade: true, resetAttemptsStarted: true });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it.each(['waiting', 'active', 'delayed', 'prioritized', 'waiting-children'])(
    'live job (%s, including a delayed automatic retry) is left untouched and nothing is added',
    async (state) => {
      const job = jobIn(state);
      const { queue, service } = setup(job);

      await expect(service.requeueForReprocess('mem-1')).resolves.toBe('pending');

      expect(job.retry).not.toHaveBeenCalled();
      expect(job.remove).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    },
  );

  it('concurrent reprocess already re-queued the failed job: reported as pending, no error, no second job', async () => {
    const job = jobIn('failed', 'waiting');
    job.retry.mockRejectedValue(new Error('Job mem-1 is not in the failed state'));
    const { queue, service } = setup(job);

    await expect(service.requeueForReprocess('mem-1')).resolves.toBe('pending');

    expect(queue.add).not.toHaveBeenCalled();
  });

  it('re-queue failure is propagated and never followed by an add', async () => {
    const job = jobIn('failed', 'failed');
    job.retry.mockRejectedValue(new Error('redis unavailable'));
    const { queue, service } = setup(job);

    await expect(service.requeueForReprocess('mem-1')).rejects.toThrow('redis unavailable');

    expect(queue.add).not.toHaveBeenCalled();
    expect(job.remove).not.toHaveBeenCalled();
  });

  it('queue lookup failure is propagated', async () => {
    const { queue, service } = setup(undefined);
    queue.getJob.mockRejectedValue(new Error('redis unavailable'));

    await expect(service.requeueForReprocess('mem-1')).rejects.toThrow('redis unavailable');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('logs only a sanitized event with the Memory id', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const { service } = setup(jobIn('failed'));

    await service.requeueForReprocess('mem-1');

    expect(log).toHaveBeenCalledWith('Finished AI job (failed) re-queued for explicit reprocess of Memory mem-1');
  });

  it('the ordinary enqueue path is unchanged', async () => {
    const { queue, service } = setup(jobIn('failed'));

    await service.enqueueUnderstanding('mem-1');

    expect(queue.getJob).not.toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledWith('understand', { memoryId: 'mem-1' }, QUEUE_OPTIONS);
  });
});
