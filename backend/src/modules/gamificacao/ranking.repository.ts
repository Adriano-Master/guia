import { Injectable } from '@nestjs/common';
import { MatriculaStatus, Prisma, Role, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Mesmo tratamento provisório de estatísticas (RN-03 de lá): timezone do
 * cronograma ativo do aluno; sem cronograma ativo → America/Sao_Paulo. */
const TIMEZONE_DEFAULT = 'America/Sao_Paulo';

/** RN-04/design: semana consistente = ≥ 5 dias distintos com sessão finalizada. */
const MIN_DIAS_CONSISTENTES = 5;

export interface RankingRow {
  aluno_id: string;
  nome: string;
  pontos: number;
  subtemas_concluidos: number;
  horas_estudadas: unknown;
  posicao: number;
}

export interface PosicaoTurmaRow {
  turma_id: string;
  nome: string;
  posicao: number;
}

export interface PontuacaoCalculada {
  alunoId: string;
  pontos: number;
  subtemasConcluidos: number;
  /** Horas com 2 casas, como string p/ bind exato em ::numeric[]. */
  horasEstudadas: string;
}

const alunoAtivoWhere = {
  role: Role.ALUNO,
  status: UserStatus.ATIVO,
  deletedAt: null,
} as const;

@Injectable()
export class RankingRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------- insumos

  async alunosAtivosIds(): Promise<string[]> {
    const alunos = await this.prisma.user.findMany({
      where: alunoAtivoWhere,
      select: { id: true },
      // Ordem de lock determinística no UPSERT multi-linha: duas recomputações
      // concorrentes tocando as linhas na mesma ordem não se deadlockam.
      orderBy: { id: 'asc' },
    });
    return alunos.map((aluno) => aluno.id);
  }

  async isAlunoAtivo(alunoId: string): Promise<boolean> {
    const aluno = await this.prisma.user.findFirst({
      where: { id: alunoId, ...alunoAtivoWhere },
      select: { id: true },
    });
    return aluno !== null;
  }

  /** RN-03: COUNT(ProgressoSubtema concluido=true), set-based por aluno. */
  async subtemasConcluidosPorAluno(alunoId?: string): Promise<Map<string, number>> {
    const grupos = await this.prisma.progressoSubtema.groupBy({
      by: ['alunoId'],
      where: { concluido: true, deletedAt: null, ...(alunoId ? { alunoId } : {}) },
      _count: { _all: true },
    });
    return new Map(grupos.map((grupo) => [grupo.alunoId, grupo._count._all]));
  }

  /** RN-02: mesma agregação de horas de estatísticas (fim IS NOT NULL), por aluno. */
  async minutosPorAluno(alunoId?: string): Promise<Map<string, number>> {
    const grupos = await this.prisma.sessaoEstudo.groupBy({
      by: ['alunoId'],
      where: { fim: { not: null }, deletedAt: null, ...(alunoId ? { alunoId } : {}) },
      _sum: { duracaoMin: true },
    });
    return new Map(grupos.map((grupo) => [grupo.alunoId, grupo._sum.duracaoMin ?? 0]));
  }

  /**
   * Semanas ISO (date_trunc('week') inicia na segunda) com ≥ 5 dias DISTINTOS
   * contendo sessão finalizada, no wall clock do timezone do cronograma ativo
   * de cada aluno (LEFT JOIN cobre todos de uma vez — sem N+1). Coerente com
   * a série temporal de estatísticas (`inicio AT TIME ZONE tz`).
   */
  async semanasConsistentesPorAluno(alunoId?: string): Promise<Map<string, number>> {
    const filtroAluno = alunoId ? Prisma.sql`AND s.aluno_id = ${alunoId}::uuid` : Prisma.empty;
    const linhas = await this.prisma.$queryRaw<{ aluno_id: string; semanas: number }[]>(Prisma.sql`
      SELECT semanal.aluno_id, COUNT(*)::int AS semanas
      FROM (
        SELECT s.aluno_id,
               date_trunc('week', s.inicio AT TIME ZONE COALESCE(c.timezone, ${TIMEZONE_DEFAULT})) AS semana
        FROM sessoes_estudo s
        LEFT JOIN cronogramas c
          ON c.aluno_id = s.aluno_id AND c.ativo AND c.deleted_at IS NULL
        WHERE s.fim IS NOT NULL AND s.deleted_at IS NULL ${filtroAluno}
        GROUP BY s.aluno_id, 2
        HAVING COUNT(DISTINCT (s.inicio AT TIME ZONE COALESCE(c.timezone, ${TIMEZONE_DEFAULT}))::date)
                 >= ${MIN_DIAS_CONSISTENTES}
      ) semanal
      GROUP BY semanal.aluno_id`);
    return new Map(linhas.map((linha) => [linha.aluno_id, linha.semanas]));
  }

  // ----------------------------------------------------------- materialização

  /**
   * UPSERT em lote (ON CONFLICT (aluno_id), decisão do design) num único
   * statement via unnest; `atualizado_em = now()` SEMPRE (CA-07: reflete o
   * horário do último cálculo, mesmo sem mudança de pontos).
   */
  async upsertPontuacoes(pontuacoes: PontuacaoCalculada[]): Promise<void> {
    if (pontuacoes.length === 0) {
      return;
    }
    const alunoIds = pontuacoes.map((p) => p.alunoId);
    const pontos = pontuacoes.map((p) => p.pontos);
    const subtemas = pontuacoes.map((p) => p.subtemasConcluidos);
    const horas = pontuacoes.map((p) => p.horasEstudadas);

    await this.prisma.$executeRaw`
      INSERT INTO pontuacoes_aluno (id, aluno_id, pontos, subtemas_concluidos, horas_estudadas, atualizado_em)
      SELECT gen_random_uuid(), t.aluno_id, t.pontos, t.subtemas_concluidos, t.horas_estudadas, now()
      FROM unnest(
        ${alunoIds}::uuid[],
        ${pontos}::int[],
        ${subtemas}::int[],
        ${horas}::numeric[]
      ) AS t(aluno_id, pontos, subtemas_concluidos, horas_estudadas)
      ON CONFLICT (aluno_id) DO UPDATE SET
        pontos = EXCLUDED.pontos,
        subtemas_concluidos = EXCLUDED.subtemas_concluidos,
        horas_estudadas = EXCLUDED.horas_estudadas,
        atualizado_em = now()`;
  }

  // ------------------------------------------------------------- consultas

  /**
   * Conjunto ordenado do ranking (RN-06: lê SÓ o agregado materializado +
   * joins de escopo, nunca recalcula). LEFT JOIN users → pontuações cobre o
   * caso de borda do aluno ATIVO ainda sem registro (aparece com 0/0/0;
   * atualizado_em nulo vai por último no asc). Ordenação CA-02 com `id asc`
   * como estabilizador final (padrão de paginação estável do projeto);
   * `posicao` = ROW_NUMBER() sobre o conjunto COMPLETO, não só a página.
   */
  private rankingSql(scopeJoin: Prisma.Sql): Prisma.Sql {
    return Prisma.sql`
      SELECT u.id AS aluno_id,
             u.nome,
             COALESCE(p.pontos, 0)::int AS pontos,
             COALESCE(p.subtemas_concluidos, 0)::int AS subtemas_concluidos,
             COALESCE(p.horas_estudadas, 0) AS horas_estudadas,
             ROW_NUMBER() OVER (
               ORDER BY COALESCE(p.pontos, 0) DESC,
                        COALESCE(p.subtemas_concluidos, 0) DESC,
                        p.atualizado_em ASC NULLS LAST,
                        u.id ASC
             )::int AS posicao
      FROM users u
      ${scopeJoin}
      LEFT JOIN pontuacoes_aluno p ON p.aluno_id = u.id
      WHERE u.role = 'ALUNO' AND u.status = 'ATIVO' AND u.deleted_at IS NULL`;
  }

  /** Escopo de turma (CA-04): só matrículas ATIVAS e não soft-deletadas. */
  private matriculaJoin(turmaId: string): Prisma.Sql {
    return Prisma.sql`
      JOIN matriculas m
        ON m.aluno_id = u.id
       AND m.turma_id = ${turmaId}::uuid
       AND m.status = 'ATIVA'
       AND m.deleted_at IS NULL`;
  }

  paginaGlobal(skip: number, take: number): Promise<RankingRow[]> {
    return this.prisma.$queryRaw<RankingRow[]>(Prisma.sql`
      WITH ranking AS (${this.rankingSql(Prisma.empty)})
      SELECT * FROM ranking ORDER BY posicao LIMIT ${take} OFFSET ${skip}`);
  }

  totalGlobal(): Promise<number> {
    return this.prisma.user.count({ where: alunoAtivoWhere });
  }

  paginaTurma(turmaId: string, skip: number, take: number): Promise<RankingRow[]> {
    return this.prisma.$queryRaw<RankingRow[]>(Prisma.sql`
      WITH ranking AS (${this.rankingSql(this.matriculaJoin(turmaId))})
      SELECT * FROM ranking ORDER BY posicao LIMIT ${take} OFFSET ${skip}`);
  }

  totalTurma(turmaId: string): Promise<number> {
    return this.prisma.matricula.count({
      where: {
        turmaId,
        status: MatriculaStatus.ATIVA,
        deletedAt: null,
        aluno: alunoAtivoWhere,
      },
    });
  }

  async posicaoGlobalDoAluno(alunoId: string): Promise<RankingRow | undefined> {
    const linhas = await this.prisma.$queryRaw<RankingRow[]>(Prisma.sql`
      WITH ranking AS (${this.rankingSql(Prisma.empty)})
      SELECT * FROM ranking WHERE aluno_id = ${alunoId}::uuid`);
    return linhas[0];
  }

  /**
   * Posição do aluno em CADA turma onde tem matrícula ATIVA (turmas
   * soft-deleted ficam de fora), numa única query: ROW_NUMBER particionado
   * por turma sobre os mesmos filtros do ranking de turma.
   */
  posicoesPorTurmaDoAluno(alunoId: string): Promise<PosicaoTurmaRow[]> {
    return this.prisma.$queryRaw<PosicaoTurmaRow[]>(Prisma.sql`
      WITH minhas_turmas AS (
        SELECT m.turma_id
        FROM matriculas m
        JOIN turmas t ON t.id = m.turma_id AND t.deleted_at IS NULL
        WHERE m.aluno_id = ${alunoId}::uuid AND m.status = 'ATIVA' AND m.deleted_at IS NULL
      ),
      ranking AS (
        SELECT m.turma_id,
               u.id AS aluno_id,
               ROW_NUMBER() OVER (
                 PARTITION BY m.turma_id
                 ORDER BY COALESCE(p.pontos, 0) DESC,
                          COALESCE(p.subtemas_concluidos, 0) DESC,
                          p.atualizado_em ASC NULLS LAST,
                          u.id ASC
               )::int AS posicao
        FROM matriculas m
        JOIN users u
          ON u.id = m.aluno_id AND u.role = 'ALUNO' AND u.status = 'ATIVO' AND u.deleted_at IS NULL
        LEFT JOIN pontuacoes_aluno p ON p.aluno_id = u.id
        WHERE m.turma_id IN (SELECT turma_id FROM minhas_turmas)
          AND m.status = 'ATIVA' AND m.deleted_at IS NULL
      )
      SELECT r.turma_id, t.nome, r.posicao
      FROM ranking r
      JOIN turmas t ON t.id = r.turma_id
      WHERE r.aluno_id = ${alunoId}::uuid
      ORDER BY t.nome ASC, r.turma_id ASC`);
  }
}
