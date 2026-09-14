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

    // Use raw query for random ordering and view count prioritization
    // Exclude memories where user has negative feedback (not_relevant or dont_show_again)
    // Prioritize low viewCount (unviewed/rarely viewed memories surface first)
    // Include collection name if memory belongs to a collection
    const memories = await this.prisma.$queryRaw`
      SELECT
        m.*,
        c."name" as "collectionName"
      FROM "memories" m
      LEFT JOIN "collection_memories" cm ON m."id" = cm."memoryId"
      LEFT JOIN "collections" c ON cm."collectionId" = c."id" AND c."userId" = ${userId}
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
      ORDER BY m."viewCount" ASC, RANDOM()
      LIMIT 5
    `;

    return memories;
  }

  async getUpcoming(userId: string) {
    const now = new Date();
    const ninetyDaysFromNow = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

    type MemoryWithDatesAndTitles = Prisma.MemoryGetPayload<{
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
          where: { field: { in: ['date', 'title'] } },
        },
        userConfirmations: {
          where: { field: { in: ['date', 'title'] } },
        },
      },
    });

    // Resolve effective date using precedence: UserConfirmation > AIInference
    // Resolve effective title using same precedence
    // Filter to dates between now and 90 days from now
    interface UpcomingItem {
      id: string;
      title: string;
      date: string;
      daysUntil: number;
    }

    const getFieldValue = (memory: MemoryWithDatesAndTitles, field: string): string | undefined => {
      const confirmation = memory.userConfirmations.find((c: typeof memory.userConfirmations[number]) => c.field === field);
      if (confirmation && confirmation.confirmedValue) {
        return String(confirmation.confirmedValue);
      }
      const inference = memory.aiInferences.find((i: typeof memory.aiInferences[number]) => i.field === field);
      if (inference && inference.valueJson) {
        return String(inference.valueJson);
      }
      return undefined;
    };

    const upcomingMemories = memories
      .filter((memory: MemoryWithDatesAndTitles) => {
        const effectiveDate = getFieldValue(memory, 'date');

        if (!effectiveDate) return false;

        try {
          const dateObj = new Date(String(effectiveDate));
          return dateObj >= now && dateObj <= ninetyDaysFromNow;
        } catch {
          return false;
        }
      })
      .map((memory: MemoryWithDatesAndTitles) => {
        const effectiveDate = getFieldValue(memory, 'date');
        const effectiveTitle = getFieldValue(memory, 'title') || memory.title;
        const dateObj = new Date(String(effectiveDate));
        const daysUntil = Math.ceil(
          (dateObj.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
        );

        return {
          id: memory.id,
          title: effectiveTitle,
          date: dateObj.toISOString(),
          daysUntil,
        };
      })
      .sort((a: UpcomingItem, b: UpcomingItem) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .slice(0, 10);

    return upcomingMemories;
  }

  async getForYouSuggestions(userId: string) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Fetch product-type memories from last 30 days (non-vault, active)
    const memories = await this.prisma.memory.findMany({
      where: {
        userId,
        lifecycleState: 'active',
        securityScope: { not: 'vault' },
        memoryType: { in: ['product', 'PRODUCT'] },
        capturedAt: { gte: thirtyDaysAgo },
      },
      include: {
        aiInferences: {
          where: { field: 'category' },
        },
      },
    });

    if (memories.length === 0) return null;

    // Group by category (resolve in TypeScript, consistent with getUpcoming pattern)
    const categoryMap: { [category: string]: string[] } = {};
    for (const memory of memories) {
      const categoryInference = memory.aiInferences?.[0];
      if (categoryInference?.valueJson) {
        const category = String(categoryInference.valueJson);
        if (!categoryMap[category]) {
          categoryMap[category] = [];
        }
        categoryMap[category].push(memory.id);
      }
    }

    // Find category with 3+ items, pick the one with most items
    let bestCategory: string | null = null;
    let maxCount = 0;
    for (const [category, memoryIds] of Object.entries(categoryMap)) {
      if (memoryIds.length >= 3 && memoryIds.length > maxCount) {
        bestCategory = category;
        maxCount = memoryIds.length;
      }
    }

    if (!bestCategory) return null;

    return {
      category: bestCategory,
      memoryIds: categoryMap[bestCategory].slice(0, 5),
      count: categoryMap[bestCategory].length,
    };
  }

  async getContinueSuggestions(userId: string) {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    // Fetch memories from last 14 days with topics (non-vault, active)
    type MemoryWithTopics = Prisma.MemoryGetPayload<{
      include: {
        aiInferences: true;
        collections: true;
      };
    }>;

    const memories = await this.prisma.memory.findMany({
      where: {
        userId,
        lifecycleState: 'active',
        securityScope: { not: 'vault' },
        capturedAt: { gte: fourteenDaysAgo },
      },
      include: {
        aiInferences: {
          where: { field: 'topics' },
        },
        collections: true,
      },
    });

    if (memories.length === 0) return null;

    // Count topic occurrences (topics is an array of strings)
    const topicMap: { [topic: string]: string[] } = {};
    for (const memory of memories) {
      const topicsInference = memory.aiInferences?.[0];
      if (topicsInference?.valueJson && Array.isArray(topicsInference.valueJson)) {
        for (const topic of topicsInference.valueJson) {
          const topicStr = String(topic);
          if (!topicMap[topicStr]) {
            topicMap[topicStr] = [];
          }
          topicMap[topicStr].push(memory.id);
        }
      }
    }

    // Find topics appearing in 2+ memories, exclude if all are in same collection
    let bestTopic: string | null = null;
    let maxCount = 0;
    for (const [topic, memoryIds] of Object.entries(topicMap)) {
      if (memoryIds.length >= 2 && memoryIds.length > maxCount) {
        // Check if all memories with this topic are in the same collection
        const uniqueCollections = new Set<string>();
        for (const memoryId of memoryIds) {
          const memory = memories.find((m: MemoryWithTopics) => m.id === memoryId);
          if (memory?.collections && memory.collections.length > 0) {
            for (const collection of memory.collections) {
              uniqueCollections.add(collection.collectionId);
            }
          } else {
            // Memory not in any collection, so break the "all in same collection" pattern
            uniqueCollections.add('__uncollected__');
          }
        }

        // Only qualify if NOT all in the same single collection (exclude if size==1 and not uncollected)
        if (uniqueCollections.size !== 1 || uniqueCollections.has('__uncollected__')) {
          bestTopic = topic;
          maxCount = memoryIds.length;
        }
      }
    }

    if (!bestTopic) return null;

    return {
      topic: bestTopic,
      memoryIds: topicMap[bestTopic].slice(0, 5),
      count: topicMap[bestTopic].length,
    };
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
