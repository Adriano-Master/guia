import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshDto {
  @IsString({ message: 'refreshToken deve ser um texto' })
  @IsNotEmpty({ message: 'refreshToken é obrigatório' })
  refreshToken!: string;
}

export class LogoutDto extends RefreshDto {}
