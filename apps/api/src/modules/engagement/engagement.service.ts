import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
    // Exclude memories where user has negative feedback (not_relevant or dont_show_again)
    const memories = await this.prisma.$queryRaw`
      SELECT m.* FROM "memories" m
      WHERE m."userId" = ${userId}
        AND m."lifecycleState" = 'active'
        AND m."securityScope" != 'vault'
        AND m."capturedAt" < ${thirtyDaysAgo}
        AND NOT EXISTS (
          SELECT 1 FROM "rediscovery_feedback" rf
          WHERE rf."memoryId" = m."id"
            AND rf."userId" = ${userId}
            AND rf."feedback" IN ('not_relevant', 'dont_show_again')
        )
      ORDER BY RANDOM()
      LIMIT 5
    `;

    return memories;
  }

  async getUpcoming(userId: string) {
    const now = new Date();
    const ninetyDaysFromNow = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

    type MemoryWithDates = Prisma.MemoryGetPayload<{
      include: {
        aiInferences: true;
        userConfirmations: true;
      };
    }>;

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
    interface UpcomingItem {
      id: string;
      title: string;
      date: string;
      daysUntil: number;
    }

    const upcomingMemories = memories
      .filter((memory: MemoryWithDates) => {
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
      .map((memory: MemoryWithDates) => {
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
      .sort((a: UpcomingItem, b: UpcomingItem) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .slice(0, 10);

    return upcomingMemories;
  }

  async recordFeedback(userId: string, memoryId: string, feedback: string) {
    const validFeedbackValues = ['useful', 'not_relevant', 'dont_show_again'];

    if (!validFeedbackValues.includes(feedback)) {
      throw new BadRequestException(
        `Invalid feedback value: ${feedback}. Must be one of: ${validFeedbackValues.join(', ')}`,
      );
    }

    // Verify memory exists and belongs to user
    const memory = await this.prisma.memory.findUnique({
      where: { id: memoryId },
      select: { id: true, userId: true },
    });

    if (!memory) {
      throw new NotFoundException(`Memory not found: ${memoryId}`);
    }

    if (memory.userId !== userId) {
      throw new ForbiddenException('Cannot record feedback on a memory you do not own');
    }

    return this.prisma.rediscoveryFeedback.upsert({
      where: { userId_memoryId: { userId, memoryId } },
      create: {
        userId,
        memoryId,
        feedback,
      },
      update: {
        feedback,
      },
    });
  }
}
