// `codigoConvite`/`professorId` são imutáveis por aqui (regenerar-codigo é a
// rota própria); com forbidNonWhitelisted, enviá-los resulta em 422.
import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateTurmaDto {
  @IsOptional()
  @IsString({ message: 'nome deve ser um texto' })
  @IsNotEmpty({ message: 'nome não pode ser vazio' })
  @MaxLength(200, { message: 'nome deve ter no máximo 200 caracteres' })
  nome?: string;

  @IsOptional()
  @IsString({ message: 'descricao deve ser um texto' })
  @MaxLength(2000, { message: 'descricao deve ter no máximo 2000 caracteres' })
  descricao?: string;

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
