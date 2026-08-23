import { Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { nanoid } from 'nanoid';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class AssetsService {
  private s3Client: S3Client;
  private bucket: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
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

    const uploadUrl = await getSignedUrl(this.s3Client, command, { expiresIn: expiresInSeconds });

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

    return this.prisma.memoryAsset.create({
      data: { memoryId, objectKey, mimeType, checksum, variant: 'original' },
    });
  }
}
