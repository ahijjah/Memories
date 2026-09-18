import { Controller, Get, Post, UseGuards, Body, Param, Query, BadRequestException } from '@nestjs/common';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { EngagementService } from './engagement.service';

@Controller('engagement')
@UseGuards(ClerkAuthGuard)
export class EngagementController {
  constructor(private readonly engagementService: EngagementService) {}

  @Get('rediscover')
  rediscover(@CurrentUser() user: CurrentUserPayload) {
    return this.engagementService.getRediscoveryRandom(user.sub);
  }

  @Get('upcoming')
  upcoming(@CurrentUser() user: CurrentUserPayload) {
    return this.engagementService.getUpcoming(user.sub);
  }

  @Post('rediscover/:memoryId/feedback')
  recordRediscoveryFeedback(
    @CurrentUser() user: CurrentUserPayload,
    @Param('memoryId') memoryId: string,
    @Body() body: { feedback: string },
  ) {
    return this.engagementService.recordFeedback(user.sub, memoryId, body.feedback);
  }

  @Get('for-you')
  forYouSuggestions(@CurrentUser() user: CurrentUserPayload) {
    return this.engagementService.getForYouSuggestions(user.sub);
  }

  @Get('continue')
  continueSuggestions(@CurrentUser() user: CurrentUserPayload) {
    return this.engagementService.getContinueSuggestions(user.sub);
  }

  @Get('near-me')
  async nearMe(
    @CurrentUser() user: CurrentUserPayload,
    @Query('latitude') latitude?: string,
    @Query('longitude') longitude?: string,
    @Query('radiusKm') radiusKm?: string,
  ) {
    if (!latitude || !longitude) {
      throw new BadRequestException('latitude and longitude query parameters are required');
    }

    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);
    const radius = radiusKm ? parseFloat(radiusKm) : 5;

    if (isNaN(lat) || isNaN(lon) || isNaN(radius)) {
      throw new BadRequestException('latitude, longitude, and radiusKm must be valid numbers');
    }

    if (lat < -90 || lat > 90) {
      throw new BadRequestException('latitude must be between -90 and 90');
    }

    if (lon < -180 || lon > 180) {
      throw new BadRequestException('longitude must be between -180 and 180');
    }

    if (radius <= 0) {
      throw new BadRequestException('radiusKm must be greater than 0');
    }

    return this.engagementService.getNearMe(user.sub, lat, lon, radius);
  }
}
