import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { AssetsService } from './assets.service';
import { CompleteUploadDto, CreateUploadDto } from './dto/asset.dto';

@ApiTags('assets')
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller('assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Post('create-upload')
  async createUpload(@Body() dto: CreateUploadDto) {
    return this.assetsService.createUploadTarget(dto.memoryId, dto.mimeType);
  }

  @Post('complete-upload')
  async completeUpload(@Body() dto: CompleteUploadDto) {
    return this.assetsService.completeUpload(
      dto.memoryId,
      dto.objectKey,
      dto.mimeType,
      dto.checksum,
    );
  }
}
