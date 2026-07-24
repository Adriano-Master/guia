import { IsInt, IsOptional, Min } from 'class-validator';

export class StopCronometroDto {
  /** Total de minutos pausados acumulados pelo cliente (D-3). Default 0. */
  @IsOptional()
  @IsInt({ message: 'pausaMin deve ser um inteiro' })
  @Min(0, { message: 'pausaMin deve ser maior ou igual a 0' })
  pausaMin?: number;
}
