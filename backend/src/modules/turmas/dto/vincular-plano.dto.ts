import { IsUUID } from 'class-validator';

export class VincularPlanoDto {
  @IsUUID(undefined, { message: 'planoId é obrigatório e deve ser um UUID válido' })
  planoId!: string;
}
