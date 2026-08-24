import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { VaultService } from './vault.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';

@Controller('vault')
@UseGuards(ClerkAuthGuard)
export class VaultController {
  constructor(private readonly vaultService: VaultService) {}

  @Post(':memoryId/lock')
  async lock(
    @CurrentUser() user: CurrentUserPayload,
    @Param('memoryId') memoryId: string,
  ) {
    return this.vaultService.lock(user.sub, memoryId);
  }

  @Post(':memoryId/unlock')
  async unlock(
    @CurrentUser() user: CurrentUserPayload,
    @Param('memoryId') memoryId: string,
  ) {
    return this.vaultService.unlock(user.sub, memoryId);
  }

  @Get()
  async list(@CurrentUser() user: CurrentUserPayload) {
    return this.vaultService.findAllForUser(user.sub);
  }

  @Get(':memoryId')
  async detail(
    @CurrentUser() user: CurrentUserPayload,
    @Param('memoryId') memoryId: string,
  ) {
    return this.vaultService.findOneForUser(user.sub, memoryId);
  }
}
