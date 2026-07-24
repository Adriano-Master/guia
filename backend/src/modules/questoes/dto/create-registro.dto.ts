import { IsInt, IsOptional, IsUUID, Matches, Min } from 'class-validator';

export const DATA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Invariantes de campo isolado (RN-2 parcial: total ≥ 1, erros ≥ 0) ficam no
 * DTO; a comparação cruzada erros ≤ total e a checagem de calendário/futuro da
 * data ficam no service, padrão do projeto (CA-2, CA-3).
 */
export class CreateRegistroDto {
  @IsUUID(undefined, { message: 'temaId deve ser um UUID válido' })
  temaId!: string;

  /** @IsOptional deixa null passar: o service o normaliza como "sem subtema". */
  @IsOptional()
  @IsUUID(undefined, { message: 'subtemaId deve ser um UUID válido' })
  subtemaId?: string | null;

  @Matches(DATA_REGEX, { message: 'data deve estar no formato YYYY-MM-DD' })
  data!: string;

  @IsInt({ message: 'total deve ser um inteiro' })
  @Min(1, { message: 'total deve ser maior que 0' })
  total!: number;

  @IsInt({ message: 'erros deve ser um inteiro' })
  @Min(0, { message: 'erros não pode ser negativo' })
  erros!: number;
}
