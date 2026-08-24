import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AI_PROCESSING_QUEUE, AiQueueService } from './ai-queue.service';
import { AiProcessor } from './ai.processor';
import { EmbeddingService } from './embedding.service';

@Module({
  imports: [BullModule.registerQueue({ name: AI_PROCESSING_QUEUE })],
  providers: [AiQueueService, AiProcessor, EmbeddingService],
  exports: [AiQueueService, EmbeddingService],
})
export class AiModule {}
