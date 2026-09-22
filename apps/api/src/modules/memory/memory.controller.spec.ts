import { Test } from '@nestjs/testing';
import { CanActivate } from '@nestjs/common';
import { MemoryController } from './memory.controller';
import { MemoryService } from './memory.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';

const mockAuthGuard: CanActivate = {
  canActivate: jest.fn(() => true),
};

describe('MemoryController - P2.1 Related Memories', () => {
  let controller: MemoryController;
  const memoryServiceMock = {
    findRelatedForUser: jest.fn(),
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MemoryController],
      providers: [{ provide: MemoryService, useValue: memoryServiceMock }],
    })
      .overrideGuard(ClerkAuthGuard)
      .useValue(mockAuthGuard)
      .compile();

    controller = moduleRef.get(MemoryController);
  });

  describe('GET /memories/:id/related', () => {
    it('calls findRelatedForUser with default limit 5', async () => {
      const mockResults = [{ id: 'mem-2', title: 'Related', similarity: 0.8, assets: [] }];
      memoryServiceMock.findRelatedForUser.mockResolvedValueOnce(mockResults);

      const result = await controller.findRelated(
        { sub: 'user-1', email: 'user@test.com' },
        'mem-1',
        undefined,
      );

      expect(memoryServiceMock.findRelatedForUser).toHaveBeenCalledWith('user-1', 'mem-1', 5);
      expect(result).toEqual(mockResults);
    });

    it('parses limit query parameter and clamps to maximum 10', async () => {
      const mockResults: any[] = [];
      memoryServiceMock.findRelatedForUser.mockResolvedValueOnce(mockResults);

      await controller.findRelated({ sub: 'user-1', email: 'user@test.com' }, 'mem-1', '15');

      expect(memoryServiceMock.findRelatedForUser).toHaveBeenCalledWith('user-1', 'mem-1', 10);
    });

    it('accepts valid limit within range', async () => {
      const mockResults: any[] = [];
      memoryServiceMock.findRelatedForUser.mockResolvedValueOnce(mockResults);

      await controller.findRelated({ sub: 'user-1', email: 'user@test.com' }, 'mem-1', '7');

      expect(memoryServiceMock.findRelatedForUser).toHaveBeenCalledWith('user-1', 'mem-1', 7);
    });

    it('handles NaN limit by defaulting to 5', async () => {
      const mockResults: any[] = [];
      memoryServiceMock.findRelatedForUser.mockResolvedValueOnce(mockResults);

      await controller.findRelated({ sub: 'user-1', email: 'user@test.com' }, 'mem-1', 'invalid');

      expect(memoryServiceMock.findRelatedForUser).toHaveBeenCalledWith('user-1', 'mem-1', 5);
    });

    it('handles limit < 1 by defaulting to 5', async () => {
      const mockResults: any[] = [];
      memoryServiceMock.findRelatedForUser.mockResolvedValueOnce(mockResults);

      await controller.findRelated({ sub: 'user-1', email: 'user@test.com' }, 'mem-1', '0');

      expect(memoryServiceMock.findRelatedForUser).toHaveBeenCalledWith('user-1', 'mem-1', 5);
    });

    it('extracts userId from @CurrentUser() decorator', async () => {
      const mockResults: any[] = [];
      memoryServiceMock.findRelatedForUser.mockResolvedValueOnce(mockResults);

      await controller.findRelated({ sub: 'authenticated-user-id', email: 'auth@test.com' }, 'mem-1', '5');

      expect(memoryServiceMock.findRelatedForUser).toHaveBeenCalledWith(
        'authenticated-user-id',
        'mem-1',
        5,
      );
    });
  });
});
