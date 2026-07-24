import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RankingQueryDto } from './ranking-query.dto';

/**
 * Caso de borda dos requirements: "pageSize acima do máximo (100) → limitado
 * a 100" — clamp em vez do 422 do PaginationQueryDto comum. Valores inválidos
 * (não-inteiro, < 1) continuam reprovando na validação.
 */
async function transformAndValidate(
  query: Record<string, unknown>,
): Promise<{ dto: RankingQueryDto; fields: string[] }> {
  const dto = plainToInstance(RankingQueryDto, query);
  const errors = await validate(dto);
  return { dto, fields: errors.map((e) => e.property) };
}

describe('RankingQueryDto', () => {
  it('defaults: page 1, pageSize 20, sem ?sort (ordenação é fixa pelo CA-02)', async () => {
    const { dto, fields } = await transformAndValidate({});
    expect(fields).toEqual([]);
    expect(dto.page).toBe(1);
    expect(dto.pageSize).toBe(20);
    expect(dto).not.toHaveProperty('sort');
  });

  it('pageSize=101 → CLAMPADO a 100 (sem erro de validação)', async () => {
    const { dto, fields } = await transformAndValidate({ pageSize: '101' });
    expect(fields).toEqual([]);
    expect(dto.pageSize).toBe(100);
  });

  it('pageSize=100 (teto exato) e valores válidos passam sem clamp', async () => {
    const { dto, fields } = await transformAndValidate({ page: '2', pageSize: '100' });
    expect(fields).toEqual([]);
    expect(dto.page).toBe(2);
    expect(dto.pageSize).toBe(100);
  });

  it('pageSize gigante (10000) também é clampado a 100', async () => {
    const { dto, fields } = await transformAndValidate({ pageSize: '10000' });
    expect(fields).toEqual([]);
    expect(dto.pageSize).toBe(100);
  });

  it('pageSize inválido (0, negativo, não-inteiro, texto) → erro de validação, NÃO clamp', async () => {
    for (const pageSize of ['0', '-5', '2.5', 'abc']) {
      const { fields } = await transformAndValidate({ pageSize });
      expect(fields).toEqual(['pageSize']);
    }
  });

  it('page inválida (0, texto) → erro de validação', async () => {
    for (const page of ['0', 'x']) {
      const { fields } = await transformAndValidate({ page });
      expect(fields).toEqual(['page']);
    }
  });
});
