import { IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';

export class CreateDisciplinaDto {
  @IsString({ message: 'nome deve ser um texto' })
  @IsNotEmpty({ message: 'nome é obrigatório' })
  @MaxLength(200, { message: 'nome deve ter no máximo 200 caracteres' })
  nome!: string;

  @IsInt({ message: 'ordem deve ser um número inteiro' })
  @Min(0, { message: 'ordem deve ser no mínimo 0' })
  ordem!: number;
}
