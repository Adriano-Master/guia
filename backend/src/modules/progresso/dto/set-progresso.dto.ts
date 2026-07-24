import { Transform } from 'class-transformer';
import { IsBoolean } from 'class-validator';

export class SetProgressoDto {
  // Lê o valor BRUTO (obj.concluido) porque a conversão implícita do pipe
  // global coage qualquer string/number para Boolean(...) ANTES da validação
  // ("false" → true). Body exige booleano JSON estrito: não-booleano reprova
  // no @IsBoolean → 422.
  @Transform(({ obj }) => obj.concluido)
  @IsBoolean({ message: 'concluido deve ser um booleano' })
  concluido!: boolean;
}
