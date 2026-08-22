import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { AnthropicAiProvider } from '@memory-app/ai';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AI_PROCESSING_QUEUE, AiProcessingJobData } from './ai-queue.service';

@Processor(AI_PROCESSING_QUEUE)
export class AiProcessor extends WorkerHost {
  private readonly logger = new Logger(AiProcessor.name);

  constructor(private readonly prisma: PrismaService) {
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
