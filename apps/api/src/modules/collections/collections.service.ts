import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AssetsService } from '../assets/assets.service';
import { CreateCollectionDto } from './dto/create-collection.dto';

@Injectable()
export class CollectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assetsService: AssetsService,
  ) {}

  async create(userId: string, dto: CreateCollectionDto) {
    return this.prisma.collection.create({
      data: {
        userId,
        name: dto.name,
        description: dto.description,
      },
    });
  }

  async findAllForUser(userId: string) {
    return this.prisma.collection.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOneForUser(userId: string, id: string) {
    const collection = await this.prisma.collection.findUnique({
      where: { id },
      include: {
        memories: {
          include: { memory: { include: { assets: true } } },
          orderBy: { addedAt: 'desc' },
        },
      },
    });

    if (!collection) throw new NotFoundException('Collection not found');
    this.assertOwnership(collection.userId, userId);

    // Filter out vault-scoped memories as defense-in-depth
    const nonVaultMemories = collection.memories.filter(
      (cm: any) => cm.memory.securityScope !== 'vault',
    );

    // Enrich assets with URLs
    const enrichedMemories = await Promise.all(
      nonVaultMemories.map(async (cm: any) => ({
        ...cm,
        memory: await this.enrichWithAssetUrls(cm.memory),
      })),
    );

    return { ...collection, memories: enrichedMemories };
  }

  async delete(userId: string, id: string) {
    const collection = await this.prisma.collection.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });

    if (!collection) throw new NotFoundException('Collection not found');
    this.assertOwnership(collection.userId, userId);

    return this.prisma.collection.delete({
      where: { id },
    });
  }

  async addMemory(userId: string, collectionId: string, memoryId: string) {
    // Check collection exists and is owned by user
    const collection = await this.prisma.collection.findUnique({
      where: { id: collectionId },
      select: { id: true, userId: true },
    });
    if (!collection) throw new NotFoundException('Collection not found');
    this.assertOwnership(collection.userId, userId);

    // Check memory exists and is owned by user
    const memory = await this.prisma.memory.findUnique({
      where: { id: memoryId },
      select: { id: true, userId: true, securityScope: true },
    });
    if (!memory) throw new NotFoundException('Memory not found');
    this.assertOwnership(memory.userId, userId);

    // Reject vault-scoped memories
    if (memory.securityScope === 'vault') {
      throw new BadRequestException(
        'Vault content cannot be added to a Collection',
      );
    }

    // Add to collection (upsert to handle duplicate attempts gracefully)
    return this.prisma.collectionMemory.upsert({
      where: {
        collectionId_memoryId: {
          collectionId,
          memoryId,
        },
      },
      update: {},
      create: {
        collectionId,
        memoryId,
      },
    });
  }

  async removeMemory(userId: string, collectionId: string, memoryId: string) {
    // Check collection exists and is owned by user
    const collection = await this.prisma.collection.findUnique({
      where: { id: collectionId },
      select: { id: true, userId: true },
    });
    if (!collection) throw new NotFoundException('Collection not found');
    this.assertOwnership(collection.userId, userId);

    // Delete the association
    const deleted = await this.prisma.collectionMemory.deleteMany({
      where: {
        collectionId,
        memoryId,
      },
    });

    if (deleted.count === 0) {
      throw new NotFoundException('Memory not found in collection');
    }

    return { success: true };
  }

  private async enrichWithAssetUrls(memory: any) {
    if (!memory.assets || memory.assets.length === 0) {
      return memory;
    }
    const enrichedAssets = await Promise.all(
      memory.assets.map(async (asset: any) => ({
        ...asset,
        url: await this.assetsService.getViewUrl(asset.objectKey),
      })),
    );
    return { ...memory, assets: enrichedAssets };
  }

  private assertOwnership(ownerId: string, requestingUserId: string) {
    if (ownerId !== requestingUserId) {
      throw new ForbiddenException(
        'You do not have access to this Collection',
      );
    }
  }
}
