import { Controller, Delete, Get, Param, Post, UseGuards, Body } from '@nestjs/common';
import { VaultService } from './vault.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { ConfirmFieldDto } from '../memory/dto/confirm-field.dto';

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

  @Get(':memoryId/processing-status')
  async processingStatus(
    @CurrentUser() user: CurrentUserPayload,
    @Param('memoryId') memoryId: string,
  ) {
    return this.vaultService.getProcessingStatus(user.sub, memoryId);
  }

  @Delete(':memoryId')
  async delete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('memoryId') memoryId: string,
  ) {
    return this.vaultService.deleteMemory(user.sub, memoryId);
  }

  @Post(':memoryId/restore')
  async restore(
    @CurrentUser() user: CurrentUserPayload,
    @Param('memoryId') memoryId: string,
  ) {
    return this.vaultService.restoreMemory(user.sub, memoryId);
  }

  @Post(':memoryId/confirm')
  async confirmField(
    @CurrentUser() user: CurrentUserPayload,
    @Param('memoryId') memoryId: string,
    @Body() dto: ConfirmFieldDto,
  ) {
    return this.vaultService.confirmField(user.sub, memoryId, dto.field, dto.confirmedValue);
  }
}
