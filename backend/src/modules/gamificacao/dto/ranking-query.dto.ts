import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../../../common/pagination/pagination.dto';

/**
 * Paginação do ranking SEM `?sort` (a ordenação é fixa pelo CA-02) e com
 * clamp em vez de 422 no teto: o caso de borda dos requirements manda
 * "pageSize acima do máximo (100) → limitado a 100" — deliberadamente
 * diferente do @Max do PaginationQueryDto comum.
 */
export class RankingQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  // Lê o valor BRUTO (obj.pageSize): valores inteiros acima do teto são
  // clampados; não-inteiros seguem para o @IsInt reprovar → 422.
  @IsOptional()
  @Transform(({ obj }) => {
    const n = Number((obj as Record<string, unknown>).pageSize);
    return Number.isInteger(n) && n > MAX_PAGE_SIZE ? MAX_PAGE_SIZE : n;
  })
  @IsInt()
  @Min(1)
  pageSize: number = DEFAULT_PAGE_SIZE;
}
