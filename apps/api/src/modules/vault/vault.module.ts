import { Module } from '@nestjs/common';
import { VaultService } from './vault.service';
import { VaultController } from './vault.controller';
import { AssetsModule } from '../assets/assets.module';
import { MemoryModule } from '../memory/memory.module';

@Module({
  imports: [AssetsModule, MemoryModule],
  providers: [VaultService],
  controllers: [VaultController],
})
export class VaultModule {}
