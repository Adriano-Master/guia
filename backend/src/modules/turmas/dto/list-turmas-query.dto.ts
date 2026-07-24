import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

export class ListTurmasQueryDto extends PaginationQueryDto {
  // Lê o valor BRUTO (obj.ativa): a conversão implícita do pipe global roda
  // ANTES do @Transform e faria Boolean('false') === true. Só 'true'/'false'
  // (ou booleano puro) viram booleano; o resto reprova no @IsBoolean → 422.
  @IsOptional()
  @Transform(({ obj }) => {
    const raw: unknown = obj.ativa;
    if (raw === 'true' || raw === true) return true;
    if (raw === 'false' || raw === false) return false;
    return raw;
  })
  @IsBoolean({ message: 'ativa deve ser true ou false' })
  ativa?: boolean;
}
