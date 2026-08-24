import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateReminderDto } from './dto/create-reminder.dto';

@Injectable()
export class RemindersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateReminderDto) {
    // Check memory exists and is owned by user
    const memory = await this.prisma.memory.findUnique({
      where: { id: dto.memoryId },
      select: { id: true, userId: true, securityScope: true },
    });
    if (!memory) throw new NotFoundException('Memory not found');
    this.assertOwnership(memory.userId, userId);

    // Reject vault-scoped memories
    if (memory.securityScope === 'vault') {
      throw new BadRequestException(
        'Vault content cannot have a Reminder',
      );
    }

    return this.prisma.reminder.create({
      data: {
        userId,
        memoryId: dto.memoryId,
        note: dto.note,
        remindAt: new Date(dto.remindAt),
      },
    });
  }

  async findAllForUser(userId: string, status?: string) {
    return this.prisma.reminder.findMany({
      where: {
        userId,
        ...(status ? { status } : {}),
      },
      orderBy: { remindAt: 'asc' },
    });
  }

  async updateStatus(userId: string, id: string, status: string) {
    const reminder = await this.prisma.reminder.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });
    if (!reminder) throw new NotFoundException('Reminder not found');
    this.assertOwnership(reminder.userId, userId);

    return this.prisma.reminder.update({
      where: { id },
      data: { status },
    });
  }

  async delete(userId: string, id: string) {
    const reminder = await this.prisma.reminder.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });
    if (!reminder) throw new NotFoundException('Reminder not found');
    this.assertOwnership(reminder.userId, userId);

    return this.prisma.reminder.delete({
      where: { id },
    });
  }

  async markDueReminders() {
    const now = new Date();
    const updated = await this.prisma.reminder.updateMany({
      where: {
        status: 'pending',
        remindAt: {
          lte: now,
        },
      },
      data: { status: 'due' },
    });
    return updated.count;
  }

  private assertOwnership(ownerId: string, requestingUserId: string) {
    if (ownerId !== requestingUserId) {
      throw new ForbiddenException(
        'You do not have access to this Reminder',
      );
    }
  }
}
