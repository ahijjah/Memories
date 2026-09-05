import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import type { Job } from 'bullmq';
import { AnthropicAiProvider } from '@memory-app/ai';
import { PrismaService } from '../../common/prisma/prisma.service';
import { toVectorLiteral } from '../../common/pgvector.util';
import { EmbeddingService } from './embedding.service';
import { UrlMetadataService } from './url-metadata.service';
import { AI_PROCESSING_QUEUE, AiProcessingJobData } from './ai-queue.service';

@Processor(AI_PROCESSING_QUEUE)
export class AiProcessor extends WorkerHost {
  private readonly logger = new Logger(AiProcessor.name);
  private s3Client: S3Client;
  private bucket: string;
  private readonly MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: EmbeddingService,
    private readonly urlMetadataService: UrlMetadataService,
    private readonly config: ConfigService,
  ) {
    super();
    const endpoint = this.config.getOrThrow('OBJECT_STORAGE_ENDPOINT');
    const accessKeyId = this.config.getOrThrow('OBJECT_STORAGE_ACCESS_KEY');
    const secretAccessKey = this.config.getOrThrow('OBJECT_STORAGE_SECRET_KEY');
    this.bucket = this.config.getOrThrow('OBJECT_STORAGE_BUCKET');

    this.s3Client = new S3Client({
      endpoint,
      region: 'us-east-1',
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
  }

  private async fetchImageAsBase64(
    objectKey: string,
    mimeType: string,
  ): Promise<{ base64: string; mediaType: string } | null> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
      });

      const response = await this.s3Client.send(command);

      if (!response.Body) {
        this.logger.warn(`No body in S3 response for ${objectKey}`);
        return null;
      }

      // Check size before processing
      if (response.ContentLength && response.ContentLength > this.MAX_IMAGE_SIZE) {
        this.logger.warn(
          `Image size ${response.ContentLength} exceeds limit of ${this.MAX_IMAGE_SIZE} for ${objectKey}`,
        );
        return null;
      }

      // Read stream into buffer
      const chunks: Buffer[] = [];
      return new Promise((resolve, reject) => {
        const stream = response.Body as any; // Body is a Node.js Readable stream
        stream.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        stream.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const base64 = buffer.toString('base64');
          resolve({ base64, mediaType: mimeType });
        });
        stream.on('error', (err: Error) => {
          this.logger.warn(`Stream error reading ${objectKey}: ${err.message}`);
          reject(err);
        });
      });
    } catch (err) {
      this.logger.warn(
        `Failed to fetch image from S3 (${objectKey}): ${(err as Error).message}`,
      );
      return null;
    }
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
      let inputText = memory.title ?? memory.sourceUri ?? '(no text content captured)';
      let ogImageUrl: string | undefined;

      // Fetch URL metadata for url-sourced Memories to provide richer content to AI
      if (memory.sourceType === 'url' && memory.sourceUri) {
        const urlMetadata = await this.urlMetadataService.fetchMetadata(
          memory.sourceUri,
        );
        if (urlMetadata) {
          // Use extracted metadata if available, falling back to title/sourceUri
          if (urlMetadata.title) {
            inputText = urlMetadata.title;
          }
          if (urlMetadata.description) {
            inputText = `${inputText}\n\n${urlMetadata.description}`;
          }
          ogImageUrl = urlMetadata.imageUrl;
          this.logger.debug(
            `URL metadata extracted for Memory ${memoryId}: title="${urlMetadata.title}", hasImage=${!!urlMetadata.imageUrl}`,
          );
        } else {
          this.logger.debug(
            `No URL metadata extracted for Memory ${memoryId}, using fallback text`,
          );
        }
      }

      // Check if this is an image/camera capture with assets
      let imageBase64: string | undefined;
      let imageMediaType: string | undefined;
      const isImageSource = ['image', 'camera', 'screenshot'].includes(memory.sourceType);

      if (isImageSource) {
        // Fetch associated asset(s) for vision analysis
        const assets = await this.prisma.memoryAsset.findMany({
          where: { memoryId },
        });

        if (assets.length > 0) {
          // Use the first (primary) asset
          const imageData = await this.fetchImageAsBase64(assets[0].objectKey, assets[0].mimeType);
          if (imageData) {
            imageBase64 = imageData.base64;
            imageMediaType = imageData.mediaType;
            this.logger.debug(
              `Vision analysis enabled for Memory ${memoryId} (${imageData.mediaType}, ${Buffer.byteLength(imageData.base64, 'utf8')} bytes base64)`,
            );
          } else {
            this.logger.warn(
              `Failed to fetch image for Memory ${memoryId}, falling back to text-only analysis`,
            );
          }
        }
      }

      const result = await provider.understand({
        text: inputText,
        sourceUri: memory.sourceUri ?? undefined,
        imageBase64,
        imageMediaType,
      });

      // Store as AIInference records, never overwriting the original capture
      // (spec §6 precedence rule: confirmed > AI inference > raw fallback).
      const inferencesToCreate: any[] = [
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
      ];

      // P0.1: Structured AI Understanding — store optional fields only when present
      if (result.intent) {
        inferencesToCreate.push(
          this.prisma.aIInference.create({
            data: {
              memoryId,
              field: 'intent',
              valueJson: result.intent,
              confidence: result.confidence,
              modelVersion: result.modelVersion,
              provenance: 'llm_extraction',
            },
          }),
        );
      }

      if (result.entities && result.entities.length > 0) {
        inferencesToCreate.push(
          this.prisma.aIInference.create({
            data: {
              memoryId,
              field: 'entities',
              valueJson: result.entities,
              confidence: result.confidence,
              modelVersion: result.modelVersion,
              provenance: 'llm_extraction',
            },
          }),
        );
      }

      if (result.location) {
        inferencesToCreate.push(
          this.prisma.aIInference.create({
            data: {
              memoryId,
              field: 'location',
              valueJson: result.location,
              confidence: result.confidence,
              modelVersion: result.modelVersion,
              provenance: 'llm_extraction',
            },
          }),
        );
      }

      if (result.date) {
        inferencesToCreate.push(
          this.prisma.aIInference.create({
            data: {
              memoryId,
              field: 'date',
              valueJson: result.date,
              confidence: result.confidence,
              modelVersion: result.modelVersion,
              provenance: 'llm_extraction',
            },
          }),
        );
      }

      inferencesToCreate.push(
        this.prisma.memory.update({
          where: { id: memoryId },
          data: {
            processingState: 'understood',
            memoryType: result.type as any,
            ogImageUrl,
          },
        }),
      );

      await this.prisma.$transaction(inferencesToCreate);

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
