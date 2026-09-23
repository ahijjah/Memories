import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

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
   * Select display label from raw topic variants.
   * Prefer most frequent variant; tie-break alphabetically.
   */
  selectDisplayLabel(rawVariants: string[]): string {
    if (rawVariants.length === 0) return '';

    const variantCounts = new Map<string, number>();
    for (const variant of rawVariants) {
      variantCounts.set(variant, (variantCounts.get(variant) ?? 0) + 1);
    }

    const sorted = Array.from(variantCounts.entries())
      .sort(([a, countA], [b, countB]) => {
        if (countB !== countA) return countB - countA;
        return a.localeCompare(b);
      });

    return sorted[0]?.[0] ?? '';
  }

  /**
   * Get all workspaces for authenticated user.
   * Returns normalized topics with 2+ distinct memories, ordered by count.
   */
  async listWorkspaces(
    userId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<WorkspaceListResponse> {
    // Fetch all qualifying memories with topics
    const memories = await this.prisma.memory.findMany({
      where: {
        userId,
        lifecycleState: { notIn: ['deleted', 'deleted_pending'] },
        securityScope: 'private',
      },
      include: {
        aiInferences: {
          where: { field: 'topics' },
        },
      },
    });

    // Build topic map: normalized_topic -> { count, raw_variants }
    const topicMap = new Map<
      string,
      { memoryIds: Set<string>; rawVariants: Set<string> }
    >();

    for (const memory of memories) {
      const topicsInference = memory.aiInferences?.[0];
      if (!topicsInference?.valueJson || !Array.isArray(topicsInference.valueJson)) {
        continue;
      }

      // Expand array and normalize each topic
      const seenInMemory = new Set<string>();
      for (const rawTopic of topicsInference.valueJson) {
        const rawTopicStr = String(rawTopic ?? '').trim();
        if (!rawTopicStr) continue;

        const normalized = this.normalizeTopicForIdentity(rawTopicStr);
        if (!normalized) continue;

        // Deduplicate within memory (only count once per memory per normalized topic)
        if (seenInMemory.has(normalized)) continue;
        seenInMemory.add(normalized);

        // Track memory and raw variant
        if (!topicMap.has(normalized)) {
          topicMap.set(normalized, {
            memoryIds: new Set(),
            rawVariants: new Set(),
          });
        }
        const entry = topicMap.get(normalized)!;
        entry.memoryIds.add(memory.id);
        entry.rawVariants.add(rawTopicStr);
      }
    }

    // Filter to 2+ memories and build results
    const workspaces: WorkspaceListItem[] = [];
    for (const [normalizedTopic, { memoryIds, rawVariants }] of topicMap.entries()) {
      if (memoryIds.size >= 2) {
        workspaces.push({
          workspaceId: this.encodeWorkspaceId(normalizedTopic),
          displayLabel: this.selectDisplayLabel(Array.from(rawVariants)),
          memoryCount: memoryIds.size,
        });
      }
    }

    // Sort by memoryCount DESC, then by normalized topic for determinism
    workspaces.sort((a, b) => {
      // Decode to compare normalized forms
      const aNorm = this.decodeAndVerifyWorkspaceId(a.workspaceId);
      const bNorm = this.decodeAndVerifyWorkspaceId(b.workspaceId);
      if (b.memoryCount !== a.memoryCount) {
        return b.memoryCount - a.memoryCount;
      }
      return aNorm.localeCompare(bNorm);
    });

    // Apply pagination
    const total = workspaces.length;
    const paginated = workspaces.slice(offset, offset + limit);

    return {
      workspaces: paginated,
      total,
      limit,
      offset,
    };
  }

  /**
   * Get memories in a workspace (by normalized topic).
   * Uses exact same normalization logic as listWorkspaces.
   */
  async getWorkspaceMemories(
    userId: string,
    encodedWorkspaceId: string,
    limit: number = 20,
    offset: number = 0,
  ): Promise<WorkspaceDetailResponse> {
    // Decode and normalize workspace ID
    const normalizedTopic = this.decodeAndVerifyWorkspaceId(encodedWorkspaceId);

    // Fetch all qualifying memories with topics
    const memories = await this.prisma.memory.findMany({
      where: {
        userId,
        lifecycleState: { notIn: ['deleted', 'deleted_pending'] },
        securityScope: 'private',
      },
      include: {
        aiInferences: {
          where: { field: 'topics' },
        },
        userConfirmations: true,
        assets: true,
      },
      orderBy: { capturedAt: 'desc' },
    });

    // Find memories belonging to this workspace
    const workspaceMemoryIds = new Set<string>();
    let displayLabel = '';

    for (const memory of memories) {
      const topicsInference = memory.aiInferences?.[0];
      if (!topicsInference?.valueJson || !Array.isArray(topicsInference.valueJson)) {
        continue;
      }

      const seenInMemory = new Set<string>();
      const rawVariants: string[] = [];

      for (const rawTopic of topicsInference.valueJson) {
        const rawTopicStr = String(rawTopic ?? '').trim();
        if (!rawTopicStr) continue;

        const normalized = this.normalizeTopicForIdentity(rawTopicStr);
        if (!normalized) continue;

        if (seenInMemory.has(normalized)) continue;
        seenInMemory.add(normalized);

        if (normalized === normalizedTopic) {
          workspaceMemoryIds.add(memory.id);
          rawVariants.push(rawTopicStr);
        }
      }

      if (rawVariants.length > 0 && !displayLabel) {
        displayLabel = this.selectDisplayLabel(rawVariants);
      }
    }

    // Must have 2+ distinct memories for workspace to exist
    if (workspaceMemoryIds.size < 2) {
      throw new Error('Workspace not found or has fewer than 2 memories');
    }

    // Build result with title precedence: confirmation > inference > raw
    const resultMemories = memories
      .filter((m) => workspaceMemoryIds.has(m.id))
      .slice(offset, offset + limit)
      .map((memory) => {
        // Title resolution
        const titleConfirmation = memory.userConfirmations.find((uc) => uc.field === 'title');
        const titleInference = memory.aiInferences.find((ai) => ai.field === 'title');
        const title =
          (titleConfirmation?.confirmedValue as string) ||
          (titleInference?.valueJson as string) ||
          memory.title ||
          `${memory.sourceType} Memory`;

        // Memory type
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
      total: workspaceMemoryIds.size,
      limit,
      offset,
    };
  }
}
