import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MemoryController } from './memory.controller';
import { MemoryService } from './memory.service';
import { AiModule } from '../ai/ai.module';
import { AssetsModule } from '../assets/assets.module';
import { MEMORY_DELETION_QUEUE, MemoryDeletionQueueService } from './deletion-queue.service';
import { MemoryDeletionProcessor } from './deletion.processor';

@Module({
  imports: [
    AiModule,
    AssetsModule,
    BullModule.registerQueue({ name: MEMORY_DELETION_QUEUE }),
  ],
  controllers: [MemoryController],
  providers: [MemoryService, MemoryDeletionQueueService, MemoryDeletionProcessor],
  exports: [MemoryService, MemoryDeletionQueueService],
})
export class MemoryModule {}
