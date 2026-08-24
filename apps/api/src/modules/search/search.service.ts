import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmbeddingService } from '../ai/embedding.service';
import { toVectorLiteral } from '../../common/pgvector.util';

export interface SearchResult {
  id: string;
  title: string;
  summary: string;
  sourceUri: string | null;
  distance: number;
  createdAt: Date;
}

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

    // Raw SQL similarity search using cosine distance, scoped to user's memories
    const results = await this.prisma.$queryRaw<
      {
        id: string;
        title: string;
        summary: string;
        sourceUri: string | null;
        distance: number;
        createdAt: Date;
      }[]
    >`
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
      WHERE m."userId" = ${userId} AND m."lifecycleState" != 'deleted' AND m."securityScope" != 'vault'
      ORDER BY "distance" ASC
      LIMIT ${limit}
    `;

    return results;
  }
}
