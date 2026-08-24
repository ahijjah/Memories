import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { RemindersService } from './reminders.service';

@Processor('reminders')
export class RemindersProcessor extends WorkerHost {
  private readonly logger = new Logger(RemindersProcessor.name);

  constructor(private readonly remindersService: RemindersService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === 'mark-due-reminders') {
      const count = await this.remindersService.markDueReminders();
      if (count > 0) {
        this.logger.log(`Marked ${count} reminders as due`);
      }
    }
  }
}
