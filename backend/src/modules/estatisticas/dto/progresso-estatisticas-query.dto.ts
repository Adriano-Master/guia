import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export class ProgressoEstatisticasQueryDto {
  // Lê o valor BRUTO (obj.porDisciplina): a conversão implícita do pipe global
  // roda ANTES do @Transform e faria Boolean('false') === true. Só
  // 'true'/'false' (ou booleano puro) viram booleano; o resto segue cru e
  // reprova no @IsBoolean → 422.
  @IsOptional()
  @Transform(({ obj }) => {
    const raw: unknown = obj.porDisciplina;
    if (raw === 'true' || raw === true) return true;
    if (raw === 'false' || raw === false) return false;
    return raw;
  })
  @IsBoolean({ message: 'porDisciplina deve ser true ou false' })
  porDisciplina?: boolean;
}
