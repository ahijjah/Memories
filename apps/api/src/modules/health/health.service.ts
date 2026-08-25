import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import * as IORedis from 'ioredis';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private redisClient: IORedis.Redis;

  constructor(private readonly prisma: PrismaService) {
    this.redisClient = new IORedis.default({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
      lazyConnect: true,
    });
  }

  async check() {
    const checks = {
      database: await this.checkDatabase(),
      redis: await this.checkRedis(),
    };

    const status = checks.database && checks.redis ? 'ok' : 'degraded';

    return {
      status,
      checks,
    };
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch (err) {
      this.logger.warn(`Database health check failed: ${(err as Error).message}`);
      return false;
    }
  }

  private async checkRedis(): Promise<boolean> {
    try {
      await this.redisClient.ping();
      return true;
    } catch (err) {
      this.logger.warn(`Redis health check failed: ${(err as Error).message}`);
      return false;
    }
  }
}
