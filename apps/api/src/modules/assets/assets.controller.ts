import { Body, Controller, Get, Logger, Param, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { AssetsService } from './assets.service';
import { CompleteUploadDto, CreateUploadDto } from './dto/asset.dto';

@ApiTags('assets')
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller('assets')
export class AssetsController {
  private readonly logger = new Logger(AssetsController.name);

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
      dto.pageIndex,
    );
  }

  @Get(':assetId/content')
  async getAssetContent(
    @Param('assetId') assetId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Res() res: Response,
  ) {
    const stream = await this.assetsService.getAssetContentStream(assetId, user.sub);

    res.setHeader('Content-Type', stream.mimeType);
    if (stream.size !== undefined && stream.size >= 0) {
      res.setHeader('Content-Length', stream.size);
    }
    res.setHeader('Cache-Control', 'private, max-age=3600');

    stream.body.pipe(res);

    stream.body.on('error', (err: Error) => {
      this.logger.error(`Stream error for asset ${assetId}: ${err.message}`);
      if (!res.headersSent) {
        res.status(500).end();
      }
    });
  }
}
