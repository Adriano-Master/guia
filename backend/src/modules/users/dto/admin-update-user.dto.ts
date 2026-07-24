import { Role, UserStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

export class AdminUpdateUserDto {
  @IsOptional()
  @IsEnum(Role, { message: 'role deve ser um de: ADMIN, MODERADOR, PROFESSOR, ALUNO' })
  role?: Role;

  @IsOptional()
  @IsEnum(UserStatus, { message: 'status deve ser um de: ATIVO, INATIVO, PENDENTE' })
  status?: UserStatus;
}
