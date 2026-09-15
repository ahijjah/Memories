import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmbeddingService } from '../ai/embedding.service';
import { AnthropicAiProvider, ContextMemory } from '@memory-app/ai';
import { toVectorLiteral } from '../../common/pgvector.util';
import { resolveTitleFromFields } from '../../common/resolve-title.util';

export interface AskResponse {
  answer: string;
  citedMemoryIds: string[];
  sources: Array<{
    memoryId: string;
    title: string;
    summary: string;
    sourceUri: string | null;
  }>;
}

interface RawMemory {
  memoryId: string;
  title: string;
  summary: string;
  sourceUri: string | null;
}

type TitleInference = Prisma.AIInferenceGetPayload<Record<string, never>>;
type TitleConfirmation = Prisma.UserConfirmationGetPayload<Record<string, never>>;

@Injectable()
export class AskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: EmbeddingService,
  ) {}

  async ask(userId: string, question: string): Promise<AskResponse> {
    // Embed the question
    const questionEmbedding = await this.embeddingService.embed(
      question,
      'query',
    );
    const vectorLiteral = toVectorLiteral(questionEmbedding);

    // Retrieve top 5 most relevant memories, scoped to userId
    const rawMemories = await this.prisma.$queryRaw<RawMemory[]>`
      SELECT
        m."id" AS "memoryId",
        m."title",
        summary_inf."valueJson" #>> '{}' AS "summary",
        m."sourceUri"
      FROM "embeddings" e
      JOIN "memories" m ON e."memoryId" = m."id"
      LEFT JOIN LATERAL (
        SELECT "valueJson" FROM "ai_inferences" ai
        WHERE ai."memoryId" = m."id" AND ai."field" = 'summary'
        ORDER BY ai."createdAt" DESC
        LIMIT 1
      ) AS summary_inf ON true
      WHERE m."userId" = ${userId} AND m."lifecycleState" != 'deleted' AND m."securityScope" != 'vault'
      ORDER BY e."vector" <=> ${vectorLiteral}::"vector"(1024) ASC
      LIMIT 5
    `;

    // If no memories found, return early without calling AI provider
    if (rawMemories.length === 0) {
      return {
        answer:
          "I don't have any saved information relevant to that question yet.",
        citedMemoryIds: [],
        sources: [],
      };
    }

    // Fetch title inferences and confirmations for title resolution
    const memoryIds = rawMemories.map((m: RawMemory) => m.memoryId);
    const titleInferences = await this.prisma.aIInference.findMany({
      where: {
        memoryId: { in: memoryIds },
        field: 'title',
      },
    });

    const titleConfirmations = await this.prisma.userConfirmation.findMany({
      where: {
        memoryId: { in: memoryIds },
        field: 'title',
      },
    });

    // Resolve titles and create final memory list
    const retrievedMemories = rawMemories.map((mem: RawMemory) => {
      const inferences = titleInferences.filter((inf: TitleInference) => inf.memoryId === mem.memoryId);
      const confirmations = titleConfirmations.filter((conf: TitleConfirmation) => conf.memoryId === mem.memoryId);
      const resolvedTitle = resolveTitleFromFields(
        mem.title,
        inferences,
        confirmations,
      );

      return {
        ...mem,
        title: resolvedTitle,
      };
    });

    // Call AI provider with context
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not configured');
    }
    const provider = new AnthropicAiProvider(apiKey);
    const contextMemories: ContextMemory[] = retrievedMemories.map(
      (mem: { memoryId: string; title: string; summary: string; sourceUri: string | null }) => ({
        memoryId: mem.memoryId,
        title: mem.title,
        summary: mem.summary,
        sourceUri: mem.sourceUri,
      }),
    );

    const aiResponse = await provider.answerWithContext(
      question,
      contextMemories,
    );

    // Filter sources to only those that were cited
    const citedSources = retrievedMemories.filter(
      (mem: { memoryId: string; title: string; summary: string; sourceUri: string | null }) =>
        aiResponse.citedMemoryIds.includes(mem.memoryId),
    );

    return {
      answer: aiResponse.answer,
      citedMemoryIds: aiResponse.citedMemoryIds,
      sources: citedSources,
    };
  }
}
