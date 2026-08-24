import { IsString, MinLength, MaxLength } from 'class-validator';

export class SearchQueryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  query: string;
}
