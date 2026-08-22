import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateUploadDto {
  @IsUUID()
  memoryId!: string;

  @IsString()
  mimeType!: string;
}

export class CompleteUploadDto {
  @IsUUID()
  memoryId!: string;

  @IsString()
  objectKey!: string;

  @IsString()
  mimeType!: string;

  @IsOptional()
  @IsString()
  checksum?: string;
}
