import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'email deve ser um endereço de email válido' })
  email!: string;

  @IsString({ message: 'senha deve ser um texto' })
  @IsNotEmpty({ message: 'senha é obrigatória' })
  senha!: string;
}
