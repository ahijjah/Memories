import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmbeddingService } from '../ai/embedding.service';
import { toVectorLiteral } from '../../common/pgvector.util';
import { resolveTitleFromFields } from '../../common/resolve-title.util';

export interface SearchResult {
  id: string;
  title: string;
  summary: string;
  sourceUri: string | null;
  distance: number;
  createdAt: Date;
}

interface RawSearchResult {
  id: string;
  title: string;
  summary: string;
  sourceUri: string | null;
  distance: number;
  createdAt: Date;
}

type TitleInference = Prisma.AIInferenceGetPayload<Record<string, never>>;
type TitleConfirmation = Prisma.UserConfirmationGetPayload<Record<string, never>>;

const MAX_DISTANCE_THRESHOLD = 0.5;

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: EmbeddingService,
  ) {}

  async search(userId: string, query: string, limit: number = 20): Promise<SearchResult[]> {
    // Embed the query
    const queryEmbedding = await this.embeddingService.embed(query, 'query');
    const vectorLiteral = toVectorLiteral(queryEmbedding);

    // Fetch memory IDs and summaries from raw SQL similarity search
    const rawResults = await this.prisma.$queryRaw<RawSearchResult[]>`
      SELECT
        m."id",
        m."title",
        summary_inf."valueJson" #>> '{}' AS "summary",
        m."sourceUri",
        e."vector" <=> ${vectorLiteral}::"vector"(1024) AS "distance",
        m."createdAt"
      FROM "embeddings" e
      JOIN "memories" m ON e."memoryId" = m."id"
      LEFT JOIN LATERAL (
        SELECT "valueJson" FROM "ai_inferences" ai
        WHERE ai."memoryId" = m."id" AND ai."field" = 'summary'
        ORDER BY ai."createdAt" DESC
        LIMIT 1
      ) AS summary_inf ON true
      WHERE m."userId" = ${userId} AND m."lifecycleState" != 'deleted' AND m."securityScope" != 'vault' AND e."vector" <=> ${vectorLiteral}::"vector"(1024) < ${MAX_DISTANCE_THRESHOLD}
      ORDER BY "distance" ASC
      LIMIT ${limit}
    `;

    // Fetch title inferences and confirmations for title resolution
    const memoryIds = rawResults.map((r: RawSearchResult) => r.id);
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
    const results = rawResults.map((result: RawSearchResult) => {
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
}
