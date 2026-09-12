import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AssetsService } from '../assets/assets.service';
import { MemoryDeletionQueueService } from '../memory/deletion-queue.service';

@Injectable()
export class VaultService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assetsService: AssetsService,
    private readonly deletionQueue: MemoryDeletionQueueService,
  ) {}

  async lock(userId: string, memoryId: string) {
    const memory = await this.prisma.memory.findUnique({
      where: { id: memoryId },
      select: { id: true, userId: true },
    });
    if (!memory) throw new NotFoundException('Memory not found');
    this.assertOwnership(memory.userId, userId);

    return this.prisma.memory.update({
      where: { id: memoryId },
      data: { securityScope: 'vault' },
    });
  }

  async unlock(userId: string, memoryId: string) {
    const memory = await this.prisma.memory.findUnique({
      where: { id: memoryId },
      select: { id: true, userId: true },
    });
    if (!memory) throw new NotFoundException('Memory not found');
    this.assertOwnership(memory.userId, userId);

    return this.prisma.memory.update({
      where: { id: memoryId },
      data: { securityScope: 'private' },
    });
  }

  async findAllForUser(userId: string) {
    const memories = await this.prisma.memory.findMany({
      where: {
        userId,
        lifecycleState: { notIn: ['deleted', 'deleted_pending'] },
        securityScope: 'vault',
      },
      include: { assets: true },
      orderBy: { capturedAt: 'desc' },
    });
    return Promise.all(memories.map((m: any) => this.enrichWithAssetUrls(m)));
  }

  async findOneForUser(userId: string, id: string) {
    const memory = await this.prisma.memory.findUnique({
      where: { id },
      include: { assets: true, aiInferences: true, userConfirmations: true },
    });
    if (!memory) throw new NotFoundException('Memory not found');
    this.assertOwnership(memory.userId, userId);
    if (memory.securityScope !== 'vault') {
      throw new NotFoundException('Memory not found');
    }
    return this.enrichWithAssetUrls(memory);
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

  async deleteMemory(userId: string, id: string) {
    const memory = await this.prisma.memory.findUnique({
      where: { id },
    });
    if (!memory) throw new NotFoundException('Memory not found');
    this.assertOwnership(memory.userId, userId);
    if (memory.securityScope !== 'vault') {
      throw new NotFoundException('Memory not found');
    }

    const updated = await this.prisma.memory.update({
      where: { id },
      data: {
        lifecycleState: 'deleted_pending',
        deletedAt: new Date(),
      },
    });

    await this.deletionQueue.enqueueFinalization(id);
    return updated;
  }

  async restoreMemory(userId: string, id: string) {
    const memory = await this.prisma.memory.findUnique({
      where: { id },
    });
    if (!memory) throw new NotFoundException('Memory not found');
    this.assertOwnership(memory.userId, userId);
    if (memory.securityScope !== 'vault') {
      throw new NotFoundException('Memory not found');
    }

    if (memory.lifecycleState !== 'deleted_pending') {
      throw new BadRequestException(
        'Only memories in deleted_pending state can be restored',
      );
    }

    await this.deletionQueue.cancelFinalization(id);

    const updated = await this.prisma.memory.update({
      where: { id },
      data: {
        lifecycleState: 'active',
        deletedAt: null,
      },
    });

    return updated;
  }

  private assertOwnership(ownerId: string, requestingUserId: string) {
    if (ownerId !== requestingUserId) {
      throw new ForbiddenException('You do not have access to this Memory');
    }
  }
}
