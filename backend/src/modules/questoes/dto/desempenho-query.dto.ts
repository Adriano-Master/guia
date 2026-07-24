import { IsOptional, IsUUID, Matches } from 'class-validator';
import { DATA_REGEX } from './create-registro.dto';

/** Período em dias de calendário, ambos inclusivos; default no service (D-3). */
export class DesempenhoQueryDto {
  @IsOptional()
  @IsUUID(undefined, { message: 'temaId deve ser um UUID válido' })
  temaId?: string;

  @IsOptional()
  @Matches(DATA_REGEX, { message: 'from deve estar no formato YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(DATA_REGEX, { message: 'to deve estar no formato YYYY-MM-DD' })
  to?: string;
}
