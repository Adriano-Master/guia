import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString({ message: 'nome deve ser um texto' })
  @IsNotEmpty({ message: 'nome é obrigatório' })
  @MaxLength(120, { message: 'nome deve ter no máximo 120 caracteres' })
  nome!: string;

  @IsEmail({}, { message: 'email deve ser um endereço de email válido' })
  email!: string;

  @IsString({ message: 'senha deve ser um texto' })
  @MinLength(8, { message: 'senha deve ter no mínimo 8 caracteres' })
  @MaxLength(128, { message: 'senha deve ter no máximo 128 caracteres' })
  senha!: string;
}
