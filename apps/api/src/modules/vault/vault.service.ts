import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FieldEncryptionService } from '../../common/crypto/field-encryption.service';
import { isSensitiveField } from '../../common/crypto/sensitive-fields';
import { AssetsService } from '../assets/assets.service';
import { MemoryDeletionQueueService } from '../memory/deletion-queue.service';

@Injectable()
export class VaultService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assetsService: AssetsService,
    private readonly deletionQueue: MemoryDeletionQueueService,
    private readonly fieldEncryption: FieldEncryptionService,
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
    return this.enrichWithAssetUrls(this.decryptSensitiveFields(memory));
  }

  async getProcessingStatus(userId: string, id: string) {
    const memory = await this.prisma.memory.findUnique({
      where: { id },
      select: { id: true, userId: true, processingState: true, updatedAt: true, securityScope: true },
    });
    if (!memory) throw new NotFoundException('Memory not found');
    this.assertOwnership(memory.userId, userId);
    if (memory.securityScope !== 'vault') {
      throw new NotFoundException('Memory not found');
    }
    return memory;
  }

  private decryptSensitiveFields(memory: any) {
    if (!memory) return memory;

    if (memory.aiInferences && Array.isArray(memory.aiInferences)) {
      memory.aiInferences = memory.aiInferences.map((inf: any) => {
        if (isSensitiveField(inf.field)) {
          return {
            ...inf,
            valueJson: this.fieldEncryption.decrypt(inf.valueJson),
          };
        }
        return inf;
      });
    }

    if (memory.userConfirmations && Array.isArray(memory.userConfirmations)) {
      memory.userConfirmations = memory.userConfirmations.map((conf: any) => {
        if (isSensitiveField(conf.field)) {
          return {
            ...conf,
            confirmedValue: this.fieldEncryption.decrypt(conf.confirmedValue),
          };
        }
        return conf;
      });
    }

    return memory;
  }

  private async enrichWithAssetUrls(memory: any) {
    if (!memory.assets || memory.assets.length === 0) {
      return memory;
    }
    const enrichedAssets = await Promise.all(
      memory.assets.map(async (asset: any) => {
        const viewData = await this.assetsService.getViewUrl(asset.objectKey);
        return {
          ...asset,
          url: viewData.url,
          headers: viewData.headers,
        };
      }),
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

  async confirmField(userId: string, memoryId: string, field: string, confirmedValue: any) {
    const memory = await this.prisma.memory.findUnique({
      where: { id: memoryId },
      select: { id: true, userId: true, securityScope: true },
    });
    if (!memory) throw new NotFoundException('Memory not found');
    this.assertOwnership(memory.userId, userId);
    if (memory.securityScope !== 'vault') {
      throw new NotFoundException('Memory not found');
    }

    const encryptedValue = isSensitiveField(field)
      ? this.fieldEncryption.encrypt(confirmedValue)
      : confirmedValue;

    return this.prisma.userConfirmation.upsert({
      where: { memoryId_field: { memoryId, field } },
      create: {
        memoryId,
        userId,
        field,
        confirmedValue: encryptedValue,
      },
      update: {
        confirmedValue: encryptedValue,
      },
    });
  }

  private assertOwnership(ownerId: string, requestingUserId: string) {
    if (ownerId !== requestingUserId) {
      throw new ForbiddenException('You do not have access to this Memory');
    }
  }
}
