import { Injectable, NotFoundException, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { nanoid } from 'nanoid';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AiQueueService } from '../ai/ai-queue.service';

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);
  private s3Client: S3Client;
  private s3PublicClient: S3Client;
  private bucket: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly aiQueue: AiQueueService,
  ) {
    const endpoint = this.config.getOrThrow('OBJECT_STORAGE_ENDPOINT');
    const publicEndpoint = this.config.getOrThrow('OBJECT_STORAGE_PUBLIC_ENDPOINT');
    const accessKeyId = this.config.getOrThrow('OBJECT_STORAGE_ACCESS_KEY');
    const secretAccessKey = this.config.getOrThrow('OBJECT_STORAGE_SECRET_KEY');
    this.bucket = this.config.getOrThrow('OBJECT_STORAGE_BUCKET');

    this.s3Client = new S3Client({
      endpoint,
      region: 'us-east-1',
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });

    this.s3PublicClient = new S3Client({
      endpoint: publicEndpoint,
      region: 'us-east-1',
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
  }

  async createUploadTarget(memoryId: string, mimeType: string) {
    const memory = await this.prisma.memory.findUnique({ where: { id: memoryId } });
    if (!memory) throw new NotFoundException('Memory not found');

    const objectKey = `memories/${memoryId}/${nanoid()}`;
    const expiresInSeconds = 900;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ContentType: mimeType,
    });

    const uploadUrl = await getSignedUrl(this.s3PublicClient, command, { expiresIn: expiresInSeconds });

    return { objectKey, uploadUrl, mimeType, expiresInSeconds };
  }

  async completeUpload(memoryId: string, objectKey: string, mimeType: string, checksum?: string) {
    const headCommand = new HeadObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
    });

    try {
      await this.s3Client.send(headCommand);
    } catch (error) {
      throw new InternalServerErrorException('Object not found in storage');
    }

    // Fetch the Memory to check its sourceType
    const memory = await this.prisma.memory.findUnique({ where: { id: memoryId } });
    if (!memory) {
      throw new NotFoundException('Memory not found');
    }

    const asset = await this.prisma.memoryAsset.create({
      data: { memoryId, objectKey, mimeType, checksum, variant: 'original' },
    });

    // Enqueue AI processing for image-sourced Memories now that asset exists.
    // Text/URL Memories were already enqueued in memory.service.ts's create().
    const isImageSource = ['image', 'camera', 'screenshot'].includes(memory.sourceType);
    if (isImageSource) {
      try {
        await this.aiQueue.enqueueUnderstanding(memoryId);
        this.logger.debug(`AI processing enqueued for Memory ${memoryId} after asset upload`);
      } catch (err) {
        this.logger.warn(
          `Failed to enqueue AI processing for Memory ${memoryId}: ${(err as Error).message}. Asset was created but AI understanding may not run.`,
        );
        // Non-fatal; asset is created and stored, just AI processing was not queued.
      }
    }

    return asset;
  }
}
