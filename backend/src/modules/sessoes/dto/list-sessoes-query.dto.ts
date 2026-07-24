import { IsISO8601, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

export class ListSessoesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID(undefined, { message: 'disciplinaId deve ser um UUID válido' })
  disciplinaId?: string;

  @IsOptional()
  @IsISO8601({}, { message: 'from deve ser uma data ISO-8601 (UTC)' })
  from?: string;

  @IsOptional()
  @IsISO8601({}, { message: 'to deve ser uma data ISO-8601 (UTC)' })
  to?: string;
}
