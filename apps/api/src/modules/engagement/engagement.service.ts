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

  async getUpcoming(userId: string) {
    const now = new Date();
    const ninetyDaysFromNow = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

    const memories = await this.prisma.memory.findMany({
      where: {
        userId,
        lifecycleState: 'active',
        securityScope: { not: 'vault' },
      },
      include: {
        aiInferences: {
          where: { field: 'date' },
        },
        userConfirmations: {
          where: { field: 'date' },
        },
      },
    });

    // Resolve effective date using precedence: UserConfirmation > AIInference
    // Filter to dates between now and 90 days from now
    const upcomingMemories = memories
      .filter((memory) => {
        const userConfDate = memory.userConfirmations?.[0]?.confirmedValue;
        const aiDate = memory.aiInferences?.[0]?.valueJson;
        const effectiveDate = userConfDate || aiDate;

        if (!effectiveDate) return false;

        try {
          const dateObj = new Date(String(effectiveDate));
          return dateObj >= now && dateObj <= ninetyDaysFromNow;
        } catch {
          return false;
        }
      })
      .map((memory) => {
        const userConfDate = memory.userConfirmations?.[0]?.confirmedValue;
        const aiDate = memory.aiInferences?.[0]?.valueJson;
        const effectiveDate = userConfDate || aiDate;
        const dateObj = new Date(String(effectiveDate));
        const daysUntil = Math.ceil(
          (dateObj.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
        );

        return {
          id: memory.id,
          title: memory.title,
          date: dateObj.toISOString(),
          daysUntil,
        };
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .slice(0, 10);

    return upcomingMemories;
  }
}
