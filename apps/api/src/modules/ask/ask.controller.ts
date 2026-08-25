import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AskService, AskResponse } from './ask.service';
import { AskQueryDto } from './dto/ask-query.dto';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';

@Controller('ask')
@UseGuards(ClerkAuthGuard)
export class AskController {
  constructor(private readonly askService: AskService) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async ask(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: AskQueryDto,
  ): Promise<AskResponse> {
    return this.askService.ask(user.sub, dto.question);
  }
}
