import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreatePersonDto } from './dto/create-person.dto';

@Injectable()
export class PersonService {
  constructor(private readonly prisma: PrismaService) {}

  async listPeople(userId: string) {
    return this.prisma.person.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createPerson(userId: string, dto: CreatePersonDto) {
    return this.prisma.person.create({
      data: {
        userId,
        name: dto.name,
        relationship: dto.relationship,
      },
    });
  }

  async deletePerson(userId: string, personId: string) {
    const person = await this.prisma.person.findUnique({
      where: { id: personId },
    });
    if (!person) throw new NotFoundException('Person not found');
    if (person.userId !== userId) {
      throw new ForbiddenException('You do not have access to this Person');
    }
    return this.prisma.person.delete({
      where: { id: personId },
    });
  }

  async assignPersonToMemory(userId: string, personId: string, memoryId: string) {
    const person = await this.prisma.person.findUnique({
      where: { id: personId },
    });
    if (!person) throw new NotFoundException('Person not found');
    if (person.userId !== userId) {
      throw new ForbiddenException('You do not have access to this Person');
    }

    const memory = await this.prisma.memory.findUnique({
      where: { id: memoryId },
    });
    if (!memory) throw new NotFoundException('Memory not found');
    if (memory.userId !== userId) {
      throw new ForbiddenException('You do not have access to this Memory');
    }

    return this.prisma.memory.update({
      where: { id: memoryId },
      data: { personId },
    });
  }

  async unassignPersonFromMemory(userId: string, personId: string, memoryId: string) {
    const person = await this.prisma.person.findUnique({
      where: { id: personId },
    });
    if (!person) throw new NotFoundException('Person not found');
    if (person.userId !== userId) {
      throw new ForbiddenException('You do not have access to this Person');
    }

    const memory = await this.prisma.memory.findUnique({
      where: { id: memoryId },
    });
    if (!memory) throw new NotFoundException('Memory not found');
    if (memory.userId !== userId) {
      throw new ForbiddenException('You do not have access to this Memory');
    }
    if (memory.personId !== personId) {
      throw new NotFoundException('This Person is not assigned to this Memory');
    }

    return this.prisma.memory.update({
      where: { id: memoryId },
      data: { personId: null },
    });
  }
}
