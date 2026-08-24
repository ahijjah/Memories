import { IsString, IsNotEmpty } from 'class-validator';

export class AskQueryDto {
  @IsString()
  @IsNotEmpty()
  question: string;
}
