import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import type { Job } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MEMORY_DELETION_QUEUE, MemoryDeletionJobData } from './deletion-queue.service';

@Processor(MEMORY_DELETION_QUEUE)
export class MemoryDeletionProcessor extends WorkerHost {
  private readonly logger = new Logger(MemoryDeletionProcessor.name);
  private s3Client: S3Client;
  private bucket: string;

  constructor(
    private readonly prisma: PrismaService,
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

  async process(job: Job<MemoryDeletionJobData>): Promise<void> {
    const { memoryId } = job.data;

    const memory = await this.prisma.memory.findUnique({
      where: { id: memoryId },
    });

    if (!memory) {
      this.logger.warn(`Memory ${memoryId} not found — skipping finalization`);
      return;
    }

    // Safety check: only finalize if still in deleted_pending state
    // (guards against restore that happened after job was queued but before it ran)
    if (memory.lifecycleState !== 'deleted_pending') {
      this.logger.log(
        `Memory ${memoryId} is in state '${memory.lifecycleState}', not 'deleted_pending' — skipping finalization`,
      );
      return;
    }

    const assets = await this.prisma.memoryAsset.findMany({
      where: { memoryId },
      select: { objectKey: true },
    });

    let assetCleanupFailures = 0;
    for (const asset of assets) {
      try {
        const deleteCommand = new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: asset.objectKey,
        });
        await this.s3Client.send(deleteCommand);
      } catch (err) {
        assetCleanupFailures++;
        this.logger.warn(
          `Failed to delete asset ${asset.objectKey} for memory ${memoryId}: ${(err as Error).message}`,
        );
      }
    }

    await this.prisma.memory.update({
      where: { id: memoryId },
      data: { lifecycleState: 'deleted' },
    });

    this.logger.log(
      `Finalized deletion of memory ${memoryId} (${assets.length} assets, ${assetCleanupFailures} cleanup failures)`,
    );
  }
}
