import { Test, TestingModule } from '@nestjs/testing';
import { RemindersService } from './reminders.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

describe('RemindersService', () => {
  let service: RemindersService;
  let prismaService: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RemindersService,
        {
          provide: PrismaService,
          useValue: {
            reminder: {
              create: jest.fn(),
              findUnique: jest.fn(),
              findMany: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
              updateMany: jest.fn(),
            },
            memory: {
              findUnique: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<RemindersService>(RemindersService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a reminder for an owned Memory', async () => {
      const userId = 'user-123';
      const memoryId = 'mem-1';
      const remindAt = new Date();
      const mockMemory = { id: memoryId, userId, securityScope: 'private' };
      const mockReminder = {
        id: 'rem-1',
        userId,
        memoryId,
        note: 'Test note',
        remindAt,
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest.spyOn(prismaService.memory, 'findUnique').mockResolvedValue(mockMemory as any);
      jest.spyOn(prismaService.reminder, 'create').mockResolvedValue(mockReminder as any);

      const result = await service.create(userId, {
        memoryId,
        note: 'Test note',
        remindAt: remindAt.toISOString(),
      });

      expect(prismaService.memory.findUnique).toHaveBeenCalledWith({
        where: { id: memoryId },
        select: { id: true, userId: true, securityScope: true },
      });
      expect(prismaService.reminder.create).toHaveBeenCalledWith({
        data: {
          userId,
          memoryId,
          note: 'Test note',
          remindAt: expect.any(Date),
        },
      });
      expect(result.id).toBe('rem-1');
    });

    it('should throw BadRequestException when creating reminder for vault-scoped Memory', async () => {
      const userId = 'user-123';
      const memoryId = 'mem-1';
      const remindAt = new Date();
      const mockMemory = { id: memoryId, userId, securityScope: 'vault' };

      jest.spyOn(prismaService.memory, 'findUnique').mockResolvedValue(mockMemory as any);

      await expect(
        service.create(userId, {
          memoryId,
          remindAt: remindAt.toISOString(),
        }),
      ).rejects.toThrow(BadRequestException);

      expect(
        await service.create(userId, {
          memoryId,
          remindAt: remindAt.toISOString(),
        }).catch((e) => e.message),
      ).toContain('Vault content cannot have a Reminder');
    });

    it('should throw ForbiddenException when creating reminder for someone else\'s Memory', async () => {
      const userId = 'user-123';
      const otherUserId = 'user-456';
      const memoryId = 'mem-1';
      const remindAt = new Date();
      const mockMemory = { id: memoryId, userId: otherUserId, securityScope: 'private' };

      jest.spyOn(prismaService.memory, 'findUnique').mockResolvedValue(mockMemory as any);

      await expect(
        service.create(userId, {
          memoryId,
          remindAt: remindAt.toISOString(),
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when Memory doesn\'t exist', async () => {
      const userId = 'user-123';
      const memoryId = 'mem-1';
      const remindAt = new Date();

      jest.spyOn(prismaService.memory, 'findUnique').mockResolvedValue(null);

      await expect(
        service.create(userId, {
          memoryId,
          remindAt: remindAt.toISOString(),
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAllForUser', () => {
    it('should list only the requesting user\'s reminders', async () => {
      const userId = 'user-123';
      const mockReminders = [
        { id: 'rem-1', userId, status: 'pending' },
        { id: 'rem-2', userId, status: 'due' },
      ];

      jest.spyOn(prismaService.reminder, 'findMany').mockResolvedValue(mockReminders as any);

      const result = await service.findAllForUser(userId);

      expect(prismaService.reminder.findMany).toHaveBeenCalledWith({
        where: { userId },
        orderBy: { remindAt: 'asc' },
      });
      expect(result).toEqual(mockReminders);
    });

    it('should filter by status when provided', async () => {
      const userId = 'user-123';
      const status = 'pending';
      const mockReminders = [{ id: 'rem-1', userId, status }];

      jest.spyOn(prismaService.reminder, 'findMany').mockResolvedValue(mockReminders as any);

      const result = await service.findAllForUser(userId, status);

      expect(prismaService.reminder.findMany).toHaveBeenCalledWith({
        where: { userId, status },
        orderBy: { remindAt: 'asc' },
      });
      expect(result).toEqual(mockReminders);
    });

    it('should regression-test that userId is in WHERE clause', async () => {
      const userId = 'user-123';
      const mockReminders = [{ id: 'rem-1', userId }];

      jest.spyOn(prismaService.reminder, 'findMany').mockResolvedValue(mockReminders as any);

      await service.findAllForUser(userId);

      const callArgs = (prismaService.reminder.findMany as jest.Mock).mock.calls[0][0];
      expect(callArgs.where.userId).toBe(userId);
    });
  });

  describe('updateStatus', () => {
    it('should update status for owned reminder', async () => {
      const userId = 'user-123';
      const reminderId = 'rem-1';
      const mockReminder = { id: reminderId, userId };
      const updated = { ...mockReminder, status: 'dismissed' };

      jest.spyOn(prismaService.reminder, 'findUnique').mockResolvedValue(mockReminder as any);
      jest.spyOn(prismaService.reminder, 'update').mockResolvedValue(updated as any);

      const result = await service.updateStatus(userId, reminderId, 'dismissed');

      expect(result.status).toBe('dismissed');
    });

    it('should throw ForbiddenException for another user\'s reminder', async () => {
      const userId = 'user-123';
      const otherUserId = 'user-456';
      const reminderId = 'rem-1';
      const mockReminder = { id: reminderId, userId: otherUserId };

      jest.spyOn(prismaService.reminder, 'findUnique').mockResolvedValue(mockReminder as any);

      await expect(
        service.updateStatus(userId, reminderId, 'dismissed'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('delete', () => {
    it('should delete owned reminder', async () => {
      const userId = 'user-123';
      const reminderId = 'rem-1';
      const mockReminder = { id: reminderId, userId };

      jest.spyOn(prismaService.reminder, 'findUnique').mockResolvedValue(mockReminder as any);
      jest.spyOn(prismaService.reminder, 'delete').mockResolvedValue(mockReminder as any);

      const result = await service.delete(userId, reminderId);

      expect(result.id).toBe(reminderId);
    });

    it('should throw ForbiddenException for another user\'s reminder', async () => {
      const userId = 'user-123';
      const otherUserId = 'user-456';
      const reminderId = 'rem-1';
      const mockReminder = { id: reminderId, userId: otherUserId };

      jest.spyOn(prismaService.reminder, 'findUnique').mockResolvedValue(mockReminder as any);

      await expect(
        service.delete(userId, reminderId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('markDueReminders', () => {
    it('should update pending reminders with remindAt <= now to due status', async () => {
      jest.spyOn(prismaService.reminder, 'updateMany').mockResolvedValue({ count: 3 });

      const count = await service.markDueReminders();

      expect(count).toBe(3);
      expect(prismaService.reminder.updateMany).toHaveBeenCalledWith({
        where: {
          status: 'pending',
          remindAt: {
            lte: expect.any(Date),
          },
        },
        data: { status: 'due' },
      });
    });
  });
});
