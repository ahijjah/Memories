import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LATEST_AI_INFERENCE_ORDER, resolveMemoryField } from '../../common/resolve-memory-field.util';
import { resolveTitleFromFields } from '../../common/resolve-title.util';

export interface CalendarItem {
  memoryId: string;
  date: string;
  title: string;
  type?: string;
}

export interface CalendarMonthResponse {
  month: string;
  items: CalendarItem[];
}

// Strict date-only validator: ensures YYYY-MM-DD format with valid calendar date
function isValidCalendarDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }

  const parts = dateStr.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);

  // Validate month range
  if (month < 1 || month > 12) {
    return false;
  }

  // Validate day exists in that month/year
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day < 1 || day > daysInMonth) {
    return false;
  }

  return true;
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
          orderBy: LATEST_AI_INFERENCE_ORDER,
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
      const resolved = resolveMemoryField<string>(field, {
        aiInferences: memory.aiInferences,
        userConfirmations: memory.userConfirmations,
        shape: 'string',
      });
      return resolved.value === null ? undefined : resolved.value;
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
          orderBy: LATEST_AI_INFERENCE_ORDER,
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
          orderBy: LATEST_AI_INFERENCE_ORDER,
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

    // Great-circle distance in km (spherical law of cosines). Floating-point rounding can push
    // the cosine slightly outside [-1, 1] for identical or near-identical points, and Postgres
    // acos() raises "input is out of range" there, so the input is clamped. The same expression
    // is used for the returned distance and the radius filter.
    const distanceKm = Prisma.sql`(
      6371 * acos(LEAST(1, GREATEST(-1,
        cos(radians(${latitude})) * cos(radians(m."latitude")) *
        cos(radians(m."longitude") - radians(${longitude})) +
        sin(radians(${latitude})) * sin(radians(m."latitude"))
      )))
    )`;

    // Only active Memories: archived, deleted_pending and deleted are excluded.
    const rawResults = await this.prisma.$queryRaw<NearMeRawResult[]>`
      SELECT
        m."id",
        m."title",
        summary_inf."valueJson" #>> '{}' AS "summary",
        m."sourceUri",
        ${distanceKm} AS "distance",
        m."createdAt"
      FROM "memories" m
      LEFT JOIN LATERAL (
        SELECT "valueJson" FROM "ai_inferences" ai
        WHERE ai."memoryId" = m."id" AND ai."field" = 'summary'
        ORDER BY ai."createdAt" DESC, ai."id" DESC
        LIMIT 1
      ) AS summary_inf ON true
      WHERE m."userId" = ${userId}
        AND m."lifecycleState" = 'active'
        AND m."securityScope" != 'vault'
        AND m."latitude" IS NOT NULL
        AND m."longitude" IS NOT NULL
        AND ${distanceKm} <= ${radiusKm}
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

    // Use raw SQL to efficiently filter memories by effective date in requested month
    // Precedence: UserConfirmation.date > AIInference.date
    const yearPadded = String(year).padStart(4, '0');
    const monthPadded = String(monthNum).padStart(2, '0');
    const monthRangeStart = `${yearPadded}-${monthPadded}-01`;
    const monthRangeEnd = `${yearPadded}-${monthPadded}-31`;

    interface RawCalendarResult {
      id: string;
      title: string;
      effective_date: string | null;
    }

    // Get memory IDs that have a valid effective date in the requested month
    // Physical schema: tables use quoted names, columns use camelCase
    // Precedence: UserConfirmation.confirmedValue > AIInference.valueJson (both JSON types)
    // Extract JSON scalar text using #>> '{}' operator
    const matchingMemoryIds = await this.prisma.$queryRaw<RawCalendarResult[]>`
      SELECT DISTINCT m."id", m."title",
        COALESCE(
          uc_date."confirmedValue" #>> '{}',
          ai_date."valueJson" #>> '{}'
        ) as "effective_date"
      FROM "memories" m
      LEFT JOIN "user_confirmations" uc_date
        ON m."id" = uc_date."memoryId" AND uc_date."field" = 'date'
      LEFT JOIN LATERAL (
        SELECT "valueJson"
        FROM "ai_inferences"
        WHERE "memoryId" = m."id" AND "field" = 'date'
        ORDER BY "createdAt" DESC, "id" DESC
        LIMIT 1
      ) ai_date ON true
      WHERE m."userId" = ${userId}
        AND m."lifecycleState" = 'active'
        AND m."securityScope" != 'vault'
        AND (COALESCE(
          uc_date."confirmedValue" #>> '{}',
          ai_date."valueJson" #>> '{}'
        )) >= ${monthRangeStart}
        AND (COALESCE(
          uc_date."confirmedValue" #>> '{}',
          ai_date."valueJson" #>> '{}'
        )) <= ${monthRangeEnd}
        AND (COALESCE(
          uc_date."confirmedValue" #>> '{}',
          ai_date."valueJson" #>> '{}'
        )) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      ORDER BY COALESCE(
        uc_date."confirmedValue" #>> '{}',
        ai_date."valueJson" #>> '{}'
      ), m."title"
    `;

    // Filter out results with invalid dates and collect valid memory IDs
    // Build map of memoryId -> effective_date from SQL (authoritative source)
    const effectiveDateMap = new Map<string, string>();
    const memoryIds: string[] = [];

    for (const result of matchingMemoryIds) {
      if (result.effective_date && isValidCalendarDate(result.effective_date)) {
        memoryIds.push(result.id);
        effectiveDateMap.set(result.id, result.effective_date);
      }
    }

    if (memoryIds.length === 0) {
      return {
        month: monthStr,
        items: [],
      } as CalendarMonthResponse;
    }

    // Fetch full memory details (including related data) only for matched memory IDs
    // Assets not included: Calendar MVP does not render images
    // Date retrieved from SQL effectiveDateMap (authoritative source)
    const memories = await this.prisma.memory.findMany({
      where: {
        id: { in: memoryIds },
      },
      include: {
        aiInferences: {
          where: { field: { in: ['title', 'type'] } },
          orderBy: LATEST_AI_INFERENCE_ORDER,
        },
        userConfirmations: {
          where: { field: { in: ['title', 'type'] } },
        },
      },
    });

    // Build calendar items from fetched memories
    // Date comes from SQL effectiveDateMap (authoritative), not recomputed from Prisma relations
    const items: CalendarItem[] = [];

    for (const memory of memories) {
      const effectiveDate = effectiveDateMap.get(memory.id);
      if (!effectiveDate) continue;

      const effectiveTitle = resolveTitleFromFields(
        memory.title || '',
        memory.aiInferences,
        memory.userConfirmations,
      );
      const effectiveType = (
        memory.userConfirmations.find((c) => c.field === 'type')?.confirmedValue ||
        memory.aiInferences.find((i) => i.field === 'type')?.valueJson ||
        undefined
      );
      const effectiveTypeStr = effectiveType ? String(effectiveType) : undefined;

      const item: CalendarItem = {
        memoryId: memory.id,
        date: effectiveDate,
        title: effectiveTitle || 'Untitled',
        type: effectiveTypeStr,
      };

      items.push(item);
    }

    // Sort by date, then title for deterministic ordering
    items.sort((a, b) => {
      if (a.date !== b.date) {
        return a.date.localeCompare(b.date);
      }
      return a.title.localeCompare(b.title);
    });

    return {
      month: monthStr,
      items,
    } as CalendarMonthResponse;
  }
}
