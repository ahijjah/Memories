import { Controller, Get, UseGuards } from '@nestjs/common';
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
}
