import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UpdateDisciplinaDto {
  @IsOptional()
  @IsString({ message: 'nome deve ser um texto' })
  @IsNotEmpty({ message: 'nome não pode ser vazio' })
  @MaxLength(200, { message: 'nome deve ter no máximo 200 caracteres' })
  nome?: string;

  @IsOptional()
  @IsInt({ message: 'ordem deve ser um número inteiro' })
  @Min(0, { message: 'ordem deve ser no mínimo 0' })
  ordem?: number;
}
