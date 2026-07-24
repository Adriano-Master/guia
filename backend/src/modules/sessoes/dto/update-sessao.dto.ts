import { IsInt, IsOptional, IsUUID, Max, Min, ValidateIf } from 'class-validator';
import { DURACAO_MAX_MIN } from './manual-sessao.dto';

/**
 * Correções pós-registro (RN-7): apenas duracaoMin e subtemaId, sessão
 * finalizada. duracaoMin usa @ValidateIf(≠ undefined) em vez de @IsOptional:
 * null explícito deve dar 422 (coluna NOT NULL), não atravessar até o Prisma.
 */
export class UpdateSessaoDto {
  @ValidateIf((o: UpdateSessaoDto) => o.duracaoMin !== undefined)
  @IsInt({ message: 'duracaoMin deve ser um inteiro' })
  @Min(1, { message: 'duracaoMin deve ser maior que 0' })
  @Max(DURACAO_MAX_MIN, { message: 'duracaoMin deve ser no máximo 1440 (24h)' })
  duracaoMin?: number;

  /** null explícito remove o vínculo com subtema (@IsOptional aceita null). */
  @IsOptional()
  @IsUUID(undefined, { message: 'subtemaId deve ser um UUID válido' })
  subtemaId?: string | null;
}
