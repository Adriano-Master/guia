import { IsIn, IsOptional, Matches } from 'class-validator';
import { DATA_REGEX } from '../../questoes/dto/create-registro.dto';
import { Granularidade } from '../estatisticas-response';

/**
 * Período em dias de calendário no timezone efetivo do aluno, ambos
 * INCLUSIVOS; default no service (últimos 30 dias terminando hoje, ecoado na
 * resposta — mesmo precedente do desempenho de questões).
 */
export class SerieTemporalQueryDto {
  @IsOptional()
  @IsIn(['dia', 'semana'], { message: 'granularidade deve ser dia ou semana' })
  granularidade?: Granularidade;

  @IsOptional()
  @Matches(DATA_REGEX, { message: 'from deve estar no formato YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(DATA_REGEX, { message: 'to deve estar no formato YYYY-MM-DD' })
  to?: string;
}
