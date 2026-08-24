import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class VaultService {
  constructor(private readonly prisma: PrismaService) {}

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
    return this.prisma.memory.findMany({
      where: {
        userId,
        lifecycleState: { not: 'deleted' },
        securityScope: 'vault',
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
    if (memory.securityScope !== 'vault') {
      throw new NotFoundException('Memory not found');
    }
    return memory;
  }

  private assertOwnership(ownerId: string, requestingUserId: string) {
    if (ownerId !== requestingUserId) {
      throw new ForbiddenException('You do not have access to this Memory');
    }
  }
}
