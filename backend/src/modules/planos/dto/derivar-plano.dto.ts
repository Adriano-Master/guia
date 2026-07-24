import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class DerivarPlanoDto {
  @IsOptional()
  @IsString({ message: 'titulo deve ser um texto' })
  @IsNotEmpty({ message: 'titulo não pode ser vazio' })
  @MaxLength(200, { message: 'titulo deve ter no máximo 200 caracteres' })
  titulo?: string;
}
