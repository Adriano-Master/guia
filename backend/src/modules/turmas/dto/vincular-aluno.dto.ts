import { IsEmail } from 'class-validator';

export class VincularAlunoDto {
  @IsEmail({}, { message: 'email deve ser um endereço de email válido' })
  email!: string;
}
