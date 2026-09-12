import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnthropicAiProvider } from '@memory-app/ai';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FieldEncryptionService } from '../../common/crypto/field-encryption.service';
import { isSensitiveField } from '../../common/crypto/sensitive-fields';
import { AiQueueService } from '../ai/ai-queue.service';
import { AssetsService } from '../assets/assets.service';
import { CreateMemoryDto } from './dto/create-memory.dto';
import { MemoryDeletionQueueService } from './deletion-queue.service';

@Injectable()
export class MemoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiQueue: AiQueueService,
    private readonly assetsService: AssetsService,
    private readonly deletionQueue: MemoryDeletionQueueService,
    private readonly fieldEncryption: FieldEncryptionService,
    private readonly config: ConfigService,
  ) {}

  // Idempotent create (spec §8, §17, BR §3): retrying the same capture
  // with the same idempotencyKey returns the existing Memory rather than
  // creating a duplicate. Client receives "saved" before AI runs (spec §8).
  async create(userId: string, dto: CreateMemoryDto) {
    const existing = await this.prisma.memory.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
    });
    if (existing) {
      this.assertOwnership(existing.userId, userId);
      return existing;
    }

    const memory = await this.prisma.memory.create({
      data: {
        userId,
        sourceType: dto.sourceType,
        sourceUri: dto.sourceUri,
        title: dto.title,
        idempotencyKey: dto.idempotencyKey,
        processingState: 'queued',
        lifecycleState: 'active',
      },
    });

    // Capture success is independent of AI success (BR-001, FR-CAP-003):
    // enqueue is fire-and-forget from the caller's perspective.
    // For image/camera/screenshot sourceTypes, defer enqueue until asset is uploaded
    // (assets.service.ts's completeUpload will trigger it). For text/url sources,
    // enqueue immediately since no asset upload is required.
    const requiresAsset = ['image', 'camera', 'screenshot'].includes(memory.sourceType);
    if (!requiresAsset) {
      await this.aiQueue.enqueueUnderstanding(memory.id);
    }

    return memory;
  }

  async findAllForUser(userId: string) {
    const memories = await this.prisma.memory.findMany({
      where: {
        userId,
        lifecycleState: { notIn: ['deleted', 'deleted_pending'] },
        securityScope: { not: 'vault' },
      },
      include: {
        assets: true,
        aiInferences: {
          where: {
            field: { in: ['date', 'location', 'price', 'category'] },
          },
        },
      },
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
    if (memory.securityScope === 'vault') {
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
    if (memory.securityScope === 'vault') {
      throw new NotFoundException('Memory not found');
    }
    return memory;
  }

  async reprocessMemory(userId: string, id: string) {
    const memory = await this.prisma.memory.findUnique({
      where: { id },
      select: { id: true, userId: true, securityScope: true },
    });
    if (!memory) throw new NotFoundException('Memory not found');
    this.assertOwnership(memory.userId, userId);
    if (memory.securityScope === 'vault') {
      throw new NotFoundException('Memory not found');
    }

    await this.aiQueue.enqueueUnderstanding(memory.id);
    return { id: memory.id, processingState: 'queued' };
  }

  async confirmField(userId: string, memoryId: string, field: string, confirmedValue: any) {
    const memory = await this.prisma.memory.findUnique({
      where: { id: memoryId },
      select: { id: true, userId: true, securityScope: true },
    });
    if (!memory) throw new NotFoundException('Memory not found');
    this.assertOwnership(memory.userId, userId);
    if (memory.securityScope === 'vault') {
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

  async summarizeMemory(userId: string, memoryId: string): Promise<string> {
    const memory = await this.prisma.memory.findUnique({
      where: { id: memoryId },
      select: { id: true, userId: true, title: true, sourceUri: true, securityScope: true },
    });
    if (!memory) throw new NotFoundException('Memory not found');
    this.assertOwnership(memory.userId, userId);
    if (memory.securityScope === 'vault') {
      throw new NotFoundException('Memory not found');
    }

    const text = memory.title || memory.sourceUri || '(no content)';
    const apiKey = this.config.getOrThrow('ANTHROPIC_API_KEY');
    const provider = new AnthropicAiProvider(apiKey);
    return provider.summarize({ text, sourceUri: memory.sourceUri ?? undefined });
  }

  async extractKeyPoints(userId: string, memoryId: string): Promise<string[]> {
    const memory = await this.prisma.memory.findUnique({
      where: { id: memoryId },
      select: { id: true, userId: true, title: true, sourceUri: true, securityScope: true },
    });
    if (!memory) throw new NotFoundException('Memory not found');
    this.assertOwnership(memory.userId, userId);
    if (memory.securityScope === 'vault') {
      throw new NotFoundException('Memory not found');
    }

    const text = memory.title || memory.sourceUri || '(no content)';
    const apiKey = this.config.getOrThrow('ANTHROPIC_API_KEY');
    const provider = new AnthropicAiProvider(apiKey);
    return provider.extractKeyPoints({ text, sourceUri: memory.sourceUri ?? undefined });
  }

  private assertOwnership(ownerId: string, requestingUserId: string) {
    // Server-side authorization on every access (spec §18, FR-SEC-001) —
    // never rely on the client to only ask for its own data.
    if (ownerId !== requestingUserId) {
      throw new ForbiddenException('You do not have access to this Memory');
    }
  }
}
