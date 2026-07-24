import { IsInt, IsOptional, IsUUID, Matches, Min, ValidateIf } from 'class-validator';
import { DATA_REGEX } from './create-registro.dto';

/**
 * Correção de lançamento (US-3): o service revalida TODAS as invariantes com
 * os valores RESULTANTES (ex.: PATCH só de `erros` compara com o `total` já
 * persistido). `temaId` não é editável — para trocar de tema, recriar.
 *
 * total/erros/data usam @ValidateIf(≠ undefined) em vez de @IsOptional: null
 * explícito deve dar 422 (colunas NOT NULL), não atravessar até o Prisma.
 */
export class UpdateRegistroDto {
  @ValidateIf((o: UpdateRegistroDto) => o.total !== undefined)
  @IsInt({ message: 'total deve ser um inteiro' })
  @Min(1, { message: 'total deve ser maior que 0' })
  total?: number;

  @ValidateIf((o: UpdateRegistroDto) => o.erros !== undefined)
  @IsInt({ message: 'erros deve ser um inteiro' })
  @Min(0, { message: 'erros não pode ser negativo' })
  erros?: number;

  /** null explícito remove o vínculo com subtema (@IsOptional aceita null). */
  @IsOptional()
  @IsUUID(undefined, { message: 'subtemaId deve ser um UUID válido' })
  subtemaId?: string | null;

  @ValidateIf((o: UpdateRegistroDto) => o.data !== undefined)
  @Matches(DATA_REGEX, { message: 'data deve estar no formato YYYY-MM-DD' })
  data?: string;
}
