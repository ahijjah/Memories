import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AnthropicAiProvider } from '@memory-app/ai';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FieldEncryptionService } from '../../common/crypto/field-encryption.service';
import { isSensitiveField } from '../../common/crypto/sensitive-fields';
import { toVectorLiteral } from '../../common/pgvector.util';
import { LATEST_AI_INFERENCE_ORDER, resolveMemoryField } from '../../common/resolve-memory-field.util';
import { resolveTitleFromFields } from '../../common/resolve-title.util';
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
        latitude: dto.latitude,
        longitude: dto.longitude,
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
          orderBy: LATEST_AI_INFERENCE_ORDER,
        },
      },
      orderBy: { capturedAt: 'desc' },
    });
    return Promise.all(memories.map((m: any) => this.enrichWithAssetUrls(m)));
  }

  async findOneForUser(userId: string, id: string) {
    const memory = await this.prisma.memory.findUnique({
      where: { id },
      include: {
        assets: true,
        aiInferences: { orderBy: LATEST_AI_INFERENCE_ORDER },
        userConfirmations: true,
      },
    });
    if (!memory) throw new NotFoundException('Memory not found');
    this.assertOwnership(memory.userId, userId);
    if (memory.securityScope === 'vault') {
      throw new NotFoundException('Memory not found');
    }

    // Track view for non-vault memories only
    try {
      await this.prisma.memory.update({
        where: { id },
        data: {
          viewCount: { increment: 1 },
          lastViewedAt: new Date(),
        },
      });
    } catch (err) {
      // Non-fatal: a view tracking failure should not break the actual view request
      console.warn(`Failed to track view for memory ${id}: ${(err as Error).message}`);
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

  private enrichWithAssetUrls(memory: any) {
    if (!memory.assets || memory.assets.length === 0) {
      return memory;
    }
    const enrichedAssets = memory.assets.map((asset: any) => ({
      ...asset,
      url: `/assets/${asset.id}/content`,
    }));
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
      include: {
        aiInferences: {
          where: { field: 'summary' },
          select: { valueJson: true },
          take: 1,
        },
      },
    });
    if (!memory) throw new NotFoundException('Memory not found');
    this.assertOwnership(memory.userId, userId);
    if (memory.securityScope === 'vault') {
      throw new NotFoundException('Memory not found');
    }

    // Build text from existing AI-extracted summary + title (summary is a string)
    const summaryInference = memory.aiInferences?.[0];
    const summaryText = typeof summaryInference?.valueJson === 'string' ? summaryInference.valueJson : null;
    const parts: string[] = [];
    if (memory.title) parts.push(memory.title);
    if (summaryText) parts.push(summaryText);
    const text = parts.length > 0 ? parts.join('\n\n') : memory.sourceUri || '(no content)';

    const apiKey = this.config.getOrThrow('ANTHROPIC_API_KEY');
    const provider = new AnthropicAiProvider(apiKey);
    return provider.summarize({ text, sourceUri: memory.sourceUri ?? undefined });
  }

  async extractKeyPoints(userId: string, memoryId: string): Promise<string[]> {
    const memory = await this.prisma.memory.findUnique({
      where: { id: memoryId },
      include: {
        aiInferences: {
          where: { field: 'summary' },
          select: { valueJson: true },
          take: 1,
        },
      },
    });
    if (!memory) throw new NotFoundException('Memory not found');
    this.assertOwnership(memory.userId, userId);
    if (memory.securityScope === 'vault') {
      throw new NotFoundException('Memory not found');
    }

    // Build text from existing AI-extracted summary + title (summary is a string)
    const summaryInference = memory.aiInferences?.[0];
    const summaryText = typeof summaryInference?.valueJson === 'string' ? summaryInference.valueJson : null;
    const parts: string[] = [];
    if (memory.title) parts.push(memory.title);
    if (summaryText) parts.push(summaryText);
    const text = parts.length > 0 ? parts.join('\n\n') : memory.sourceUri || '(no content)';

    const apiKey = this.config.getOrThrow('ANTHROPIC_API_KEY');
    const provider = new AnthropicAiProvider(apiKey);
    return provider.extractKeyPoints({ text, sourceUri: memory.sourceUri ?? undefined });
  }

  async compareMemories(userId: string, memoryIds: string[]) {
    if (memoryIds.length < 2 || memoryIds.length > 5) {
      throw new BadRequestException('Must compare between 2 and 5 memories');
    }

    type MemoryWithConfirmations = Prisma.MemoryGetPayload<{
      include: {
        aiInferences: true;
        userConfirmations: true;
      };
    }>;

    // Fetch all memories with their inferences and confirmations
    const fetchedMemories = await Promise.all(
      memoryIds.map(id =>
        this.prisma.memory.findUnique({
          where: { id },
          include: {
            aiInferences: {
              where: {
                field: { in: ['brand', 'model', 'price', 'category', 'summary'] },
              },
            },
            userConfirmations: {
              where: {
                field: { in: ['brand', 'model', 'price', 'category', 'summary'] },
              },
            },
          },
        })
      )
    );

    // Validate ownership and vault scope, filter out nulls
    const memories = fetchedMemories.filter((m): m is MemoryWithConfirmations => {
      if (!m) throw new NotFoundException('Memory not found');
      this.assertOwnership(m.userId, userId);
      if (m.securityScope === 'vault') {
        throw new BadRequestException('Vault content cannot be compared');
      }
      return true;
    });

    // Extract product data for comparison
    const products = memories.map(memory => {
      const getFieldValue = (field: string): string | undefined => {
        const resolved = resolveMemoryField(field, {
          aiInferences: memory.aiInferences,
          userConfirmations: memory.userConfirmations,
        });
        return resolved.value === null ? undefined : String(resolved.value);
      };

      const summary = getFieldValue('summary');
      return {
        title: memory.title || '(untitled)',
        brand: getFieldValue('brand'),
        model: getFieldValue('model'),
        price: getFieldValue('price'),
        category: getFieldValue('category'),
        summary: summary && typeof summary === 'string' ? summary : undefined,
      };
    });

    const apiKey = this.config.getOrThrow('ANTHROPIC_API_KEY');
    const provider = new AnthropicAiProvider(apiKey);
    return provider.compareProducts({ products });
  }

  async findRelatedForUser(userId: string, sourceMemoryId: string, limit: number = 5) {
    // Fetch source memory to verify ownership, existence, and scope
    const sourceMemory = await this.prisma.memory.findUnique({
      where: { id: sourceMemoryId },
      include: {
        assets: true,
        aiInferences: true,
        userConfirmations: true,
      },
    });

    if (!sourceMemory) throw new NotFoundException('Memory not found');
    this.assertOwnership(sourceMemory.userId, userId);

    // Reject deleted/deleted_pending source memories (consistent with Memory read semantics)
    if (['deleted', 'deleted_pending'].includes(sourceMemory.lifecycleState)) {
      throw new NotFoundException('Memory not found');
    }

    // Fetch source memory's embedding using raw query (vector is Unsupported type)
    interface EmbeddingRow {
      vector: any;
    }
    const sourceEmbeddingRows = await this.prisma.$queryRaw<EmbeddingRow[]>`
      SELECT "vector" FROM "embeddings" WHERE "memoryId" = ${sourceMemoryId}
    `;

    // If source has no embedding, return empty results
    if (!sourceEmbeddingRows || sourceEmbeddingRows.length === 0) {
      return [];
    }

    const vectorLiteral = toVectorLiteral(sourceEmbeddingRows[0].vector as number[]);
    const MAX_DISTANCE_THRESHOLD = 0.5;

    // Query similar memories using pgvector cosine distance
    // Exclude: source itself, different users, vault (if source is private),
    // private (if source is vault), deleted/deleted_pending
    interface RawRelatedResult {
      id: string;
      title: string;
      memoryType: string;
      capturedAt: Date;
      securityScope: string;
      distance: number;
    }

    const rawResults = await this.prisma.$queryRaw<RawRelatedResult[]>`
      SELECT
        m."id",
        m."title",
        m."memoryType",
        m."capturedAt",
        m."securityScope",
        e."vector" <=> ${vectorLiteral}::"vector"(1024) AS "distance"
      FROM "embeddings" e
      JOIN "memories" m ON e."memoryId" = m."id"
      WHERE
        m."userId" = ${userId}
        AND m."id" != ${sourceMemoryId}
        AND m."lifecycleState" NOT IN ('deleted', 'deleted_pending')
        AND m."securityScope" = ${sourceMemory.securityScope}
        AND e."vector" <=> ${vectorLiteral}::"vector"(1024) < ${MAX_DISTANCE_THRESHOLD}
      ORDER BY "distance" ASC, m."id" ASC
      LIMIT ${limit}
    `;

    // Fetch title inferences and confirmations for title resolution
    const memoryIds = rawResults.map((r: RawRelatedResult) => r.id);
    const titleInferences = memoryIds.length > 0
      ? await this.prisma.aIInference.findMany({
          where: {
            memoryId: { in: memoryIds },
            field: 'title',
          },
        })
      : [];

    const titleConfirmations = memoryIds.length > 0
      ? await this.prisma.userConfirmation.findMany({
          where: {
            memoryId: { in: memoryIds },
            field: 'title',
          },
        })
      : [];

    // Fetch assets for all related memories
    const relatedMemories = memoryIds.length > 0
      ? await this.prisma.memory.findMany({
          where: { id: { in: memoryIds } },
          include: { assets: true },
        })
      : [];

    // Build result set with title resolution and asset URL enrichment
    const results = rawResults.map((result: RawRelatedResult) => {
      const inferences = titleInferences.filter((inf) => inf.memoryId === result.id);
      const confirmations = titleConfirmations.filter((conf) => conf.memoryId === result.id);
      const resolvedTitle = resolveTitleFromFields(
        result.title,
        inferences,
        confirmations,
      );

      const relatedMemory = relatedMemories.find((m) => m.id === result.id);
      const enrichedAssets = relatedMemory?.assets.map((asset) => ({
        id: asset.id,
        mimeType: asset.mimeType,
        variant: asset.variant,
        url: `/assets/${asset.id}/content`,
      })) || [];

      return {
        id: result.id,
        title: resolvedTitle,
        memoryType: result.memoryType,
        capturedAt: result.capturedAt,
        securityScope: result.securityScope,
        similarity: 1 - (result.distance as unknown as number),
        assets: enrichedAssets,
      };
    });

    return results;
  }

  private assertOwnership(ownerId: string, requestingUserId: string) {
    // Server-side authorization on every access (spec §18, FR-SEC-001) —
    // never rely on the client to only ask for its own data.
    if (ownerId !== requestingUserId) {
      throw new ForbiddenException('You do not have access to this Memory');
    }
  }
}
