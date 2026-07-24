import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString({ message: 'senhaAtual deve ser um texto' })
  @IsNotEmpty({ message: 'senhaAtual é obrigatória' })
  @MaxLength(128, { message: 'senhaAtual deve ter no máximo 128 caracteres' })
  senhaAtual!: string;

  @IsString({ message: 'senhaNova deve ser um texto' })
  @MinLength(8, { message: 'senhaNova deve ter no mínimo 8 caracteres' })
  @MaxLength(128, { message: 'senhaNova deve ter no máximo 128 caracteres' })
  senhaNova!: string;
}
