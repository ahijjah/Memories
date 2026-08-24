import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from './common/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { MemoryModule } from './modules/memory/memory.module';
import { AssetsModule } from './modules/assets/assets.module';
import { AiModule } from './modules/ai/ai.module';
import { SearchModule } from './modules/search/search.module';
import { AskModule } from './modules/ask/ask.module';
import { VaultModule } from './modules/vault/vault.module';
import { CollectionsModule } from './modules/collections/collections.module';
import { RemindersModule } from './modules/reminders/reminders.module';
import { EngagementModule } from './modules/engagement/engagement.module';
import { AccountModule } from './modules/account/account.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: Number(process.env.REDIS_PORT ?? 6379),
      },
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    MemoryModule,
    AssetsModule,
    AiModule,
    SearchModule,
    AskModule,
    VaultModule,
    CollectionsModule,
    RemindersModule,
    EngagementModule,
    AccountModule,
  ],
})
export class AppModule {}
