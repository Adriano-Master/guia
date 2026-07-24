import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString({ message: 'token deve ser um texto' })
  @IsNotEmpty({ message: 'token é obrigatório' })
  token!: string;

  @IsString({ message: 'senhaNova deve ser um texto' })
  @MinLength(8, { message: 'senhaNova deve ter no mínimo 8 caracteres' })
  @MaxLength(128, { message: 'senhaNova deve ter no máximo 128 caracteres' })
  senhaNova!: string;
}
