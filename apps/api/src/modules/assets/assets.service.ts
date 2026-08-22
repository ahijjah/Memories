import { Injectable, NotFoundException } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { PrismaService } from '../../common/prisma/prisma.service';

// NOTE: this is a stub. It records the intent to upload and returns a
// placeholder "signed URL" shape so the mobile client can be built against
// a stable contract now. Wiring a real S3/R2/MinIO signer is a follow-up
// task (see ADR-001 — object storage provider not yet selected).
@Injectable()
export class AssetsService {
  constructor(private readonly prisma: PrismaService) {}

  async createUploadTarget(memoryId: string, mimeType: string) {
    const memory = await this.prisma.memory.findUnique({ where: { id: memoryId } });
    if (!memory) throw new NotFoundException('Memory not found');

    const objectKey = `memories/${memoryId}/${nanoid()}`;

    // TODO(object-storage-spike): replace with a real short-lived signed
    // PUT URL from the chosen provider. Never return a public URL (spec §12).
    const uploadUrl = `stub://object-storage/${objectKey}?expires=900`;

    return { objectKey, uploadUrl, mimeType, expiresInSeconds: 900 };
  }

  async completeUpload(memoryId: string, objectKey: string, mimeType: string, checksum?: string) {
    return this.prisma.memoryAsset.create({
      data: { memoryId, objectKey, mimeType, checksum, variant: 'original' },
    });
  }
}
