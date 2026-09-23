import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { resolveTitleFromFields } from '../../common/resolve-title.util';

export interface CalendarItem {
  memoryId: string;
  date: string;
  title: string;
  type?: string;
  assets: Array<{ id: string; mimeType: string; variant?: string }>;
}

export interface CalendarMonthResponse {
  month: string;
  items: CalendarItem[];
}

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

  async getNearMe(
    userId: string,
    latitude: number,
    longitude: number,
    radiusKm: number = 5,
  ) {
    interface NearMeRawResult {
      id: string;
      title: string;
      summary: string;
      sourceUri: string | null;
      distance: number;
      createdAt: Date;
    }

    type TitleInference = Prisma.AIInferenceGetPayload<Record<string, never>>;
    type TitleConfirmation = Prisma.UserConfirmationGetPayload<Record<string, never>>;

    // Haversine distance formula: distance in km
    const rawResults = await this.prisma.$queryRaw<NearMeRawResult[]>`
      SELECT
        m."id",
        m."title",
        summary_inf."valueJson" #>> '{}' AS "summary",
        m."sourceUri",
        (
          6371 * acos(
            cos(radians(${latitude})) * cos(radians(m."latitude")) *
            cos(radians(m."longitude") - radians(${longitude})) +
            sin(radians(${latitude})) * sin(radians(m."latitude"))
          )
        ) AS "distance",
        m."createdAt"
      FROM "memories" m
      LEFT JOIN LATERAL (
        SELECT "valueJson" FROM "ai_inferences" ai
        WHERE ai."memoryId" = m."id" AND ai."field" = 'summary'
        ORDER BY ai."createdAt" DESC
        LIMIT 1
      ) AS summary_inf ON true
      WHERE m."userId" = ${userId}
        AND m."lifecycleState" != 'deleted'
        AND m."securityScope" != 'vault'
        AND m."latitude" IS NOT NULL
        AND m."longitude" IS NOT NULL
        AND (
          6371 * acos(
            cos(radians(${latitude})) * cos(radians(m."latitude")) *
            cos(radians(m."longitude") - radians(${longitude})) +
            sin(radians(${latitude})) * sin(radians(m."latitude"))
          )
        ) <= ${radiusKm}
      ORDER BY "distance" ASC
      LIMIT 20
    `;

    // Fetch title inferences and confirmations for title resolution
    const memoryIds = rawResults.map((r: NearMeRawResult) => r.id);
    const titleInferences = memoryIds.length > 0
      ? await this.prisma.aIInference.findMany({
          where: {
            memoryId: { in: memoryIds },
            field: 'title',
          },
        })
      : [];

    const titleConfirmations = memoryIds.length > 0
      ? await this.prisma.userConfirmation.findMany({
          where: {
            memoryId: { in: memoryIds },
            field: 'title',
          },
        })
      : [];

    // Resolve titles using precedence: UserConfirmation > AIInference > raw title
    const results = rawResults.map((result: NearMeRawResult) => {
      const inferences = titleInferences.filter((inf: TitleInference) => inf.memoryId === result.id);
      const confirmations = titleConfirmations.filter((conf: TitleConfirmation) => conf.memoryId === result.id);
      const resolvedTitle = resolveTitleFromFields(
        result.title,
        inferences,
        confirmations,
      );

      return {
        ...result,
        title: resolvedTitle,
      };
    });

    return results;
  }

  async getCalendarMonth(userId: string, monthStr: string) {
    // Validate month format: YYYY-MM
    const monthRegex = /^\d{4}-\d{2}$/;
    if (!monthRegex.test(monthStr)) {
      throw new BadRequestException('Month must be in YYYY-MM format');
    }

    const [yearStr, monthNumStr] = monthStr.split('-');
    const year = parseInt(yearStr, 10);
    const monthNum = parseInt(monthNumStr, 10);

    // Validate ranges
    if (isNaN(year) || isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
      throw new BadRequestException('Invalid month or year');
    }

    type MemoryWithDatesAndTitles = Prisma.MemoryGetPayload<{
      include: {
        aiInferences: true;
        userConfirmations: true;
        assets: true;
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
          where: { field: { in: ['date', 'title', 'type'] } },
        },
        userConfirmations: {
          where: { field: { in: ['date', 'title'] } },
        },
        assets: {
          select: {
            id: true,
            objectKey: true,
            mimeType: true,
            variant: true,
          },
        },
      },
    });

    const getFieldValue = (
      memory: MemoryWithDatesAndTitles,
      field: string
    ): string | undefined => {
      const confirmation = memory.userConfirmations.find(
        (c) => c.field === field
      );
      if (confirmation && confirmation.confirmedValue) {
        return String(confirmation.confirmedValue);
      }
      const inference = memory.aiInferences.find((i) => i.field === field);
      if (inference && inference.valueJson) {
        return String(inference.valueJson);
      }
      return undefined;
    };

    // Group by date, filtering only memories in the requested month
    const itemsByDate: { [dateStr: string]: any[] } = {};

    for (const memory of memories) {
      const effectiveDate = getFieldValue(
        memory as MemoryWithDatesAndTitles,
        'date'
      );
      if (!effectiveDate) continue;

      // Parse the date string (YYYY-MM-DD)
      // Safe: preserve the canonical YYYY-MM-DD without any Date object parsing
      const dateParts = effectiveDate.split('-');
      if (dateParts.length !== 3) continue;

      const dateYear = parseInt(dateParts[0], 10);
      const dateMonth = parseInt(dateParts[1], 10);
      const dateDay = parseInt(dateParts[2], 10);

      // Check if this date is in the requested month
      if (isNaN(dateYear) || isNaN(dateMonth) || isNaN(dateDay)) continue;
      if (dateYear !== year || dateMonth !== monthNum) continue;

      // Date is valid and in the requested month
      const effectiveTitle =
        getFieldValue(memory as MemoryWithDatesAndTitles, 'title') ||
        memory.title;
      const effectiveType = getFieldValue(
        memory as MemoryWithDatesAndTitles,
        'type'
      );

      // Build safe asset DTO (no objectKey, no SSE-C material)
      const assetDtos = memory.assets.map((asset) => ({
        id: asset.id,
        mimeType: asset.mimeType,
        ...(asset.variant ? { variant: asset.variant } : {}),
      }));

      const item: CalendarItem = {
        memoryId: memory.id,
        date: effectiveDate,
        title: effectiveTitle || memory.title || 'Untitled',
        type: effectiveType,
        assets: assetDtos,
      };

      if (!itemsByDate[effectiveDate]) {
        itemsByDate[effectiveDate] = [];
      }
      itemsByDate[effectiveDate].push(item);
    }

    // Sort items by date, then by title for deterministic ordering
    const sortedDates = Object.keys(itemsByDate).sort();
    const items: CalendarItem[] = [];
    for (const date of sortedDates) {
      const dayItems = itemsByDate[date];
      dayItems.sort((a: CalendarItem, b: CalendarItem) =>
        a.title.localeCompare(b.title)
      );
      items.push(...dayItems);
    }

    return {
      month: monthStr,
      items,
    } as CalendarMonthResponse;
  }
}
