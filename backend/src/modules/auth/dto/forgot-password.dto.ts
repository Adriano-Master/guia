import { IsEmail } from 'class-validator';

export class ForgotPasswordDto {
  @IsEmail({}, { message: 'email deve ser um endereço de email válido' })
  email!: string;
}
