import { PlanoTipo } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

export class ListPlanosQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(PlanoTipo, { message: 'tipo deve ser um de: OFICIAL, PESSOAL' })
  tipo?: PlanoTipo;

  // Lê o valor BRUTO (obj.publicado): a conversão implícita do pipe global
  // roda ANTES do @Transform e faria Boolean('false') === true. Só
  // 'true'/'false' (ou booleano puro) viram booleano; o resto reprova no
  // @IsBoolean → 422.
  @IsOptional()
  @Transform(({ obj }) => {
    const raw: unknown = obj.publicado;
    if (raw === 'true' || raw === true) return true;
    if (raw === 'false' || raw === false) return false;
    return raw;
  })
  @IsBoolean({ message: 'publicado deve ser true ou false' })
  publicado?: boolean;

  @IsOptional()
  @IsUUID(undefined, { message: 'autorId deve ser um UUID válido' })
  autorId?: string;
}
