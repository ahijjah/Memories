import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AiQueueService } from '../ai/ai-queue.service';
import { CreateMemoryDto } from './dto/create-memory.dto';

@Injectable()
export class MemoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiQueue: AiQueueService,
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
    await this.aiQueue.enqueueUnderstanding(memory.id);

    return memory;
  }

  async findAllForUser(userId: string) {
    return this.prisma.memory.findMany({
      where: {
        userId,
        lifecycleState: { not: 'deleted' },
        securityScope: { not: 'vault' },
      },
      orderBy: { capturedAt: 'desc' },
    });
  }

  async findOneForUser(userId: string, id: string) {
    const memory = await this.prisma.memory.findUnique({
      where: { id },
      include: { assets: true, aiInferences: true, userConfirmations: true },
    });
    if (!memory) throw new NotFoundException('Memory not found');
    this.assertOwnership(memory.userId, userId);
    return memory;
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

  private assertOwnership(ownerId: string, requestingUserId: string) {
    // Server-side authorization on every access (spec §18, FR-SEC-001) —
    // never rely on the client to only ask for its own data.
    if (ownerId !== requestingUserId) {
      throw new ForbiddenException('You do not have access to this Memory');
    }
  }
}
