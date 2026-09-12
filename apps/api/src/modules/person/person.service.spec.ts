import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PersonService } from './person.service';
import { PrismaService } from '../../common/prisma/prisma.service';

describe('PersonService', () => {
  let service: PersonService;
  const prismaMock = {
    person: {
      findMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    memory: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [PersonService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = moduleRef.get(PersonService);
  });

  it('lists people for a user', async () => {
    prismaMock.person.findMany.mockResolvedValue([
      { id: 'p1', userId: 'user-1', name: 'Mom', relationship: 'mother' },
    ]);

    const result = await service.listPeople('user-1');

    expect(prismaMock.person.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { createdAt: 'desc' },
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Mom');
  });

  it('creates a person for a user', async () => {
    prismaMock.person.create.mockResolvedValue({
      id: 'p1',
      userId: 'user-1',
      name: 'Mom',
      relationship: 'mother',
    });

    const result = await service.createPerson('user-1', { name: 'Mom', relationship: 'mother' });

    expect(prismaMock.person.create).toHaveBeenCalledWith({
      data: { userId: 'user-1', name: 'Mom', relationship: 'mother' },
    });
    expect(result.id).toBe('p1');
  });

  it('deletes a person (ownership check)', async () => {
    prismaMock.person.findUnique.mockResolvedValue({
      id: 'p1',
      userId: 'user-1',
      name: 'Mom',
    });
    prismaMock.person.delete.mockResolvedValue({ id: 'p1' });

    await service.deletePerson('user-1', 'p1');

    expect(prismaMock.person.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
  });

  it('rejects deleting another user\'s person (FR-SEC-001)', async () => {
    prismaMock.person.findUnique.mockResolvedValue({
      id: 'p1',
      userId: 'someone-else',
      name: 'Mom',
    });

    await expect(service.deletePerson('user-1', 'p1')).rejects.toThrow(ForbiddenException);
  });

  it('assigns person to memory (dual ownership check)', async () => {
    prismaMock.person.findUnique.mockResolvedValue({
      id: 'p1',
      userId: 'user-1',
      name: 'Mom',
    });
    prismaMock.memory.findUnique.mockResolvedValue({
      id: 'mem-1',
      userId: 'user-1',
      title: 'Family Photo',
    });
    prismaMock.memory.update.mockResolvedValue({
      id: 'mem-1',
      personId: 'p1',
    });

    await service.assignPersonToMemory('user-1', 'p1', 'mem-1');

    expect(prismaMock.memory.update).toHaveBeenCalledWith({
      where: { id: 'mem-1' },
      data: { personId: 'p1' },
    });
  });

  it('rejects assigning another user\'s person to your memory', async () => {
    prismaMock.person.findUnique.mockResolvedValue({
      id: 'p1',
      userId: 'someone-else',
      name: 'Mom',
    });

    await expect(service.assignPersonToMemory('user-1', 'p1', 'mem-1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects assigning your person to another user\'s memory', async () => {
    prismaMock.person.findUnique.mockResolvedValue({
      id: 'p1',
      userId: 'user-1',
      name: 'Mom',
    });
    prismaMock.memory.findUnique.mockResolvedValue({
      id: 'mem-1',
      userId: 'someone-else',
      title: 'Family Photo',
    });

    await expect(service.assignPersonToMemory('user-1', 'p1', 'mem-1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('unassigns person from memory', async () => {
    prismaMock.person.findUnique.mockResolvedValue({
      id: 'p1',
      userId: 'user-1',
      name: 'Mom',
    });
    prismaMock.memory.findUnique.mockResolvedValue({
      id: 'mem-1',
      userId: 'user-1',
      personId: 'p1',
      title: 'Family Photo',
    });
    prismaMock.memory.update.mockResolvedValue({
      id: 'mem-1',
      personId: null,
    });

    await service.unassignPersonFromMemory('user-1', 'p1', 'mem-1');

    expect(prismaMock.memory.update).toHaveBeenCalledWith({
      where: { id: 'mem-1' },
      data: { personId: null },
    });
  });

  it('rejects unassigning wrong person from memory', async () => {
    prismaMock.person.findUnique.mockResolvedValue({
      id: 'p1',
      userId: 'user-1',
      name: 'Mom',
    });
    prismaMock.memory.findUnique.mockResolvedValue({
      id: 'mem-1',
      userId: 'user-1',
      personId: 'p2', // different person
      title: 'Family Photo',
    });

    await expect(service.unassignPersonFromMemory('user-1', 'p1', 'mem-1')).rejects.toThrow(
      NotFoundException,
    );
  });
});
