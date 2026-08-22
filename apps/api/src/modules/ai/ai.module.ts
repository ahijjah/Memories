import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AI_PROCESSING_QUEUE, AiQueueService } from './ai-queue.service';
import { AiProcessor } from './ai.processor';

@Module({
  imports: [BullModule.registerQueue({ name: AI_PROCESSING_QUEUE })],
  providers: [AiQueueService, AiProcessor],
  exports: [AiQueueService],
})
export class AiModule {}
