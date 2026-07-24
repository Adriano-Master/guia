import { IsISO8601, IsOptional } from 'class-validator';

export class ListBlocosQueryDto {
  @IsOptional()
  @IsISO8601({}, { message: 'from deve ser uma data ISO-8601 (UTC)' })
  from?: string;

  @IsOptional()
  @IsISO8601({}, { message: 'to deve ser uma data ISO-8601 (UTC)' })
  to?: string;
}
