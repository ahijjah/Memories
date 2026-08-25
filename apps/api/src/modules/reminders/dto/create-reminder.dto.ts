import { IsString, IsOptional, IsDateString } from 'class-validator';

export class CreateReminderDto {
  @IsString()
  memoryId: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsDateString()
  remindAt: string;
}
