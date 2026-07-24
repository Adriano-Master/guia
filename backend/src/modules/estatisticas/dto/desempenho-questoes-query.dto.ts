import { IsIn, IsOptional } from 'class-validator';
import { AgruparPor } from '../estatisticas-response';

export class DesempenhoQuestoesQueryDto {
  @IsOptional()
  @IsIn(['disciplina', 'tema'], { message: 'agruparPor deve ser disciplina ou tema' })
  agruparPor?: AgruparPor;
}
