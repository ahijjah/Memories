import { IsIn, IsOptional, IsString, IsUUID, IsNumber } from 'class-validator';

/** Evidence roles a client may assign at complete-upload. Only one exists today. */
export const ASSET_EVIDENCE_ROLES = ['source_screenshot'] as const;
export type AssetEvidenceRoleValue = (typeof ASSET_EVIDENCE_ROLES)[number];

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

  @IsOptional()
  @IsNumber()
  pageIndex?: number;

  /**
   * Optional explicit evidence role, fixed when the asset row is created (no later changes).
   * source_screenshot: a screenshot the user provides of the Memory's shared link; user-asserted.
   */
  @IsOptional()
  @IsIn([...ASSET_EVIDENCE_ROLES])
  evidenceRole?: AssetEvidenceRoleValue;
}
