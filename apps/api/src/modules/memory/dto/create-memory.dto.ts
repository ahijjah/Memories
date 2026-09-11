import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

// Client-supplied idempotency key (spec §8, §17): retrying the same
// capture must never create a duplicate Memory.
export class CreateMemoryDto {
  @ApiProperty({
    enum: ['text', 'url', 'image', 'camera', 'screenshot'],
    description: 'Source type of the memory',
  })
  @IsString()
  sourceType!: string;

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
