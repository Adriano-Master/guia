import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateTurmaDto {
  @IsString({ message: 'nome deve ser um texto' })
  @IsNotEmpty({ message: 'nome é obrigatório' })
  @MaxLength(200, { message: 'nome deve ter no máximo 200 caracteres' })
  nome!: string;

  @IsOptional()
  @IsString({ message: 'descricao deve ser um texto' })
  @MaxLength(2000, { message: 'descricao deve ter no máximo 2000 caracteres' })
  descricao?: string;
}
