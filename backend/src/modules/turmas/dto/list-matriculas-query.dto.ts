import { MatriculaStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

export class ListMatriculasQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(MatriculaStatus, { message: 'status deve ser um de: ATIVA, INATIVA' })
  status?: MatriculaStatus;
}
