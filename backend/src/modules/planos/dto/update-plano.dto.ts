// `tipo` é imutável (RN-01/DT-06): o campo não existe neste DTO e, com o
// ValidationPipe global em forbidNonWhitelisted, enviá-lo resulta em 422.
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdatePlanoDto {
  @IsOptional()
  @IsString({ message: 'titulo deve ser um texto' })
  @IsNotEmpty({ message: 'titulo não pode ser vazio' })
  @MaxLength(200, { message: 'titulo deve ter no máximo 200 caracteres' })
  titulo?: string;

  @IsOptional()
  @IsString({ message: 'descricao deve ser um texto' })
  @MaxLength(2000, { message: 'descricao deve ter no máximo 2000 caracteres' })
  descricao?: string;
}
