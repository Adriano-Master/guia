import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class ListProgressoSubtemasQueryDto {
  @IsUUID(undefined, { message: 'planoId é obrigatório e deve ser um UUID válido' })
  planoId!: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'temaId deve ser um UUID válido' })
  temaId?: string;

  // Lê o valor BRUTO (obj.concluido): a conversão implícita do pipe global
  // roda ANTES do @Transform e faria Boolean('false') === true. Só
  // 'true'/'false' (ou booleano puro) viram booleano; o resto segue cru e
  // reprova no @IsBoolean → 422.
  @IsOptional()
  @Transform(({ obj }) => {
    const raw: unknown = obj.concluido;
    if (raw === 'true' || raw === true) return true;
    if (raw === 'false' || raw === false) return false;
    return raw;
  })
  @IsBoolean({ message: 'concluido deve ser true ou false' })
  concluido?: boolean;
}
