import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AssetsService } from './assets.service';
import { CompleteUploadDto, CreateUploadDto } from './dto/asset.dto';

@ApiTags('assets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
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
