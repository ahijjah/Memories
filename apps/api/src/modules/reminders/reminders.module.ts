import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { RemindersService } from './reminders.service';
import { RemindersController } from './reminders.controller';
import { RemindersProcessor } from './reminders.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'reminders',
    }),
  ],
  controllers: [RemindersController],
  providers: [RemindersService, RemindersProcessor],
  exports: [RemindersService],
})
export class RemindersModule implements OnModuleInit {
  constructor(@InjectQueue('reminders') private remindersQueue: Queue) {}

  async onModuleInit() {
    // Add repeating job to mark due reminders every 5 minutes
    await this.remindersQueue.add(
      'mark-due-reminders',
      {},
      {
        repeat: {
          every: 5 * 60 * 1000, // 5 minutes in milliseconds
        },
      },
    );
  }
}
