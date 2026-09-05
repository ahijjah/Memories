import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AI_PROCESSING_QUEUE, AiQueueService } from './ai-queue.service';
import { AiProcessor } from './ai.processor';
import { EmbeddingService } from './embedding.service';
import { UrlMetadataService } from './url-metadata.service';

@Module({
  imports: [BullModule.registerQueue({ name: AI_PROCESSING_QUEUE })],
  providers: [AiQueueService, AiProcessor, EmbeddingService, UrlMetadataService],
  exports: [AiQueueService, EmbeddingService],
})
export class AiModule {}
