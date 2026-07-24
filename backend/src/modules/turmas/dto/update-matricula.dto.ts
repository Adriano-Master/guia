import { MatriculaStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateMatriculaDto {
  @IsEnum(MatriculaStatus, { message: 'status deve ser um de: ATIVA, INATIVA' })
  status!: MatriculaStatus;
}
