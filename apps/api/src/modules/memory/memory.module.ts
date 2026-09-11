import { Module } from '@nestjs/common';
import { MemoryController } from './memory.controller';
import { MemoryService } from './memory.service';
import { AiModule } from '../ai/ai.module';
import { AssetsModule } from '../assets/assets.module';

@Module({
  imports: [AiModule, AssetsModule],
  controllers: [MemoryController],
  providers: [MemoryService],
  exports: [MemoryService],
})
export class MemoryModule {}
