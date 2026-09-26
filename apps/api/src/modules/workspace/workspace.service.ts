import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LATEST_AI_INFERENCE_ORDER } from '../../common/resolve-memory-field.util';
import { resolveTitleFromFields } from '../../common/resolve-title.util';

export interface WorkspaceListItem {
  workspaceId: string;
  displayLabel: string;
  memoryCount: number;
}

export interface WorkspaceMemory {
  id: string;
  title: string;
  memoryType: string;
  sourceType: string;
  capturedAt: Date;
  processingState: string;
  securityScope: string;
  assets: {
    id: string;
    mimeType: string;
    variant: string | null;
    url: string;
  }[];
}

export interface WorkspaceListResponse {
  workspaces: WorkspaceListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface WorkspaceDetailResponse {
  workspaceId: string;
  displayLabel: string;
  memories: WorkspaceMemory[];
  total: number;
  limit: number;
  offset: number;
}

@Injectable()
export class WorkspaceService {
  constructor(private prisma: PrismaService) {}

  /**
   * Normalize topic for workspace identity.
   * Rule: trim + collapse internal whitespace + lowercase
   */
  normalizeTopicForIdentity(rawTopic: string): string {
    return rawTopic
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  /**
   * Encode normalized topic for use in URL.
   */
  encodeWorkspaceId(normalizedTopic: string): string {
    return encodeURIComponent(normalizedTopic);
  }

  /**
   * Decode workspaceId from URL and verify safety.
   */
  decodeAndVerifyWorkspaceId(encodedId: string, expectedNormalized?: string): string {
    const decoded = decodeURIComponent(encodedId);
    const normalized = this.normalizeTopicForIdentity(decoded);
    if (expectedNormalized && normalized !== expectedNormalized) {
      throw new Error('Workspace ID mismatch');
    }
    return normalized;
  }


  /**
   * Get all workspaces for authenticated user.
   * Returns normalized topics with 2+ distinct memories, ordered by count.
   * Aggregation done in PostgreSQL.
   */
  async listWorkspaces(
    userId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<WorkspaceListResponse> {
    interface WorkspaceRow {
      normalized_topic: string;
      memory_count: number;
      display_label: string;
    }

    const results = await this.prisma.$queryRaw<WorkspaceRow[]>`
      WITH topics_expanded AS (
        SELECT
          m."id" AS memory_id,
          LOWER(
            REGEXP_REPLACE(
              REGEXP_REPLACE(
                TRIM(jsonb_array_elements_text(ai."valueJson")),
                '\\s+', ' ', 'g'
              ),
              '^\s+|\s+$', '', 'g'
            )
          ) AS normalized_topic,
          TRIM(jsonb_array_elements_text(ai."valueJson")) AS raw_topic
        FROM "memories" m
        JOIN "ai_inferences" ai ON m."id" = ai."memoryId"
        WHERE m."userId" = ${userId}
          AND m."lifecycleState" NOT IN ('deleted', 'deleted_pending')
          AND m."securityScope" = 'private'
          AND ai."field" = 'topics'
          AND jsonb_typeof(ai."valueJson") = 'array'
      ),
      filtered_topics AS (
        SELECT
          memory_id,
          normalized_topic,
          raw_topic
        FROM topics_expanded
        WHERE normalized_topic != ''
          AND CHAR_LENGTH(normalized_topic) > 0
      ),
      deduped_per_memory AS (
        SELECT DISTINCT ON (memory_id, normalized_topic)
          memory_id,
          normalized_topic,
          raw_topic
        FROM filtered_topics
        ORDER BY memory_id, normalized_topic, raw_topic
      ),
      variant_stats AS (
        SELECT
          normalized_topic,
          raw_topic,
          COUNT(DISTINCT memory_id) AS variant_count
        FROM deduped_per_memory
        GROUP BY normalized_topic, raw_topic
      ),
      ranked_variants AS (
        SELECT
          normalized_topic,
          raw_topic,
          variant_count,
          ROW_NUMBER() OVER (PARTITION BY normalized_topic ORDER BY variant_count DESC, raw_topic ASC) AS rank
        FROM variant_stats
      ),
      workspace_stats AS (
        SELECT
          normalized_topic,
          COUNT(DISTINCT memory_id) AS memory_count,
          (SELECT raw_topic FROM ranked_variants rv WHERE rv.normalized_topic = dpm.normalized_topic AND rv.rank = 1 LIMIT 1) AS display_label
        FROM deduped_per_memory dpm
        GROUP BY normalized_topic
        HAVING COUNT(DISTINCT memory_id) >= 2
      ),
      ordered_workspaces AS (
        SELECT
          normalized_topic,
          memory_count,
          display_label
        FROM workspace_stats
        ORDER BY memory_count DESC, normalized_topic ASC
      )
      SELECT
        normalized_topic,
        memory_count,
        display_label
      FROM ordered_workspaces
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const totalResult = await this.prisma.$queryRaw<{ count: number }[]>`
      WITH topics_expanded AS (
        SELECT
          m."id" AS memory_id,
          LOWER(
            REGEXP_REPLACE(
              REGEXP_REPLACE(
                TRIM(jsonb_array_elements_text(ai."valueJson")),
                '\\s+', ' ', 'g'
              ),
              '^\s+|\s+$', '', 'g'
            )
          ) AS normalized_topic
        FROM "memories" m
        JOIN "ai_inferences" ai ON m."id" = ai."memoryId"
        WHERE m."userId" = ${userId}
          AND m."lifecycleState" NOT IN ('deleted', 'deleted_pending')
          AND m."securityScope" = 'private'
          AND ai."field" = 'topics'
          AND jsonb_typeof(ai."valueJson") = 'array'
      ),
      filtered_topics AS (
        SELECT
          memory_id,
          normalized_topic
        FROM topics_expanded
        WHERE normalized_topic != ''
          AND CHAR_LENGTH(normalized_topic) > 0
      ),
      deduped_per_memory AS (
        SELECT DISTINCT ON (memory_id, normalized_topic)
          memory_id,
          normalized_topic
        FROM filtered_topics
        ORDER BY memory_id, normalized_topic
      ),
      workspace_stats AS (
        SELECT
          normalized_topic,
          COUNT(DISTINCT memory_id) AS memory_count
        FROM deduped_per_memory
        GROUP BY normalized_topic
        HAVING COUNT(DISTINCT memory_id) >= 2
      )
      SELECT COUNT(*) AS count FROM workspace_stats
    `;

    const total = Number(totalResult[0]?.count ?? 0);

    const workspaces: WorkspaceListItem[] = results.map((row) => ({
      workspaceId: this.encodeWorkspaceId(row.normalized_topic),
      displayLabel: row.display_label,
      memoryCount: Number(row.memory_count),
    }));

    return {
      workspaces,
      total,
      limit,
      offset,
    };
  }

  /**
   * Get memories in a workspace (by normalized topic).
   * Uses exact same normalization logic as listWorkspaces.
   * Membership filtering, pagination, and ordering done in PostgreSQL.
   *
   * Two-query pattern:
   * 1. Stats query: workspace existence, total count, display label (unpaginated)
   * 2. Page query: paginated memory IDs for the requested page
   *
   * This allows correct behavior for offset beyond end (200 with empty array)
   * vs. workspace not found (404).
   */
  async getWorkspaceMemories(
    userId: string,
    encodedWorkspaceId: string,
    limit: number = 20,
    offset: number = 0,
  ): Promise<WorkspaceDetailResponse> {
    const normalizedTopic = this.decodeAndVerifyWorkspaceId(encodedWorkspaceId);

    interface StatsRow {
      total_count: number;
      display_label: string;
    }

    interface PageRow {
      memory_id: string;
    }

    const statsQuery = await this.prisma.$queryRaw<StatsRow[]>`
      WITH topic_expanded AS (
        SELECT
          m."id" AS memory_id,
          LOWER(
            REGEXP_REPLACE(
              REGEXP_REPLACE(
                TRIM(jsonb_array_elements_text(ai."valueJson")),
                '\\s+', ' ', 'g'
              ),
              '^\s+|\s+$', '', 'g'
            )
          ) AS normalized_topic,
          TRIM(jsonb_array_elements_text(ai."valueJson")) AS raw_topic
        FROM "memories" m
        JOIN "ai_inferences" ai ON m."id" = ai."memoryId"
        WHERE m."userId" = ${userId}
          AND m."lifecycleState" NOT IN ('deleted', 'deleted_pending')
          AND m."securityScope" = 'private'
          AND ai."field" = 'topics'
          AND jsonb_typeof(ai."valueJson") = 'array'
      ),
      filtered_topics AS (
        SELECT
          memory_id,
          normalized_topic,
          raw_topic
        FROM topic_expanded
        WHERE normalized_topic != ''
          AND CHAR_LENGTH(normalized_topic) > 0
      ),
      deduped_per_memory AS (
        SELECT DISTINCT ON (memory_id, normalized_topic)
          memory_id,
          normalized_topic,
          raw_topic
        FROM filtered_topics
        ORDER BY memory_id, normalized_topic, raw_topic
      ),
      variant_stats AS (
        SELECT
          normalized_topic,
          raw_topic,
          COUNT(DISTINCT memory_id) AS variant_count
        FROM deduped_per_memory
        GROUP BY normalized_topic, raw_topic
      ),
      ranked_variants AS (
        SELECT
          normalized_topic,
          raw_topic,
          variant_count,
          ROW_NUMBER() OVER (PARTITION BY normalized_topic ORDER BY variant_count DESC, raw_topic ASC) AS rank
        FROM variant_stats
      ),
      matching_memories AS (
        SELECT DISTINCT memory_id
        FROM deduped_per_memory
        WHERE normalized_topic = ${normalizedTopic}
      ),
      workspace_stats AS (
        SELECT
          COUNT(DISTINCT memory_id) AS total_count,
          (SELECT raw_topic FROM ranked_variants rv WHERE rv.normalized_topic = ${normalizedTopic} AND rv.rank = 1 LIMIT 1) AS display_label
        FROM matching_memories
      )
      SELECT
        total_count,
        display_label
      FROM workspace_stats
    `;

    if (statsQuery.length === 0) {
      throw new Error('Workspace not found or has fewer than 2 memories');
    }

    const totalCount = Number(statsQuery[0]?.total_count ?? 0);
    const displayLabel = statsQuery[0]?.display_label ?? '';

    if (totalCount < 2) {
      throw new Error('Workspace not found or has fewer than 2 memories');
    }

    const pageQuery = await this.prisma.$queryRaw<PageRow[]>`
      WITH topic_expanded AS (
        SELECT
          m."id" AS memory_id,
          m."capturedAt",
          LOWER(
            REGEXP_REPLACE(
              REGEXP_REPLACE(
                TRIM(jsonb_array_elements_text(ai."valueJson")),
                '\\s+', ' ', 'g'
              ),
              '^\s+|\s+$', '', 'g'
            )
          ) AS normalized_topic
        FROM "memories" m
        JOIN "ai_inferences" ai ON m."id" = ai."memoryId"
        WHERE m."userId" = ${userId}
          AND m."lifecycleState" NOT IN ('deleted', 'deleted_pending')
          AND m."securityScope" = 'private'
          AND ai."field" = 'topics'
          AND jsonb_typeof(ai."valueJson") = 'array'
      ),
      filtered_topics AS (
        SELECT
          memory_id,
          "capturedAt",
          normalized_topic
        FROM topic_expanded
        WHERE normalized_topic != ''
          AND CHAR_LENGTH(normalized_topic) > 0
      ),
      deduped_per_memory AS (
        SELECT DISTINCT ON (memory_id, normalized_topic)
          memory_id,
          "capturedAt",
          normalized_topic
        FROM filtered_topics
        ORDER BY memory_id, normalized_topic
      ),
      matching_memories AS (
        SELECT DISTINCT memory_id, "capturedAt"
        FROM deduped_per_memory
        WHERE normalized_topic = ${normalizedTopic}
      )
      SELECT
        mm.memory_id
      FROM matching_memories mm
      ORDER BY mm."capturedAt" DESC, mm.memory_id DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const paginatedMemoryIds = pageQuery.map((r) => r.memory_id);

    if (paginatedMemoryIds.length === 0) {
      return {
        workspaceId: encodedWorkspaceId,
        displayLabel,
        memories: [],
        total: totalCount,
        limit,
        offset,
      };
    }

    const memories = await this.prisma.memory.findMany({
      where: {
        id: { in: paginatedMemoryIds },
      },
      include: {
        aiInferences: {
          where: { field: { in: ['title', 'type'] } },
          orderBy: LATEST_AI_INFERENCE_ORDER,
        },
        userConfirmations: true,
        assets: true,
      },
    });

    const resultMemories = paginatedMemoryIds
      .map((memoryId) => memories.find((m) => m.id === memoryId))
      .filter((m): m is typeof memories[0] => !!m)
      .map((memory) => {
        const title =
          resolveTitleFromFields(memory.title ?? '', memory.aiInferences, memory.userConfirmations) ||
          `${memory.sourceType} Memory`;

        const typeInference = memory.aiInferences.find((ai) => ai.field === 'type');
        const memoryType = (typeInference?.valueJson as string) || memory.memoryType || 'GENERIC';

        return {
          id: memory.id,
          title,
          memoryType,
          sourceType: memory.sourceType,
          capturedAt: memory.capturedAt,
          processingState: memory.processingState,
          securityScope: memory.securityScope,
          assets: memory.assets.map((asset) => ({
            id: asset.id,
            mimeType: asset.mimeType,
            variant: asset.variant,
            url: `/assets/${asset.id}/content`,
          })),
        };
      });

    return {
      workspaceId: encodedWorkspaceId,
      displayLabel,
      memories: resultMemories,
      total: totalCount,
      limit,
      offset,
    };
  }
}
