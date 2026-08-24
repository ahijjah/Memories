import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { CollectionsService } from './collections.service';
import { CreateCollectionDto } from './dto/create-collection.dto';

@Controller('collections')
@UseGuards(ClerkAuthGuard)
export class CollectionsController {
  constructor(private readonly collectionsService: CollectionsService) {}

  @Post()
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateCollectionDto) {
    return this.collectionsService.create(user.sub, dto);
  }

  @Get()
  findAll(@CurrentUser() user: CurrentUserPayload) {
    return this.collectionsService.findAllForUser(user.sub);
  }

  @Get(':id')
  findOne(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.collectionsService.findOneForUser(user.sub, id);
  }

  @Delete(':id')
  delete(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.collectionsService.delete(user.sub, id);
  }

  @Post(':id/memories/:memoryId')
  addMemory(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Param('memoryId') memoryId: string,
  ) {
    return this.collectionsService.addMemory(user.sub, id, memoryId);
  }

  @Delete(':id/memories/:memoryId')
  removeMemory(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Param('memoryId') memoryId: string,
  ) {
    return this.collectionsService.removeMemory(user.sub, id, memoryId);
  }
}
