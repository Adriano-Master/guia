import { IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';

const DATA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** Teto de 24h por registro: evita `fim` absurdo no futuro poluindo estatísticas. */
export const DURACAO_MAX_MIN = 1440;

export class ManualSessaoDto {
  @IsUUID(undefined, { message: 'disciplinaId deve ser um UUID válido' })
  disciplinaId!: string;

  /** @IsOptional deixa null passar: o service o normaliza como ausente. */
  @IsOptional()
  @IsUUID(undefined, { message: 'subtemaId deve ser um UUID válido' })
  subtemaId?: string | null;

  @IsOptional()
  @IsUUID(undefined, { message: 'blocoId deve ser um UUID válido' })
  blocoId?: string | null;

  @Matches(DATA_REGEX, { message: 'data deve estar no formato YYYY-MM-DD' })
  data!: string;

  @IsInt({ message: 'duracaoMin deve ser um inteiro' })
  @Min(1, { message: 'duracaoMin deve ser maior que 0' })
  @Max(DURACAO_MAX_MIN, { message: 'duracaoMin deve ser no máximo 1440 (24h)' })
  duracaoMin!: number;
}
