import { IsOptional, Matches } from 'class-validator';
import { DATA_REGEX } from '../../questoes/dto/create-registro.dto';

/**
 * Período em dias de calendário no timezone efetivo do aluno, ambos
 * INCLUSIVOS; ausentes = sem recorte (tudo). `from > to` → 422 no service.
 */
export class HorasPorDisciplinaQueryDto {
  @IsOptional()
  @Matches(DATA_REGEX, { message: 'from deve estar no formato YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(DATA_REGEX, { message: 'to deve estar no formato YYYY-MM-DD' })
  to?: string;
}
