import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class EngagementService {
  constructor(private readonly prisma: PrismaService) {}

  async getRediscovery(userId: string) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    return this.prisma.memory.findMany({
      where: {
        userId,
        lifecycleState: 'active',
        securityScope: { not: 'vault' },
        capturedAt: {
          lt: thirtyDaysAgo,
        },
      },
      orderBy: {
        capturedAt: 'desc', // Show older ones first, sorted by age
      },
      take: 5,
    });
  }

  async getRediscoveryRandom(userId: string) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Use raw query for random ordering since Prisma doesn't support ORDER BY RANDOM() directly
    const memories = await this.prisma.$queryRaw`
      SELECT m.* FROM "memories" m
      WHERE m."userId" = ${userId}
        AND m."lifecycleState" = 'active'
        AND m."securityScope" != 'vault'
        AND m."capturedAt" < ${thirtyDaysAgo}
      ORDER BY RANDOM()
      LIMIT 5
    `;

    return memories;
  }
}
