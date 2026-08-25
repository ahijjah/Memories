import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  let controller: HealthController;
  let service: HealthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthService,
          useValue: {
            check: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    service = module.get<HealthService>(HealthService);
  });

  it('should return ok status when all checks pass', async () => {
    const expected = {
      status: 'ok',
      checks: { database: true, redis: true },
    };
    (service.check as jest.Mock).mockResolvedValue(expected);

    const result = await controller.check();

    expect(result).toEqual(expected);
  });

  it('should return degraded status and 503 when database check fails', async () => {
    const response = {
      status: 'degraded',
      checks: { database: false, redis: true },
    };
    (service.check as jest.Mock).mockResolvedValue(response);

    try {
      await controller.check();
      fail('Should have thrown HttpException');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect(err.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    }
  });

  it('should return degraded status and 503 when redis check fails', async () => {
    const response = {
      status: 'degraded',
      checks: { database: true, redis: false },
    };
    (service.check as jest.Mock).mockResolvedValue(response);

    try {
      await controller.check();
      fail('Should have thrown HttpException');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect(err.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    }
  });
});
