import { Controller, Get, HttpStatus, HttpException } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async check() {
    const result = await this.healthService.check();
    const allHealthy = result.checks.database && result.checks.redis;

    if (!allHealthy) {
      throw new HttpException(
        result,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return result;
  }
}
