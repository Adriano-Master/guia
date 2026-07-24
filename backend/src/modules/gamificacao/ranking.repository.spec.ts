import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RankingRepository } from './ranking.repository';

/**
 * Unit do repository focado no que é REGRA DE NEGÓCIO embutida no SQL:
 * ordenação/desempate do CA-02, filtros de escopo (RN-05/CA-04) e o guard do
 * upsert vazio. Comportamento fim-a-fim do SQL é coberto no e2e
 * (test/gamificacao.e2e-spec.ts) contra Postgres real.
 */

type PrismaMock = {
  $queryRaw: jest.Mock;
  $executeRaw: jest.Mock;
  user: { findMany: jest.Mock; findFirst: jest.Mock; count: jest.Mock };
  matricula: { count: jest.Mock };
  progressoSubtema: { groupBy: jest.Mock };
  sessaoEstudo: { groupBy: jest.Mock };
};

function prismaMock(): PrismaMock {
  return {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(0),
    user: { findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn() },
    matricula: { count: jest.fn() },
    progressoSubtema: { groupBy: jest.fn().mockResolvedValue([]) },
    sessaoEstudo: { groupBy: jest.fn().mockResolvedValue([]) },
  };
}

function sqlDaChamada(mock: jest.Mock, callIndex = 0): Prisma.Sql {
  return mock.mock.calls[callIndex][0] as Prisma.Sql;
}

/** Normaliza espaços para asserções resilientes a indentação. */
function flat(sql: string): string {
  return sql.replace(/\s+/g, ' ');
}

const ORDENACAO_CA02 =
  'ORDER BY COALESCE(p.pontos, 0) DESC, COALESCE(p.subtemas_concluidos, 0) DESC, ' +
  'p.atualizado_em ASC NULLS LAST, u.id ASC';

describe('RankingRepository (unit — SQL de ranking)', () => {
  let prisma: PrismaMock;
  let repository: RankingRepository;

  beforeEach(() => {
    prisma = prismaMock();
    repository = new RankingRepository(prisma as unknown as PrismaService);
  });

  it('CA-02: paginaGlobal ordena por pontos desc → subtemas desc → atualizado_em asc NULLS LAST → id asc', async () => {
    await repository.paginaGlobal(0, 20);

    const sql = flat(sqlDaChamada(prisma.$queryRaw).sql);
    expect(sql).toContain(ORDENACAO_CA02);
    // posicao sobre o conjunto COMPLETO (ROW_NUMBER na CTE, paginação por fora)
    expect(sql).toContain('ROW_NUMBER() OVER');
    expect(sql).toMatch(/SELECT \* FROM ranking ORDER BY posicao LIMIT \? OFFSET \?/);
  });

  it('RN-05: rankings filtram role ALUNO + status ATIVO + não soft-deleted, com LEFT JOIN na pontuação', async () => {
    await repository.paginaGlobal(0, 20);

    const sql = flat(sqlDaChamada(prisma.$queryRaw).sql);
    expect(sql).toContain("WHERE u.role = 'ALUNO' AND u.status = 'ATIVO' AND u.deleted_at IS NULL");
    // LEFT JOIN: aluno ATIVO sem registro ainda aparece (0/0/0)
    expect(sql).toContain('LEFT JOIN pontuacoes_aluno p ON p.aluno_id = u.id');
    expect(sql).toContain('COALESCE(p.pontos, 0)');
  });

  it('paginaGlobal: skip/take viram binds de OFFSET/LIMIT', async () => {
    await repository.paginaGlobal(40, 10);

    const values = sqlDaChamada(prisma.$queryRaw).values;
    expect(values).toContain(10); // LIMIT
    expect(values).toContain(40); // OFFSET
  });

  it('CA-04: paginaTurma faz JOIN em matriculas com status ATIVA e deleted_at IS NULL', async () => {
    const turmaId = randomUUID();
    await repository.paginaTurma(turmaId, 0, 20);

    const chamada = sqlDaChamada(prisma.$queryRaw);
    const sql = flat(chamada.sql);
    expect(sql).toContain('JOIN matriculas m ON m.aluno_id = u.id AND m.turma_id = ?::uuid');
    expect(sql).toContain("AND m.status = 'ATIVA' AND m.deleted_at IS NULL");
    expect(sql).toContain(ORDENACAO_CA02);
    expect(chamada.values).toContain(turmaId);
  });

  it('posicaoGlobalDoAluno: mesma ordenação CA-02, recortada pelo aluno DEPOIS do ROW_NUMBER', async () => {
    const alunoId = randomUUID();
    await repository.posicaoGlobalDoAluno(alunoId);

    const chamada = sqlDaChamada(prisma.$queryRaw);
    const sql = flat(chamada.sql);
    expect(sql).toContain(ORDENACAO_CA02);
    expect(sql).toContain('SELECT * FROM ranking WHERE aluno_id = ?::uuid');
    expect(chamada.values).toContain(alunoId);
  });

  it('posicoesPorTurmaDoAluno: ROW_NUMBER PARTICIONADO por turma com o MESMO desempate do CA-02', async () => {
    await repository.posicoesPorTurmaDoAluno(randomUUID());

    const sql = flat(sqlDaChamada(prisma.$queryRaw).sql);
    expect(sql).toContain(
      'PARTITION BY m.turma_id ORDER BY COALESCE(p.pontos, 0) DESC, ' +
        'COALESCE(p.subtemas_concluidos, 0) DESC, p.atualizado_em ASC NULLS LAST, u.id ASC',
    );
    // turmas soft-deleted fora do "minhas turmas"
    expect(sql).toContain('JOIN turmas t ON t.id = m.turma_id AND t.deleted_at IS NULL');
    expect(sql).toContain('ORDER BY t.nome ASC, r.turma_id ASC');
  });

  it('semanasConsistentesPorAluno: semana ISO no timezone do cronograma ativo, ≥ 5 dias distintos', async () => {
    await repository.semanasConsistentesPorAluno();

    const chamada = sqlDaChamada(prisma.$queryRaw);
    const sql = flat(chamada.sql);
    expect(sql).toContain("date_trunc('week', s.inicio AT TIME ZONE COALESCE(c.timezone, ?))");
    expect(sql).toContain('HAVING COUNT(DISTINCT (s.inicio AT TIME ZONE COALESCE(c.timezone, ?))::date) >= ?');
    expect(sql).toContain('WHERE s.fim IS NOT NULL AND s.deleted_at IS NULL');
    expect(chamada.values).toContain('America/Sao_Paulo');
    expect(chamada.values).toContain(5);
  });

  it('alunosAtivosIds: filtro ALUNO/ATIVO/não-deletado com ORDEM DETERMINÍSTICA (id asc, anti-deadlock do upsert)', async () => {
    prisma.user.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);

    const ids = await repository.alunosAtivosIds();

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { role: 'ALUNO', status: 'ATIVO', deletedAt: null },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    expect(ids).toEqual(['a', 'b']);
  });

  it('upsertPontuacoes([]) é no-op: nenhum statement disparado', async () => {
    await repository.upsertPontuacoes([]);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('upsertPontuacoes: UPSERT único com ON CONFLICT (aluno_id) e atualizado_em = now() (CA-07)', async () => {
    const alunoId = randomUUID();
    await repository.upsertPontuacoes([
      { alunoId, pontos: 700, subtemasConcluidos: 30, horasEstudadas: '40.00' },
    ]);

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    // Tagged template: strings + binds (arrays paralelos p/ unnest)
    const [strings, ...values] = prisma.$executeRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    const sql = flat(strings.join('?'));
    expect(sql).toContain('INSERT INTO pontuacoes_aluno');
    expect(sql).toContain('ON CONFLICT (aluno_id) DO UPDATE SET');
    expect(sql).toContain('atualizado_em = now()');
    expect(values).toEqual([[alunoId], [700], [30], ['40.00']]);
  });

  it('insumos por aluno: filtros de sessões finalizadas (RN-02) e progresso concluído (RN-03)', async () => {
    const alunoId = randomUUID();
    prisma.sessaoEstudo.groupBy.mockResolvedValue([
      { alunoId, _sum: { duracaoMin: 150 } },
      { alunoId: 'outro', _sum: { duracaoMin: null } },
    ]);
    prisma.progressoSubtema.groupBy.mockResolvedValue([{ alunoId, _count: { _all: 3 } }]);

    const minutos = await repository.minutosPorAluno();
    const subtemas = await repository.subtemasConcluidosPorAluno(alunoId);

    expect(prisma.sessaoEstudo.groupBy).toHaveBeenCalledWith({
      by: ['alunoId'],
      where: { fim: { not: null }, deletedAt: null },
      _sum: { duracaoMin: true },
    });
    expect(prisma.progressoSubtema.groupBy).toHaveBeenCalledWith({
      by: ['alunoId'],
      where: { concluido: true, deletedAt: null, alunoId },
      _count: { _all: true },
    });
    expect(minutos.get(alunoId)).toBe(150);
    expect(minutos.get('outro')).toBe(0); // _sum nulo → guarda em 0
    expect(subtemas.get(alunoId)).toBe(3);
  });
});
