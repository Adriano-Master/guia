import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateMeDto {
  @IsOptional()
  @IsString({ message: 'nome deve ser um texto' })
  @IsNotEmpty({ message: 'nome não pode ser vazio' })
  @MaxLength(120, { message: 'nome deve ter no máximo 120 caracteres' })
  nome?: string;

  @IsOptional()
  @IsEmail({}, { message: 'email deve ser um endereço de email válido' })
  email?: string;
}
