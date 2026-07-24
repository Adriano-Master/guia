import { Role, UserStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

export class ListUsersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(Role, { message: 'role deve ser um de: ADMIN, MODERADOR, PROFESSOR, ALUNO' })
  role?: Role;

  @IsOptional()
  @IsEnum(UserStatus, { message: 'status deve ser um de: ATIVO, INATIVO, PENDENTE' })
  status?: UserStatus;

  /** Busca livre por nome ou email (case-insensitive). */
  @IsOptional()
  @IsString({ message: 'q deve ser um texto' })
  q?: string;
}
