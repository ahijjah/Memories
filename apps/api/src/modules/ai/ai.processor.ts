import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { AnthropicAiProvider } from '@memory-app/ai';
import { PrismaService } from '../../common/prisma/prisma.service';
import { toVectorLiteral } from '../../common/pgvector.util';
import { EmbeddingService } from './embedding.service';
import { AI_PROCESSING_QUEUE, AiProcessingJobData } from './ai-queue.service';

@Processor(AI_PROCESSING_QUEUE)
export class AiProcessor extends WorkerHost {
  private readonly logger = new Logger(AiProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: EmbeddingService,
  ) {
    super();
  }

  async process(job: Job<AiProcessingJobData>): Promise<void> {
    const { memoryId } = job.data;

    const memory = await this.prisma.memory.findUnique({ where: { id: memoryId } });
    if (!memory) {
      this.logger.warn(`Memory ${memoryId} not found — skipping (may have been deleted)`);
      return;
    }

    await this.prisma.memory.update({
      where: { id: memoryId },
      data: { processingState: 'processing' },
    });

    try {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY is not configured');
      }

      const provider = new AnthropicAiProvider(apiKey);
      const inputText = memory.title ?? memory.sourceUri ?? '(no text content captured)';
      const result = await provider.understand({
        text: inputText,
        sourceUri: memory.sourceUri ?? undefined,
      });

      // Store as AIInference records, never overwriting the original capture
      // (spec §6 precedence rule: confirmed > AI inference > raw fallback).
      await this.prisma.$transaction([
        this.prisma.aIInference.create({
          data: {
            memoryId,
            field: 'title',
            valueJson: result.title,
            confidence: result.confidence,
            modelVersion: result.modelVersion,
            provenance: 'llm_extraction',
          },
        }),
        this.prisma.aIInference.create({
          data: {
            memoryId,
            field: 'summary',
            valueJson: result.summary,
            confidence: result.confidence,
            modelVersion: result.modelVersion,
            provenance: 'llm_extraction',
          },
        }),
        this.prisma.aIInference.create({
          data: {
            memoryId,
            field: 'topics',
            valueJson: result.topics,
            confidence: result.confidence,
            modelVersion: result.modelVersion,
            provenance: 'llm_extraction',
          },
        }),
        this.prisma.memory.update({
          where: { id: memoryId },
          data: {
            processingState: 'understood',
            memoryType: result.type as any,
          },
        }),
      ]);

      // Generate embedding for semantic search (non-fatal; Memory already understood).
      try {
        const embeddingText = `${result.title}\n\n${result.summary}\n\nTopics: ${result.topics.join(', ')}`;
        const embedding = await this.embeddingService.embed(embeddingText, 'document');
        const vectorLiteral = toVectorLiteral(embedding);
        const model = this.embeddingService.getModel();

        await this.prisma.$executeRaw`
          INSERT INTO "embeddings" ("id", "memoryId", "vector", "provider", "model", "inputType", "createdAt")
          VALUES (
            ${crypto.randomUUID()},
            ${memoryId},
            ${vectorLiteral}::"vector"(1024),
            'voyage',
            ${model},
            'document',
            CURRENT_TIMESTAMP
          )
          ON CONFLICT ("memoryId") DO UPDATE SET
            "vector" = EXCLUDED."vector",
            "model" = EXCLUDED."model",
            "createdAt" = CURRENT_TIMESTAMP
        `;
      } catch (embeddingErr) {
        this.logger.warn(
          `Embedding generation failed for Memory ${memoryId}: ${(embeddingErr as Error).message}. Memory is still in 'understood' state.`,
        );
        // Non-fatal; do not throw or change Memory state.
      }
    } catch (err) {
      // Provider failure must not destroy the capture (BR-001, spec §9, §17).
      this.logger.error(`AI understanding failed for Memory ${memoryId}: ${(err as Error).message}`);
      await this.prisma.memory.update({
        where: { id: memoryId },
        data: { processingState: 'failed' },
      });
      throw err; // let BullMQ retry per the queue's backoff policy
    }
  }
}
