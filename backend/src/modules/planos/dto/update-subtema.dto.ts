import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UpdateSubtemaDto {
  @IsOptional()
  @IsString({ message: 'nome deve ser um texto' })
  @IsNotEmpty({ message: 'nome não pode ser vazio' })
  @MaxLength(200, { message: 'nome deve ter no máximo 200 caracteres' })
  nome?: string;

  @IsOptional()
  @IsInt({ message: 'ordem deve ser um número inteiro' })
  @Min(0, { message: 'ordem deve ser no mínimo 0' })
  ordem?: number;

  @IsOptional()
  @IsInt({ message: 'duracaoEstimadaMin deve ser um número inteiro' })
  @Min(1, { message: 'duracaoEstimadaMin deve ser no mínimo 1' })
  duracaoEstimadaMin?: number;
}
