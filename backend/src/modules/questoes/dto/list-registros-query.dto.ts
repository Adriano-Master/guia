import { IsOptional, IsUUID, Matches } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';
import { DATA_REGEX } from './create-registro.dto';

/**
 * `from`/`to` são dias de calendário (YYYY-MM-DD) sobre o campo DATE `data`,
 * AMBOS inclusivos — diferente dos recursos timestamptz (sessões/blocos), onde
 * `to` é fronteira exclusiva de instante.
 */
export class ListRegistrosQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID(undefined, { message: 'temaId deve ser um UUID válido' })
  temaId?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'subtemaId deve ser um UUID válido' })
  subtemaId?: string;

  @IsOptional()
  @Matches(DATA_REGEX, { message: 'from deve estar no formato YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(DATA_REGEX, { message: 'to deve estar no formato YYYY-MM-DD' })
  to?: string;
}
