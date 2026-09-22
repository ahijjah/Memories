import { Injectable, NotFoundException, InternalServerErrorException, ForbiddenException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import { nanoid } from 'nanoid';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AiQueueService } from '../ai/ai-queue.service';
import { ObjectStorageSseService } from '../../common/crypto/object-storage-sse.service';

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
    private readonly sseCrypto: ObjectStorageSseService,
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
      // Disable automatic checksum calculation for presigned URLs.
      // The mobile client (expo-file-system.FileSystem.uploadAsync) is a non-SDK HTTP client
      // that cannot compute or send AWS SDK checksums. MinIO validates checksums and rejects
      // mismatches with 400. Setting requestChecksumCalculation to 'WHEN_REQUIRED' ensures
      // checksums are only added if the service explicitly requires them, not by default.
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
  }

  private addStorageRoutingPrefix(signedUrl: string): string {
    return signedUrl.replace(/^(https?:\/\/[^/]+)(\/)/, '$1/storage$2');
  }

  async getAssetContentStream(
    assetId: string,
    userId: string,
  ): Promise<{ body: Readable; mimeType: string; size?: number }> {
    const asset = await this.prisma.memoryAsset.findUnique({
      where: { id: assetId },
      include: { memory: true },
    });

    if (!asset) {
      throw new NotFoundException(`Asset ${assetId} not found`);
    }

    if (asset.memory.userId !== userId) {
      throw new ForbiddenException('You do not have access to this Memory');
    }

    if (['deleted_pending', 'deleted'].includes(asset.memory.lifecycleState)) {
      throw new NotFoundException('Memory is no longer available');
    }

    const sseParams = this.sseCrypto.getSseParams();
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: asset.objectKey,
      ...sseParams,
    });

    try {
      const response = await this.s3Client.send(command);
      return {
        body: response.Body as Readable,
        mimeType: asset.mimeType,
        size: response.ContentLength,
      };
    } catch (error) {
      this.logger.error(
        `Failed to retrieve asset ${assetId} from storage: ${(error as Error).message}`,
      );
      throw new InternalServerErrorException(
        'Failed to retrieve asset content from storage',
      );
    }
  }

  async createUploadTarget(memoryId: string, mimeType: string) {
    const memory = await this.prisma.memory.findUnique({ where: { id: memoryId } });
    if (!memory) throw new NotFoundException('Memory not found');

    const objectKey = `memories/${memoryId}/${nanoid()}`;
    const expiresInSeconds = 900;

    const sseParams = this.sseCrypto.getSseParams();
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ContentType: mimeType,
      ...sseParams,
    });

    const signedUrl = await getSignedUrl(this.s3PublicClient, command, { expiresIn: expiresInSeconds });
    // Rewrite signed URL to include /storage/ prefix for public reverse proxy routing.
    // nginx will strip /storage/ before forwarding to MinIO, so the signature remains valid.
    const uploadUrl = this.addStorageRoutingPrefix(signedUrl);
    const uploadHeaders = this.sseCrypto.getSseHeaders();

    return { objectKey, uploadUrl, mimeType, expiresInSeconds, uploadHeaders };
  }

  async completeUpload(memoryId: string, objectKey: string, mimeType: string, checksum?: string, pageIndex?: number) {
    const sseParams = this.sseCrypto.getSseParams();
    const headCommand = new HeadObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ...sseParams,
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
      data: { memoryId, objectKey, mimeType, checksum, pageIndex, variant: 'original' },
    });

    // Enqueue AI processing for image-sourced Memories now that asset exists.
    // Text/URL Memories were already enqueued in memory.service.ts's create().
    // For multi-page documents (pageIndex defined), skip auto-enqueue; frontend will call
    // reprocessMemory() once all pages are uploaded (spec §8: idempotent processing).
    const isImageSource = ['image', 'camera', 'screenshot'].includes(memory.sourceType);
    const isSingleAsset = pageIndex === undefined;
    if (isImageSource && isSingleAsset) {
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
