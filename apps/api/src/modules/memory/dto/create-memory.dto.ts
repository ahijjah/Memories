import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { MemorySourceType } from '@prisma/client';

// Client-supplied idempotency key (spec §8, §17): retrying the same
// capture must never create a duplicate Memory.
export class CreateMemoryDto {
  @ApiProperty({ enum: MemorySourceType })
  @IsEnum(MemorySourceType)
  sourceType!: MemorySourceType;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  sourceUri?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({
    description: 'Client-generated idempotency key — required, unique per capture attempt',
  })
  @IsUUID()
  idempotencyKey!: string;
}
