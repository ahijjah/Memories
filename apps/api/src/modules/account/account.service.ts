import { Injectable, BadRequestException, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { createClerkClient } from '@clerk/backend';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);
  private s3Client: S3Client;
  private clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
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

  async export(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        locale: true,
        plan: true,
        preferences: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const memories = await this.prisma.memory.findMany({
      where: { userId },
      select: {
        id: true,
        sourceType: true,
        sourceUri: true,
        memoryType: true,
        title: true,
        capturedAt: true,
        processingState: true,
        lifecycleState: true,
        securityScope: true,
        assets: {
          select: {
            id: true,
            objectKey: true,
            mimeType: true,
            checksum: true,
            pageIndex: true,
            variant: true,
            createdAt: true,
          },
        },
        createdAt: true,
        updatedAt: true,
      },
    });

    const collections = await this.prisma.collection.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        description: true,
        memories: {
          select: {
            memoryId: true,
          },
        },
        createdAt: true,
        updatedAt: true,
      },
    });

    const reminders = await this.prisma.reminder.findMany({
      where: { userId },
      select: {
        id: true,
        memoryId: true,
        note: true,
        remindAt: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      user,
      memories,
      collections,
      reminders,
    };
  }

  async deleteAccount(userId: string, confirmEmail: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || user.email.toLowerCase() !== confirmEmail.toLowerCase()) {
      throw new BadRequestException('Email confirmation does not match');
    }

    const assets = await this.prisma.memoryAsset.findMany({
      where: {
        memory: {
          userId,
        },
      },
      select: {
        objectKey: true,
      },
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
          `Failed to delete asset ${asset.objectKey} for user ${userId}: ${(err as Error).message}`,
        );
      }
    }

    await this.prisma.user.delete({
      where: { id: userId },
    });

    try {
      if (user.clerkUserId) {
        await this.clerk.users.deleteUser(user.clerkUserId);
      }
    } catch (err) {
      this.logger.error(
        `Failed to delete Clerk user ${user.clerkUserId}: ${(err as Error).message}`,
      );
    }

    return {
      deleted: true,
      assetCleanupFailures,
    };
  }
}
