import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class MatricularDto {
  // Normaliza para maiúsculas sem espaços: o alfabeto do código não tem
  // minúsculas nem caracteres ambíguos, então aceitar "abcd2345" digitado em
  // minúsculas é seguro e amigável.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString({ message: 'codigoConvite deve ser um texto' })
  @IsNotEmpty({ message: 'codigoConvite é obrigatório' })
  @MaxLength(32, { message: 'codigoConvite deve ter no máximo 32 caracteres' })
  codigoConvite!: string;
}
