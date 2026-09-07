import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsString } from 'class-validator';

export class ConfirmFieldDto {
  @ApiProperty({ description: 'Field name to confirm (e.g., "title", "summary", "topics")' })
  @IsString()
  field!: string;

  @ApiProperty({ description: 'Confirmed value for the field (can be any JSON value)' })
  @IsDefined()
  confirmedValue!: any;
}
