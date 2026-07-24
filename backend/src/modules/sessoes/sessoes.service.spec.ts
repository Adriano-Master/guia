import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Plano, Prisma, SessaoEstudo } from '@prisma/client';
import { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { PrismaService } from '../../prisma/prisma.service';
import { PlanosAccessService } from '../planos/planos-access.service';
import { SessoesService } from './sessoes.service';

/** Instante fixo: os cálculos de stop/data manual usam fake timers. */
const SYSTEM_NOW = new Date('2026-07-06T12:00:00Z');
const NOW = SYSTEM_NOW;

const MS_POR_MIN = 60_000;

function buildUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return { sub: randomUUID(), role: 'ALUNO', origem: 'PROPRIO', ...overrides };
}

function buildPlano(overrides: Partial<Plano> = {}): Plano {
  return {
    id: randomUUID(),
    titulo: 'Analista TRF',
    descricao: null,
    tipo: 'OFICIAL',
    autorId: randomUUID(),
    planoOrigemId: null,
    publicado: true,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

function getDetails(caught: unknown): Array<{ field: string; issue: string }> {
  expect(caught).toBeInstanceOf(UnprocessableEntityException);
  const body = (caught as UnprocessableEntityException).getResponse() as {
    details: Array<{ field: string; issue: string }>;
  };
  return body.details;
}

type ModelMock = {
  findUnique: jest.Mock;
  findFirst: jest.Mock;
  findMany: jest.Mock;
  count: jest.Mock;
  create: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
};

function modelMock(): ModelMock {
  return {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
}

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('SessoesService (unit)', () => {
  let prisma: {
    sessaoEstudo: ModelMock;
    disciplina: ModelMock;
    subtema: ModelMock;
    blocoCronograma: ModelMock;
    turmaPlano: ModelMock;
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
  };
  let service: SessoesService;

  const aluno = buildUser();
  const outroAluno = buildUser();

  const disciplinaId = randomUUID();
  const outraDisciplinaId = randomUUID();
  const subtemaId = randomUUID();
  const blocoId = randomUUID();

  function buildSessao(overrides: Partial<SessaoEstudo> = {}): SessaoEstudo {
    return {
      id: randomUUID(),
      alunoId: aluno.sub,
      disciplinaId,
      subtemaId: null,
      blocoId: null,
      origem: 'CRONOMETRO',
      inicio: NOW,
      fim: null,
      duracaoMin: 0,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
      ...overrides,
    };
  }

  function mockDisciplinaValida(plano: Plano = buildPlano()): void {
    prisma.disciplina.findUnique.mockResolvedValue({
      id: disciplinaId,
      deletedAt: null,
      plano,
    });
  }

  function mockSubtemaDe(discId: string): void {
    prisma.subtema.findUnique.mockResolvedValue({
      id: subtemaId,
      deletedAt: null,
      tema: { id: randomUUID(), deletedAt: null, disciplinaId: discId },
    });
  }

  function mockBloco(overrides: Record<string, unknown> = {}): void {
    prisma.blocoCronograma.findUnique.mockResolvedValue({
      id: blocoId,
      disciplinaId,
      deletedAt: null,
      cronograma: { id: randomUUID(), alunoId: aluno.sub, deletedAt: null },
      ...overrides,
    });
  }

  beforeEach(() => {
    jest.useFakeTimers({ now: SYSTEM_NOW });
    prisma = {
      sessaoEstudo: modelMock(),
      disciplina: modelMock(),
      subtema: modelMock(),
      blocoCronograma: modelMock(),
      turmaPlano: modelMock(),
      $transaction: jest.fn(
        (arg: unknown): Promise<unknown> =>
          Array.isArray(arg)
            ? Promise.all(arg)
            : (arg as (tx: unknown) => Promise<unknown>)(prisma),
      ),
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    service = new SessoesService(
      prisma as unknown as PrismaService,
      new PlanosAccessService(prisma as unknown as PrismaService),
    );

    // Defaults do caminho feliz (cada teste sobrescreve o que precisar):
    // OFICIAL publicado legível pelo aluno via vínculo TurmaPlano + matrícula
    // ATIVA (regra de matrícula do PlanosAccessService).
    mockDisciplinaValida();
    prisma.turmaPlano.findFirst.mockResolvedValue({ id: randomUUID() });
    prisma.sessaoEstudo.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve(buildSessao(data as Partial<SessaoEstudo>)),
    );
    prisma.sessaoEstudo.update.mockImplementation(
      ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
        Promise.resolve(buildSessao({ id: where.id, ...(data as Partial<SessaoEstudo>) })),
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // startCronometro — CA-1, CA-2, RN-1, CB-5
  // ---------------------------------------------------------------------------

  describe('startCronometro', () => {
    it('cria sessão CRONOMETRO com inicio=now, fim=null, duracaoMin=0, estado RUNNING (CA-1)', async () => {
      const result = await service.startCronometro(aluno, { disciplinaId });

      expect(prisma.sessaoEstudo.create).toHaveBeenCalledWith({
        data: {
          alunoId: aluno.sub,
          disciplinaId,
          subtemaId: null,
          blocoId: null,
          origem: 'CRONOMETRO',
          inicio: SYSTEM_NOW,
        },
      });
      expect(result).toMatchObject({
        origem: 'CRONOMETRO',
        fim: null,
        duracaoMin: 0,
        estado: 'RUNNING',
        inicio: SYSTEM_NOW.toISOString(),
      });
    });

    it('propaga subtemaId e blocoId válidos para a criação', async () => {
      mockSubtemaDe(disciplinaId);
      mockBloco();

      const result = await service.startCronometro(aluno, { disciplinaId, subtemaId, blocoId });

      expect(prisma.sessaoEstudo.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ subtemaId, blocoId }),
      });
      expect(result).toMatchObject({ subtemaId, blocoId });
    });

    it('cronômetro já em andamento (lock FOR UPDATE encontra linha) → 409 e NÃO cria (RN-1, CA-2)', async () => {
      prisma.$queryRaw.mockResolvedValue([{ id: randomUUID() }]);

      await expect(service.startCronometro(aluno, { disciplinaId })).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.sessaoEstudo.create).not.toHaveBeenCalled();
    });

    it('corrida: P2002 do índice único parcial no INSERT → 409 CONFLICT (CB-5)', async () => {
      prisma.sessaoEstudo.create.mockRejectedValue(p2002());

      await expect(service.startCronometro(aluno, { disciplinaId })).rejects.toThrow(
        ConflictException,
      );
    });

    it('erro que não é P2002 propaga sem virar 409', async () => {
      prisma.sessaoEstudo.create.mockRejectedValue(new Error('conexão caiu'));

      await expect(service.startCronometro(aluno, { disciplinaId })).rejects.toThrow(
        'conexão caiu',
      );
    });

    it('REGRESSÃO review: validações e INSERT do start usam o client TRANSACIONAL (tx), nunca o pool', async () => {
      // tx distinto do prisma: se o service usar this.prisma dentro da
      // transação (bug antigo — risco de exaustão de pool sob concorrência),
      // as chamadas caem no mock errado e o teste falha.
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        disciplina: modelMock(),
        subtema: modelMock(),
        blocoCronograma: modelMock(),
        sessaoEstudo: modelMock(),
      };
      tx.disciplina.findUnique.mockResolvedValue({
        id: disciplinaId,
        deletedAt: null,
        plano: buildPlano(),
      });
      tx.subtema.findUnique.mockResolvedValue({
        id: subtemaId,
        deletedAt: null,
        tema: { id: randomUUID(), deletedAt: null, disciplinaId },
      });
      tx.blocoCronograma.findUnique.mockResolvedValue({
        id: blocoId,
        disciplinaId,
        deletedAt: null,
        cronograma: { id: randomUUID(), alunoId: aluno.sub, deletedAt: null },
      });
      tx.sessaoEstudo.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(buildSessao(data as Partial<SessaoEstudo>)),
      );
      prisma.$transaction.mockImplementation((cb: (t: unknown) => Promise<unknown>) => cb(tx));

      const result = await service.startCronometro(aluno, { disciplinaId, subtemaId, blocoId });
      expect(result).toMatchObject({ estado: 'RUNNING', subtemaId, blocoId });

      // Tudo dentro da transação passou pelo tx…
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(tx.disciplina.findUnique).toHaveBeenCalledTimes(1);
      expect(tx.subtema.findUnique).toHaveBeenCalledTimes(1);
      expect(tx.blocoCronograma.findUnique).toHaveBeenCalledTimes(1);
      expect(tx.sessaoEstudo.create).toHaveBeenCalledTimes(1);
      // …e NADA pelo client do pool (this.prisma)
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(prisma.disciplina.findUnique).not.toHaveBeenCalled();
      expect(prisma.subtema.findUnique).not.toHaveBeenCalled();
      expect(prisma.blocoCronograma.findUnique).not.toHaveBeenCalled();
      expect(prisma.sessaoEstudo.create).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Coerência de referências — CA-8, CA-9, CB-6, RN-4 (422 com details)
  // ---------------------------------------------------------------------------

  describe('validação de referências (start e manual compartilham)', () => {
    async function esperarDetalhe(
      acao: () => Promise<unknown>,
      detalhe: { field: string; issue: string | RegExp },
    ): Promise<void> {
      let caught: unknown;
      try {
        await acao();
      } catch (error) {
        caught = error;
      }
      const details = getDetails(caught);
      expect(details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: detalhe.field,
            issue:
              detalhe.issue instanceof RegExp
                ? expect.stringMatching(detalhe.issue)
                : detalhe.issue,
          }),
        ]),
      );
      expect(prisma.sessaoEstudo.create).not.toHaveBeenCalled();
    }

    it('disciplina inexistente → 422 (RN-4)', async () => {
      prisma.disciplina.findUnique.mockResolvedValue(null);
      await esperarDetalhe(() => service.startCronometro(aluno, { disciplinaId }), {
        field: 'disciplinaId',
        issue: 'disciplina inexistente',
      });
    });

    it('disciplina soft-deletada ou de plano soft-deletado → 422', async () => {
      prisma.disciplina.findUnique.mockResolvedValue({
        id: disciplinaId,
        deletedAt: NOW,
        plano: buildPlano(),
      });
      await esperarDetalhe(() => service.startCronometro(aluno, { disciplinaId }), {
        field: 'disciplinaId',
        issue: 'disciplina inexistente',
      });

      prisma.disciplina.findUnique.mockResolvedValue({
        id: disciplinaId,
        deletedAt: null,
        plano: buildPlano({ deletedAt: NOW }),
      });
      await esperarDetalhe(() => service.startCronometro(aluno, { disciplinaId }), {
        field: 'disciplinaId',
        issue: 'disciplina inexistente',
      });
    });

    it('disciplina de plano PESSOAL de outro aluno → 422 (RN-4 provisória)', async () => {
      mockDisciplinaValida(
        buildPlano({ tipo: 'PESSOAL', publicado: false, autorId: outroAluno.sub }),
      );
      await esperarDetalhe(() => service.startCronometro(aluno, { disciplinaId }), {
        field: 'disciplinaId',
        issue: /plano acessível/,
      });
    });

    it('disciplina de plano OFICIAL não publicado → 422', async () => {
      mockDisciplinaValida(buildPlano({ publicado: false }));
      await esperarDetalhe(() => service.startCronometro(aluno, { disciplinaId }), {
        field: 'disciplinaId',
        issue: /plano acessível/,
      });
    });

    it('subtema inexistente → 422 (CB-6)', async () => {
      prisma.subtema.findUnique.mockResolvedValue(null);
      await esperarDetalhe(() => service.startCronometro(aluno, { disciplinaId, subtemaId }), {
        field: 'subtemaId',
        issue: 'subtema inexistente',
      });
    });

    it('subtema de OUTRA disciplina → 422 (CA-8)', async () => {
      mockSubtemaDe(outraDisciplinaId);
      await esperarDetalhe(() => service.startCronometro(aluno, { disciplinaId, subtemaId }), {
        field: 'subtemaId',
        issue: 'subtema deve pertencer à disciplina informada',
      });
    });

    it('bloco inexistente → 422 (CB-6)', async () => {
      prisma.blocoCronograma.findUnique.mockResolvedValue(null);
      await esperarDetalhe(() => service.startCronometro(aluno, { disciplinaId, blocoId }), {
        field: 'blocoId',
        issue: 'bloco inexistente',
      });
    });

    it('bloco de cronograma de OUTRO aluno → 422 (CA-9)', async () => {
      mockBloco({ cronograma: { id: randomUUID(), alunoId: outroAluno.sub, deletedAt: null } });
      await esperarDetalhe(() => service.startCronometro(aluno, { disciplinaId, blocoId }), {
        field: 'blocoId',
        issue: 'bloco deve pertencer a um cronograma do próprio aluno',
      });
    });

    it('bloco com disciplina divergente da sessão → 422 (CA-9)', async () => {
      mockBloco({ disciplinaId: outraDisciplinaId });
      await esperarDetalhe(() => service.startCronometro(aluno, { disciplinaId, blocoId }), {
        field: 'blocoId',
        issue: 'bloco deve ter a mesma disciplina da sessão',
      });
    });

    it('registro manual valida as mesmas referências (subtema divergente → 422)', async () => {
      mockSubtemaDe(outraDisciplinaId);
      await esperarDetalhe(
        () =>
          service.registrarManual(aluno, {
            disciplinaId,
            subtemaId,
            data: '2026-07-01',
            duracaoMin: 45,
          }),
        { field: 'subtemaId', issue: 'subtema deve pertencer à disciplina informada' },
      );
    });

    it('acumula múltiplos details num único 422', async () => {
      prisma.subtema.findUnique.mockResolvedValue(null);
      prisma.blocoCronograma.findUnique.mockResolvedValue(null);

      let caught: unknown;
      try {
        await service.startCronometro(aluno, { disciplinaId, subtemaId, blocoId });
      } catch (error) {
        caught = error;
      }
      const details = getDetails(caught);
      expect(details).toHaveLength(2);
      expect(details.map((d) => d.field).sort()).toEqual(['blocoId', 'subtemaId']);
    });
  });

  // ---------------------------------------------------------------------------
  // Máquina de estados — CA-4, CB-1, CB-3
  // ---------------------------------------------------------------------------

  describe('máquina de estados (getAtiva/pause/resume)', () => {
    it('getAtiva sem cronômetro em andamento → 404 (CB-3/decisão do projeto)', async () => {
      prisma.sessaoEstudo.findFirst.mockResolvedValue(null);
      await expect(service.getAtiva(aluno)).rejects.toThrow(NotFoundException);
      expect(prisma.sessaoEstudo.findFirst).toHaveBeenCalledWith({
        where: { alunoId: aluno.sub, origem: 'CRONOMETRO', fim: null, deletedAt: null },
      });
    });

    it('pause/resume/stop/discard sem cronômetro em andamento → 404 (CB-1)', async () => {
      prisma.sessaoEstudo.findFirst.mockResolvedValue(null);
      await expect(service.pause(aluno)).rejects.toThrow(NotFoundException);
      await expect(service.resume(aluno)).rejects.toThrow(NotFoundException);
      await expect(service.stop(aluno, {})).rejects.toThrow(NotFoundException);
      await expect(service.discard(aluno)).rejects.toThrow(NotFoundException);
    });

    it('RUNNING → pause → PAUSED → resume → RUNNING, refletido em getAtiva (CA-4)', async () => {
      const sessao = buildSessao();
      prisma.sessaoEstudo.findFirst.mockResolvedValue(sessao);

      await expect(service.getAtiva(aluno)).resolves.toMatchObject({ estado: 'RUNNING' });

      const pausada = await service.pause(aluno);
      expect(pausada.estado).toBe('PAUSED');
      await expect(service.getAtiva(aluno)).resolves.toMatchObject({ estado: 'PAUSED' });

      const retomada = await service.resume(aluno);
      expect(retomada.estado).toBe('RUNNING');
      await expect(service.getAtiva(aluno)).resolves.toMatchObject({ estado: 'RUNNING' });
    });

    it('pause em sessão já pausada → 409 (CA-4)', async () => {
      prisma.sessaoEstudo.findFirst.mockResolvedValue(buildSessao());
      await service.pause(aluno);
      await expect(service.pause(aluno)).rejects.toThrow(ConflictException);
    });

    it('resume em sessão não pausada → 409 (CA-4)', async () => {
      prisma.sessaoEstudo.findFirst.mockResolvedValue(buildSessao());
      await expect(service.resume(aluno)).rejects.toThrow(ConflictException);
    });

    it('discard remove a sessão com DELETE físico e limpa o estado de pausa (CA-5)', async () => {
      const sessao = buildSessao();
      prisma.sessaoEstudo.findFirst.mockResolvedValue(sessao);
      prisma.sessaoEstudo.delete.mockResolvedValue(sessao);

      await service.pause(aluno);
      await service.discard(aluno);

      expect(prisma.sessaoEstudo.delete).toHaveBeenCalledWith({ where: { id: sessao.id } });
      expect(prisma.sessaoEstudo.update).not.toHaveBeenCalled(); // não é soft delete

      // Estado de pausa foi limpo: nova sessão com o mesmo id reporta RUNNING
      await expect(service.getAtiva(aluno)).resolves.toMatchObject({ estado: 'RUNNING' });
    });
  });

  // ---------------------------------------------------------------------------
  // stop — RN-2, RN-6, D-4, CA-3
  // ---------------------------------------------------------------------------

  describe('stop — cálculo de duracaoMin', () => {
    function mockAtivaIniciadaHa(msAtras: number): SessaoEstudo {
      const sessao = buildSessao({ inicio: new Date(SYSTEM_NOW.getTime() - msAtras) });
      prisma.sessaoEstudo.findFirst.mockResolvedValue(sessao);
      return sessao;
    }

    it('62 min decorridos, sem pausa → duracaoMin 62, fim=now, estado STOPPED (CA-3)', async () => {
      const sessao = mockAtivaIniciadaHa(62 * MS_POR_MIN);

      const result = await service.stop(aluno, {});

      expect(prisma.sessaoEstudo.update).toHaveBeenCalledWith({
        where: { id: sessao.id },
        data: { fim: SYSTEM_NOW, duracaoMin: 62 },
      });
      expect(result).toMatchObject({
        duracaoMin: 62,
        fim: SYSTEM_NOW.toISOString(),
        estado: 'STOPPED',
      });
    });

    it('62 min decorridos com pausaMin=3 → 59 (RN-6, desconto de pausa)', async () => {
      mockAtivaIniciadaHa(62 * MS_POR_MIN);
      const result = await service.stop(aluno, { pausaMin: 3 });
      expect(result.duracaoMin).toBe(59);
    });

    it('90 s decorridos (1,5 min) → arredonda para 2 (D-4, round half up)', async () => {
      mockAtivaIniciadaHa(90 * 1000);
      const result = await service.stop(aluno, { pausaMin: 0 });
      expect(result.duracaoMin).toBe(2);
    });

    it('89 s decorridos (~1,48 min) → arredonda para 1', async () => {
      mockAtivaIniciadaHa(89 * 1000);
      const result = await service.stop(aluno, {});
      expect(result.duracaoMin).toBe(1);
    });

    it('bruto 20 s (round daria 0) com pausa 0 → piso 1 pois houve tempo > 0 (CA-3)', async () => {
      mockAtivaIniciadaHa(20 * 1000);
      const result = await service.stop(aluno, { pausaMin: 0 });
      expect(result.duracaoMin).toBe(1);
    });

    it('pausaMin ≥ decorrido (clamp): 10 min decorridos, pausa 15 → 1, nunca negativo', async () => {
      mockAtivaIniciadaHa(10 * MS_POR_MIN);
      const result = await service.stop(aluno, { pausaMin: 15 });
      expect(result.duracaoMin).toBe(1);
    });

    it('pausaMin igual ao decorrido → 1 (houve tempo bruto > 0)', async () => {
      mockAtivaIniciadaHa(30 * MS_POR_MIN);
      const result = await service.stop(aluno, { pausaMin: 30 });
      expect(result.duracaoMin).toBe(1);
    });

    it('REGRESSÃO review: corrida stop × discard — P2025 no update → 404, não 500', async () => {
      mockAtivaIniciadaHa(10 * MS_POR_MIN);
      // Um discard concorrente hard-deletou a linha entre o findFirst e o update
      prisma.sessaoEstudo.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record to update not found.', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      );

      await expect(service.stop(aluno, { pausaMin: 0 })).rejects.toThrow(NotFoundException);
    });

    it('erro do update que não é P2025 propaga (não vira 404)', async () => {
      mockAtivaIniciadaHa(10 * MS_POR_MIN);
      prisma.sessaoEstudo.update.mockRejectedValue(new Error('conexão caiu'));

      await expect(service.stop(aluno, { pausaMin: 0 })).rejects.toThrow('conexão caiu');
    });

    it('stop de sessão pausada finaliza e limpa o estado de pausa', async () => {
      const sessao = mockAtivaIniciadaHa(45 * MS_POR_MIN);
      await service.pause(aluno);

      const result = await service.stop(aluno, { pausaMin: 5 });
      expect(result).toMatchObject({ duracaoMin: 40, estado: 'STOPPED' });

      // pausas limpo: mesma id ativa de novo reportaria RUNNING
      prisma.sessaoEstudo.findFirst.mockResolvedValue(sessao);
      await expect(service.getAtiva(aluno)).resolves.toMatchObject({ estado: 'RUNNING' });
    });
  });

  // ---------------------------------------------------------------------------
  // registrarManual — CA-6, CA-7 (DTO), CB-4, RN-2
  // ---------------------------------------------------------------------------

  describe('registrarManual', () => {
    it('cria sessão MANUAL com inicio=data@00:00Z e fim=inicio+duracaoMin (CA-6, RN-2)', async () => {
      const result = await service.registrarManual(aluno, {
        disciplinaId,
        data: '2026-07-01',
        duracaoMin: 45,
      });

      expect(prisma.sessaoEstudo.create).toHaveBeenCalledWith({
        data: {
          alunoId: aluno.sub,
          disciplinaId,
          subtemaId: null,
          blocoId: null,
          origem: 'MANUAL',
          inicio: new Date('2026-07-01T00:00:00Z'),
          fim: new Date('2026-07-01T00:45:00Z'),
          duracaoMin: 45,
        },
      });
      expect(result).toMatchObject({
        origem: 'MANUAL',
        inicio: '2026-07-01T00:00:00.000Z',
        fim: '2026-07-01T00:45:00.000Z',
        duracaoMin: 45,
        estado: 'STOPPED',
      });
    });

    it('data = hoje (UTC) é aceita (CB-4)', async () => {
      await expect(
        service.registrarManual(aluno, { disciplinaId, data: '2026-07-06', duracaoMin: 30 }),
      ).resolves.toMatchObject({ duracaoMin: 30 });
    });

    it('data = amanhã em UTC mas ainda "hoje" em UTC+14 é aceita (folga de TZ)', async () => {
      // now = 2026-07-06T12:00Z → em UTC+14 já é 2026-07-07
      await expect(
        service.registrarManual(aluno, { disciplinaId, data: '2026-07-07', duracaoMin: 30 }),
      ).resolves.toMatchObject({ duracaoMin: 30 });
    });

    it('data futura real (além da folga UTC+14) → 422 (CB-4)', async () => {
      let caught: unknown;
      try {
        await service.registrarManual(aluno, {
          disciplinaId,
          data: '2026-07-08',
          duracaoMin: 30,
        });
      } catch (error) {
        caught = error;
      }
      expect(getDetails(caught)).toEqual([
        { field: 'data', issue: 'data não pode ser futura' },
      ]);
      expect(prisma.sessaoEstudo.create).not.toHaveBeenCalled();
    });

    it('data de calendário inválida (2026-02-30) → 422', async () => {
      let caught: unknown;
      try {
        await service.registrarManual(aluno, {
          disciplinaId,
          data: '2026-02-30',
          duracaoMin: 30,
        });
      } catch (error) {
        caught = error;
      }
      expect(getDetails(caught)).toEqual([
        { field: 'data', issue: 'data deve ser uma data de calendário válida' },
      ]);
      expect(prisma.sessaoEstudo.create).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Escopo por dono — CA-10, RN-3
  // ---------------------------------------------------------------------------

  describe('escopo por dono (getById/update/remove)', () => {
    const id = randomUUID();

    it('sessão inexistente ou soft-deletada → 404', async () => {
      prisma.sessaoEstudo.findUnique.mockResolvedValue(null);
      await expect(service.getById(aluno, id)).rejects.toThrow(NotFoundException);

      prisma.sessaoEstudo.findUnique.mockResolvedValue(buildSessao({ id, deletedAt: NOW }));
      await expect(service.getById(aluno, id)).rejects.toThrow(NotFoundException);
    });

    it('sessão de OUTRO aluno → 403 em get/update/remove, sem alterar nada (CA-10)', async () => {
      prisma.sessaoEstudo.findUnique.mockResolvedValue(
        buildSessao({ id, alunoId: outroAluno.sub, fim: NOW, duracaoMin: 30 }),
      );

      await expect(service.getById(aluno, id)).rejects.toThrow(ForbiddenException);
      await expect(service.update(aluno, id, { duracaoMin: 10 })).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.remove(aluno, id)).rejects.toThrow(ForbiddenException);
      expect(prisma.sessaoEstudo.update).not.toHaveBeenCalled();
      expect(prisma.sessaoEstudo.delete).not.toHaveBeenCalled();
    });

    it('dono lê a própria sessão finalizada com estado STOPPED', async () => {
      prisma.sessaoEstudo.findUnique.mockResolvedValue(
        buildSessao({ id, fim: NOW, duracaoMin: 50 }),
      );
      await expect(service.getById(aluno, id)).resolves.toMatchObject({
        id,
        duracaoMin: 50,
        estado: 'STOPPED',
      });
    });

    it('remove de sessão FINALIZADA é SOFT delete: update com deletedAt, nunca delete físico', async () => {
      prisma.sessaoEstudo.findUnique.mockResolvedValue(
        buildSessao({ id, fim: NOW, duracaoMin: 30 }),
      );

      await service.remove(aluno, id);

      expect(prisma.sessaoEstudo.update).toHaveBeenCalledWith({
        where: { id },
        data: { deletedAt: SYSTEM_NOW },
      });
      expect(prisma.sessaoEstudo.delete).not.toHaveBeenCalled();
    });

    it('REGRESSÃO review: remove de cronômetro EM ANDAMENTO (fim=null) → 409, sem linha zumbi', async () => {
      prisma.sessaoEstudo.findUnique.mockResolvedValue(buildSessao({ id, fim: null }));

      await expect(service.remove(aluno, id)).rejects.toThrow(ConflictException);
      // Nem soft delete nem hard delete: o caminho legítimo é DELETE /sessoes/ativa
      expect(prisma.sessaoEstudo.update).not.toHaveBeenCalled();
      expect(prisma.sessaoEstudo.delete).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // update (PATCH) — RN-7
  // ---------------------------------------------------------------------------

  describe('update — correções pós-registro (RN-7)', () => {
    const id = randomUUID();

    it('sessão em andamento (fim=null) → 409, nada é atualizado', async () => {
      prisma.sessaoEstudo.findUnique.mockResolvedValue(buildSessao({ id, fim: null }));

      await expect(service.update(aluno, id, { duracaoMin: 10 })).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.sessaoEstudo.update).not.toHaveBeenCalled();
    });

    it('corrige duracaoMin de sessão finalizada', async () => {
      prisma.sessaoEstudo.findUnique.mockResolvedValue(
        buildSessao({ id, fim: NOW, duracaoMin: 50 }),
      );

      const result = await service.update(aluno, id, { duracaoMin: 42 });

      expect(prisma.sessaoEstudo.update).toHaveBeenCalledWith({
        where: { id },
        data: { duracaoMin: 42 },
      });
      expect(result.duracaoMin).toBe(42);
    });

    it('corrige subtemaId validando pertencimento à disciplina da sessão', async () => {
      prisma.sessaoEstudo.findUnique.mockResolvedValue(
        buildSessao({ id, fim: NOW, duracaoMin: 50 }),
      );
      mockSubtemaDe(disciplinaId);

      await service.update(aluno, id, { subtemaId });

      expect(prisma.sessaoEstudo.update).toHaveBeenCalledWith({
        where: { id },
        data: { subtemaId },
      });
    });

    it('subtemaId de outra disciplina no PATCH → 422 (CA-8 no update)', async () => {
      prisma.sessaoEstudo.findUnique.mockResolvedValue(
        buildSessao({ id, fim: NOW, duracaoMin: 50 }),
      );
      mockSubtemaDe(outraDisciplinaId);

      let caught: unknown;
      try {
        await service.update(aluno, id, { subtemaId });
      } catch (error) {
        caught = error;
      }
      expect(getDetails(caught)).toEqual([
        { field: 'subtemaId', issue: 'subtema deve pertencer à disciplina informada' },
      ]);
      expect(prisma.sessaoEstudo.update).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // list — CA-11
  // ---------------------------------------------------------------------------

  describe('list — filtros, paginação e ordenação (CA-11)', () => {
    beforeEach(() => {
      prisma.sessaoEstudo.findMany.mockResolvedValue([]);
      prisma.sessaoEstudo.count.mockResolvedValue(0);
    });

    it('escopa ao aluno autenticado, exclui soft-deletadas e ordena por -inicio (default)', async () => {
      await service.list(aluno, { page: 1, pageSize: 20 });

      expect(prisma.sessaoEstudo.findMany).toHaveBeenCalledWith({
        where: { alunoId: aluno.sub, deletedAt: null },
        // Desempate estável (code review): manuais do mesmo dia empatam em
        // `inicio` (00:00Z) e flutuariam entre páginas sem ordem total.
        orderBy: [{ inicio: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
        skip: 0,
        take: 20,
      });
      expect(prisma.sessaoEstudo.count).toHaveBeenCalledWith({
        where: { alunoId: aluno.sub, deletedAt: null },
      });
    });

    it('aplica filtro disciplinaId e from/to com `to` EXCLUSIVO (lt)', async () => {
      await service.list(aluno, {
        page: 1,
        pageSize: 20,
        disciplinaId,
        from: '2026-07-01T00:00:00Z',
        to: '2026-07-08T00:00:00Z',
      });

      expect(prisma.sessaoEstudo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            alunoId: aluno.sub,
            deletedAt: null,
            disciplinaId,
            inicio: {
              gte: new Date('2026-07-01T00:00:00Z'),
              lt: new Date('2026-07-08T00:00:00Z'),
            },
          },
        }),
      );
    });

    it('sort da allowlist (duracaoMin asc) e paginação page=3/pageSize=10 → skip=20', async () => {
      await service.list(aluno, { page: 3, pageSize: 10, sort: 'duracaoMin' });

      expect(prisma.sessaoEstudo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ duracaoMin: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }],
          skip: 20,
          take: 10,
        }),
      );
    });

    it('sort fora da allowlist → 422 sem tocar o banco', async () => {
      await expect(
        service.list(aluno, { page: 1, pageSize: 20, sort: 'alunoId' }),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(prisma.sessaoEstudo.findMany).not.toHaveBeenCalled();
    });

    it('retorna envelope paginado {data,page,pageSize,total} com estados derivados', async () => {
      const finalizada = buildSessao({ fim: NOW, duracaoMin: 45 });
      const rodando = buildSessao();
      prisma.sessaoEstudo.findMany.mockResolvedValue([rodando, finalizada]);
      prisma.sessaoEstudo.count.mockResolvedValue(7);

      const result = await service.list(aluno, { page: 1, pageSize: 2 });

      expect(result).toMatchObject({ page: 1, pageSize: 2, total: 7 });
      expect(result.data).toHaveLength(2);
      expect(result.data[0].estado).toBe('RUNNING');
      expect(result.data[1].estado).toBe('STOPPED');
    });
  });
});
