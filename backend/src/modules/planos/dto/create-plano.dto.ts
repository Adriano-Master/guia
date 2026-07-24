import { PlanoTipo } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreatePlanoDto {
  @IsString({ message: 'titulo deve ser um texto' })
  @IsNotEmpty({ message: 'titulo é obrigatório' })
  @MaxLength(200, { message: 'titulo deve ter no máximo 200 caracteres' })
  titulo!: string;

  @IsOptional()
  @IsString({ message: 'descricao deve ser um texto' })
  @MaxLength(2000, { message: 'descricao deve ter no máximo 2000 caracteres' })
  descricao?: string;

  @IsEnum(PlanoTipo, { message: 'tipo deve ser um de: OFICIAL, PESSOAL' })
  tipo!: PlanoTipo;
}
