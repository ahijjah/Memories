import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { MemoryService } from './memory.service';
import { CreateMemoryDto } from './dto/create-memory.dto';

@ApiTags('memory')
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller('memories')
export class MemoryController {
  constructor(private readonly memoryService: MemoryService) {}

  @Post()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateMemoryDto) {
    return this.memoryService.create(user.sub, dto);
  }

  @Get()
  async findAll(@CurrentUser() user: CurrentUserPayload) {
    return this.memoryService.findAllForUser(user.sub);
  }

  @Get(':id')
  async findOne(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.memoryService.findOneForUser(user.sub, id);
  }

  @Get(':id/processing-status')
  async processingStatus(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.memoryService.getProcessingStatus(user.sub, id);
  }
}
