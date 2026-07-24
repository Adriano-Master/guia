import { randomUUID } from 'node:crypto';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { TurmasAccessService } from '../turmas/turmas-access.service';
import { RankingQueryDto } from './dto/ranking-query.dto';
import { horasParaNumber } from './ranking-response';
import { PontuacaoCalculada, RankingRepository, RankingRow } from './ranking.repository';
import { RankingService } from './ranking.service';

function buildUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return { sub: randomUUID(), role: 'ALUNO', origem: 'PROPRIO', ...overrides };
}

/** ConfigService stub: devolve override quando existir, senão o default pedido. */
function configMock(overrides: Record<string, unknown> = {}): ConfigService {
  return {
    get: (key: string, def?: unknown) => overrides[key] ?? def,
  } as unknown as ConfigService;
}

type RepoMock = { [K in keyof RankingRepository]: jest.Mock };

function repoMock(): RepoMock {
  return {
    alunosAtivosIds: jest.fn().mockResolvedValue([]),
    isAlunoAtivo: jest.fn().mockResolvedValue(true),
    subtemasConcluidosPorAluno: jest.fn().mockResolvedValue(new Map()),
    minutosPorAluno: jest.fn().mockResolvedValue(new Map()),
    semanasConsistentesPorAluno: jest.fn().mockResolvedValue(new Map()),
    upsertPontuacoes: jest.fn().mockResolvedValue(undefined),
    paginaGlobal: jest.fn().mockResolvedValue([]),
    totalGlobal: jest.fn().mockResolvedValue(0),
    paginaTurma: jest.fn().mockResolvedValue([]),
    totalTurma: jest.fn().mockResolvedValue(0),
    posicaoGlobalDoAluno: jest.fn().mockResolvedValue(undefined),
    posicoesPorTurmaDoAluno: jest.fn().mockResolvedValue([]),
  };
}

type AccessMock = {
  loadTurmaOrThrow: jest.Mock;
  assertCanRead: jest.Mock;
};

function accessMock(): AccessMock {
  return {
    loadTurmaOrThrow: jest.fn(),
    assertCanRead: jest.fn().mockResolvedValue(undefined),
  };
}

function buildService(
  repo: RepoMock,
  access: AccessMock = accessMock(),
  config: ConfigService = configMock(),
): RankingService {
  return new RankingService(
    config,
    repo as unknown as RankingRepository,
    access as unknown as TurmasAccessService,
  );
}

function query(page = 1, pageSize = 20): RankingQueryDto {
  const dto = new RankingQueryDto();
  dto.page = page;
  dto.pageSize = pageSize;
  return dto;
}

function upsertArg(repo: RepoMock, callIndex = 0): PontuacaoCalculada[] {
  return repo.upsertPontuacoes.mock.calls[callIndex][0] as PontuacaoCalculada[];
}

// ---------------------------------------------------------------------------
// Helper de serialização
// ---------------------------------------------------------------------------

describe('horasParaNumber (helper)', () => {
  it('numeric do banco (string/Decimal-like) e ausência → number com 2 casas', () => {
    expect(horasParaNumber(undefined)).toBe(0);
    expect(horasParaNumber(null)).toBe(0);
    expect(horasParaNumber('40.00')).toBe(40);
    expect(horasParaNumber('40.98')).toBe(40.98);
    expect(horasParaNumber('0.98')).toBe(0.98);
    // objeto Decimal-like (Prisma.Decimal serializa via toString)
    expect(horasParaNumber({ toString: () => '5.50' })).toBe(5.5);
  });
});

// ---------------------------------------------------------------------------
// Fórmula (CA-01) via recomputarAluno/recomputarTodos
// ---------------------------------------------------------------------------

describe('RankingService — fórmula de pontuação (CA-01)', () => {
  let repo: RepoMock;
  let service: RankingService;
  const alunoId = randomUUID();

  beforeEach(() => {
    repo = repoMock();
    service = buildService(repo);
  });

  function mockInsumos(subtemas: number, minutos: number, semanas: number): void {
    repo.subtemasConcluidosPorAluno.mockResolvedValue(new Map([[alunoId, subtemas]]));
    repo.minutosPorAluno.mockResolvedValue(new Map([[alunoId, minutos]]));
    repo.semanasConsistentesPorAluno.mockResolvedValue(new Map([[alunoId, semanas]]));
  }

  it('exemplo do design: 30 subtemas + 40h + 4 semanas → 10*30 + 5*40 + 50*4 = 700', async () => {
    mockInsumos(30, 40 * 60, 4);

    await service.recomputarAluno(alunoId);

    expect(upsertArg(repo)).toEqual([
      { alunoId, pontos: 700, subtemasConcluidos: 30, horasEstudadas: '40.00' },
    ]);
  });

  it('determinismo (CA-01): mesma entrada em chamadas repetidas → mesmos pontos', async () => {
    mockInsumos(30, 40 * 60, 4);

    await service.recomputarAluno(alunoId);
    await service.recomputarAluno(alunoId);

    expect(repo.upsertPontuacoes).toHaveBeenCalledTimes(2);
    expect(upsertArg(repo, 0)).toEqual(upsertArg(repo, 1));
  });

  it('floor de horas: 59 min → 0 pontos de hora (horas materializadas 0.98)', async () => {
    mockInsumos(0, 59, 0);

    await service.recomputarAluno(alunoId);

    expect(upsertArg(repo)).toEqual([
      { alunoId, pontos: 0, subtemasConcluidos: 0, horasEstudadas: '0.98' },
    ]);
  });

  it('floor de horas: 40.98h (2459 min) → 40*5 = 200 pontos de hora', async () => {
    mockInsumos(0, 2459, 0);

    await service.recomputarAluno(alunoId);

    expect(upsertArg(repo)).toEqual([
      { alunoId, pontos: 200, subtemasConcluidos: 0, horasEstudadas: '40.98' },
    ]);
  });

  it('constantes vêm do env (config): PTS_SUBTEMA/PTS_HORA/PTS_BONUS_SEM customizados', async () => {
    service = buildService(
      repo,
      accessMock(),
      configMock({ PTS_SUBTEMA: 1, PTS_HORA: 2, PTS_BONUS_SEM: 3 }),
    );
    mockInsumos(30, 40 * 60, 4);

    await service.recomputarAluno(alunoId);

    // 1*30 + 2*40 + 3*4 = 122
    expect(upsertArg(repo)[0].pontos).toBe(122);
  });

  it('aluno sem nenhum insumo (fora dos Maps) → 0/0/0.00 pontos 0', async () => {
    repo.alunosAtivosIds.mockResolvedValue([alunoId]);

    const total = await service.recomputarTodos();

    expect(total).toBe(1);
    expect(upsertArg(repo)).toEqual([
      { alunoId, pontos: 0, subtemasConcluidos: 0, horasEstudadas: '0.00' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// recomputarTodos / recomputarAluno — fluxo e RN-05
// ---------------------------------------------------------------------------

describe('RankingService — recomputação', () => {
  let repo: RepoMock;
  let service: RankingService;

  beforeEach(() => {
    repo = repoMock();
    service = buildService(repo);
  });

  it('recomputarTodos: agregações SET-BASED (sem alunoId) e upsert em LOTE de todos os ativos', async () => {
    const a1 = randomUUID();
    const a2 = randomUUID();
    repo.alunosAtivosIds.mockResolvedValue([a1, a2]);
    repo.subtemasConcluidosPorAluno.mockResolvedValue(new Map([[a1, 2]]));
    repo.minutosPorAluno.mockResolvedValue(new Map([[a2, 120]]));

    const total = await service.recomputarTodos();

    expect(total).toBe(2);
    expect(repo.subtemasConcluidosPorAluno).toHaveBeenCalledWith();
    expect(repo.minutosPorAluno).toHaveBeenCalledWith();
    expect(repo.semanasConsistentesPorAluno).toHaveBeenCalledWith();
    expect(repo.upsertPontuacoes).toHaveBeenCalledTimes(1);
    expect(upsertArg(repo)).toEqual([
      { alunoId: a1, pontos: 20, subtemasConcluidos: 2, horasEstudadas: '0.00' },
      { alunoId: a2, pontos: 10, subtemasConcluidos: 0, horasEstudadas: '2.00' },
    ]);
  });

  it('recomputarTodos sem alunos ativos → 0, sem consultar insumos nem upsert', async () => {
    repo.alunosAtivosIds.mockResolvedValue([]);

    const total = await service.recomputarTodos();

    expect(total).toBe(0);
    expect(repo.subtemasConcluidosPorAluno).not.toHaveBeenCalled();
    expect(repo.minutosPorAluno).not.toHaveBeenCalled();
    expect(repo.semanasConsistentesPorAluno).not.toHaveBeenCalled();
    expect(repo.upsertPontuacoes).not.toHaveBeenCalled();
  });

  it('recomputarAluno: agregações ESCOPADAS pelo alunoId', async () => {
    const alunoId = randomUUID();

    await service.recomputarAluno(alunoId);

    expect(repo.isAlunoAtivo).toHaveBeenCalledWith(alunoId);
    expect(repo.subtemasConcluidosPorAluno).toHaveBeenCalledWith(alunoId);
    expect(repo.minutosPorAluno).toHaveBeenCalledWith(alunoId);
    expect(repo.semanasConsistentesPorAluno).toHaveBeenCalledWith(alunoId);
  });

  it('RN-05: recomputarAluno de aluno fora do conjunto (INATIVO/soft-deleted) é NO-OP', async () => {
    repo.isAlunoAtivo.mockResolvedValue(false);

    await service.recomputarAluno(randomUUID());

    expect(repo.subtemasConcluidosPorAluno).not.toHaveBeenCalled();
    expect(repo.minutosPorAluno).not.toHaveBeenCalled();
    expect(repo.semanasConsistentesPorAluno).not.toHaveBeenCalled();
    expect(repo.upsertPontuacoes).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Consultas: global / porTurma / me
// ---------------------------------------------------------------------------

describe('RankingService — consultas', () => {
  let repo: RepoMock;
  let access: AccessMock;
  let service: RankingService;
  const aluno = buildUser();

  function row(overrides: Partial<RankingRow> = {}): RankingRow {
    return {
      aluno_id: randomUUID(),
      nome: 'Ana',
      pontos: 700,
      subtemas_concluidos: 30,
      horas_estudadas: '40.00',
      posicao: 1,
      ...overrides,
    };
  }

  beforeEach(() => {
    repo = repoMock();
    access = accessMock();
    service = buildService(repo, access);
  });

  it('global: skip/take derivados de page/pageSize e envelope {data, page, pageSize, total}', async () => {
    const linha = row();
    repo.paginaGlobal.mockResolvedValue([linha]);
    repo.totalGlobal.mockResolvedValue(137);

    const result = await service.global(query(3, 10));

    expect(repo.paginaGlobal).toHaveBeenCalledWith(20, 10); // (3-1)*10, 10
    expect(result).toEqual({
      data: [
        {
          posicao: 1,
          alunoId: linha.aluno_id,
          nome: 'Ana',
          pontos: 700,
          subtemasConcluidos: 30,
          horasEstudadas: 40,
        },
      ],
      page: 3,
      pageSize: 10,
      total: 137,
    });
  });

  it('porTurma: carrega a turma, valida leitura (CA-05) e pagina pelo id CARREGADO', async () => {
    const turmaId = randomUUID();
    access.loadTurmaOrThrow.mockResolvedValue({ id: turmaId });
    repo.paginaTurma.mockResolvedValue([row()]);
    repo.totalTurma.mockResolvedValue(1);

    const result = await service.porTurma(aluno, turmaId, query(2, 5));

    expect(access.loadTurmaOrThrow).toHaveBeenCalledWith(turmaId);
    expect(access.assertCanRead).toHaveBeenCalledWith({ id: turmaId }, aluno);
    expect(repo.paginaTurma).toHaveBeenCalledWith(turmaId, 5, 5);
    expect(result.total).toBe(1);
  });

  it('porTurma: turma inexistente/soft-deleted → NotFound propagada SEM consultar o ranking', async () => {
    access.loadTurmaOrThrow.mockRejectedValue(new NotFoundException('Turma não encontrada.'));

    await expect(service.porTurma(aluno, randomUUID(), query())).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repo.paginaTurma).not.toHaveBeenCalled();
    expect(repo.totalTurma).not.toHaveBeenCalled();
  });

  it('porTurma: sem matrícula ATIVA / não-professor → Forbidden propagada (CA-05)', async () => {
    access.loadTurmaOrThrow.mockResolvedValue({ id: randomUUID() });
    access.assertCanRead.mockRejectedValue(new ForbiddenException('Acesso negado a esta turma.'));

    await expect(service.porTurma(aluno, randomUUID(), query())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repo.paginaTurma).not.toHaveBeenCalled();
  });

  describe('me — composição derivada (CA-06)', () => {
    it('700 = 300 subtemas + 200 horas + 200 bônus → 4 semanas', async () => {
      repo.posicaoGlobalDoAluno.mockResolvedValue(
        row({ aluno_id: aluno.sub, pontos: 700, subtemas_concluidos: 30, horas_estudadas: '40.00', posicao: 2 }),
      );
      const turmaId = randomUUID();
      repo.posicoesPorTurmaDoAluno.mockResolvedValue([
        { turma_id: turmaId, nome: 'Turma Alfa', posicao: 5 },
      ]);

      const result = await service.me(aluno);

      expect(result).toEqual({
        posicaoGlobal: 2,
        pontos: 700,
        subtemasConcluidos: 30,
        horasEstudadas: 40,
        semanasConsistentes: 4,
        composicao: { pontosSubtemas: 300, pontosHoras: 200, pontosBonus: 200 },
        turmas: [{ turmaId, nome: 'Turma Alfa', posicao: 5 }],
      });
      expect(repo.posicaoGlobalDoAluno).toHaveBeenCalledWith(aluno.sub);
      expect(repo.posicoesPorTurmaDoAluno).toHaveBeenCalledWith(aluno.sub);
    });

    it('horas fracionárias usam floor na derivação: 40.98h → pontosHoras 200', async () => {
      // pontos materializados: 10*30 + 5*40 + 50*4 = 700
      repo.posicaoGlobalDoAluno.mockResolvedValue(
        row({ pontos: 700, subtemas_concluidos: 30, horas_estudadas: '40.98' }),
      );

      const result = await service.me(aluno);

      expect(result.horasEstudadas).toBe(40.98);
      expect(result.composicao).toEqual({ pontosSubtemas: 300, pontosHoras: 200, pontosBonus: 200 });
      expect(result.semanasConsistentes).toBe(4);
    });

    it('clamp: derivação maior que os pontos materializados → pontosBonus 0 (nunca negativo)', async () => {
      // constantes mudaram desde a última recomputação: 100 − 10*30 − 0 < 0
      repo.posicaoGlobalDoAluno.mockResolvedValue(
        row({ pontos: 100, subtemas_concluidos: 30, horas_estudadas: '0.00' }),
      );

      const result = await service.me(aluno);

      expect(result.composicao).toEqual({ pontosSubtemas: 300, pontosHoras: 0, pontosBonus: 0 });
      expect(result.semanasConsistentes).toBe(0);
    });

    it('semanas = pontosBonus / PTS_BONUS_SEM (floor de resto parcial)', async () => {
      // bonus = 470 − 100 − 250 = 120 → floor(120/50) = 2 semanas
      repo.posicaoGlobalDoAluno.mockResolvedValue(
        row({ pontos: 470, subtemas_concluidos: 10, horas_estudadas: '50.00' }),
      );

      const result = await service.me(aluno);

      expect(result.composicao.pontosBonus).toBe(120);
      expect(result.semanasConsistentes).toBe(2);
    });

    it('PTS_BONUS_SEM=0 → semanas 0 (sem divisão por zero)', async () => {
      service = buildService(repo, access, configMock({ PTS_BONUS_SEM: 0 }));
      repo.posicaoGlobalDoAluno.mockResolvedValue(
        row({ pontos: 999, subtemas_concluidos: 0, horas_estudadas: '0.00' }),
      );

      const result = await service.me(aluno);

      expect(result.semanasConsistentes).toBe(0);
      expect(result.composicao.pontosBonus).toBe(999);
    });

    it('aluno fora do conjunto do ranking (linha ausente) → posicaoGlobal null e tudo 0', async () => {
      repo.posicaoGlobalDoAluno.mockResolvedValue(undefined);
      repo.posicoesPorTurmaDoAluno.mockResolvedValue([]);

      const result = await service.me(aluno);

      expect(result).toEqual({
        posicaoGlobal: null,
        pontos: 0,
        subtemasConcluidos: 0,
        horasEstudadas: 0,
        semanasConsistentes: 0,
        composicao: { pontosSubtemas: 0, pontosHoras: 0, pontosBonus: 0 },
        turmas: [],
      });
    });
  });
});
