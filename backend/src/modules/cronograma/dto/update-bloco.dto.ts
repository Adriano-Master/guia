import { BlocoStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateBlocoDto {
  @IsEnum(BlocoStatus, { message: 'status deve ser um de: PLANEJADO, CONCLUIDO, PULADO' })
  status!: BlocoStatus;
}
