import { randomUUID } from 'node:crypto';
import {
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Plano, RegistroQuestoes } from '@prisma/client';
import { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { PrismaService } from '../../prisma/prisma.service';
import { PlanosAccessService } from '../planos/planos-access.service';
import { QuestoesService } from './questoes.service';
import {
  RegistroQuestoesWithRefs,
  taxaErro,
  toDataISO,
} from './registro-questoes-response';

/** include de nomes de tema/subtema presente em toda leitura/escrita de registro. */
const REGISTRO_INCLUDE = {
  tema: { select: { nome: true } },
  subtema: { select: { nome: true } },
};

/**
 * Instante fixo: 2026-07-07T12:00Z. Com a folga UTC+14 do service, o "hoje"
 * máximo aceito para `data` é 2026-07-08 (12:00Z + 14h = 2026-07-08T02:00).
 */
const SYSTEM_NOW = new Date('2026-07-07T12:00:00Z');
const NOW = SYSTEM_NOW;

function buildUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return { sub: randomUUID(), role: 'ALUNO', origem: 'PROPRIO', ...overrides };
}

function buildPlano(overrides: Partial<Plano> = {}): Plano {
  return {
    id: randomUUID(),
    titulo: 'Analista Questões',
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
  findMany: jest.Mock;
  count: jest.Mock;
  create: jest.Mock;
  update: jest.Mock;
  groupBy: jest.Mock;
};

function modelMock(): ModelMock {
  return {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    groupBy: jest.fn(),
  };
}

describe('taxaErro (helper — RN-3/D-5)', () => {
  it('calcula erros/total com 4 casas decimais', () => {
    expect(taxaErro(8, 20)).toBe(0.4);
    expect(taxaErro(1, 3)).toBe(0.3333);
    expect(taxaErro(2, 3)).toBe(0.6667);
    expect(taxaErro(10, 10)).toBe(1);
    expect(taxaErro(0, 10)).toBe(0);
  });

  it('total 0 → 0 (divisão segura, D-5/CB-1)', () => {
    expect(taxaErro(0, 0)).toBe(0);
    expect(taxaErro(5, 0)).toBe(0);
  });
});

describe('toDataISO (helper — DATE puro sem off-by-one)', () => {
  it('Date em 00:00Z → dia de calendário exato', () => {
    expect(toDataISO(new Date('2026-07-01T00:00:00Z'))).toBe('2026-07-01');
    expect(toDataISO(new Date('2026-12-31T00:00:00Z'))).toBe('2026-12-31');
  });
});

describe('QuestoesService (unit)', () => {
  let prisma: {
    registroQuestoes: ModelMock;
    tema: ModelMock;
    subtema: ModelMock;
    turmaPlano: { findFirst: jest.Mock };
    $transaction: jest.Mock;
  };
  let service: QuestoesService;

  const aluno = buildUser();
  const outroAluno = buildUser();

  const temaId = randomUUID();
  const subtemaId = randomUUID();

  // Sempre com as refs do include (tema/subtema), como o Prisma devolve agora.
  function buildRegistro(overrides: Partial<RegistroQuestoes> = {}): RegistroQuestoesWithRefs {
    return {
      id: randomUUID(),
      alunoId: aluno.sub,
      temaId,
      subtemaId: null,
      data: new Date('2026-07-01T00:00:00Z'),
      total: 20,
      erros: 8,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
      ...overrides,
      tema: { nome: 'Tema Fixture' },
      subtema: null,
    };
  }

  function mockTemaValido(plano: Plano = buildPlano()): void {
    prisma.tema.findUnique.mockResolvedValue({
      id: temaId,
      deletedAt: null,
      disciplina: { id: randomUUID(), deletedAt: null, plano },
    });
  }

  function mockSubtemaDe(temaDono: string): void {
    prisma.subtema.findUnique.mockResolvedValue({
      id: subtemaId,
      temaId: temaDono,
      deletedAt: null,
      tema: { id: temaDono, deletedAt: null },
    });
  }

  beforeEach(() => {
    jest.useFakeTimers({ now: SYSTEM_NOW });
    prisma = {
      registroQuestoes: modelMock(),
      tema: modelMock(),
      subtema: modelMock(),
      turmaPlano: { findFirst: jest.fn() },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    service = new QuestoesService(
      prisma as unknown as PrismaService,
      new PlanosAccessService(prisma as unknown as PrismaService),
    );

    // Defaults do caminho feliz (cada teste sobrescreve o que precisar):
    // OFICIAL publicado legível pelo aluno via vínculo TurmaPlano + matrícula
    // ATIVA (regra de matrícula do PlanosAccessService).
    mockTemaValido();
    prisma.turmaPlano.findFirst.mockResolvedValue({ id: randomUUID() });
    prisma.registroQuestoes.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(buildRegistro(data as Partial<RegistroQuestoes>)),
    );
    prisma.tema.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // criar — CA-1..5, RN-2..4, CB-1/CB-2/CB-4
  // ---------------------------------------------------------------------------

  describe('criar', () => {
    it('persiste registro do aluno com data em 00:00Z e responde taxaErro=0.4 derivada (CA-1/CA-5)', async () => {
      const result = await service.criar(aluno, {
        temaId,
        data: '2026-07-01',
        total: 20,
        erros: 8,
      });

      expect(prisma.registroQuestoes.create).toHaveBeenCalledWith({
        data: {
          alunoId: aluno.sub,
          temaId,
          subtemaId: null,
          data: new Date('2026-07-01T00:00:00Z'),
          total: 20,
          erros: 8,
        },
        include: REGISTRO_INCLUDE,
      });
      // RN-3: taxaErro NUNCA vai para o banco
      const persistido = prisma.registroQuestoes.create.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(persistido).not.toHaveProperty('taxaErro');

      expect(result).toMatchObject({
        alunoId: aluno.sub,
        temaId,
        subtemaId: null,
        data: '2026-07-01',
        total: 20,
        erros: 8,
        taxaErro: 0.4,
      });
    });

    it('erros = total → taxaErro 1.0, registro válido (CB-2)', async () => {
      const result = await service.criar(aluno, {
        temaId,
        data: '2026-07-01',
        total: 10,
        erros: 10,
      });
      expect(result.taxaErro).toBe(1);
    });

    it('1 erro em 3 → taxaErro 0.3333 (4 casas, sem ruído de ponto flutuante)', async () => {
      const result = await service.criar(aluno, {
        temaId,
        data: '2026-07-01',
        total: 3,
        erros: 1,
      });
      expect(result.taxaErro).toBe(0.3333);
    });

    it('erros > total → 422 com details apontando erros; nada é persistido (CA-2/RN-2)', async () => {
      let caught: unknown;
      try {
        await service.criar(aluno, { temaId, data: '2026-07-01', total: 5, erros: 6 });
      } catch (error) {
        caught = error;
      }
      expect(getDetails(caught)).toEqual([
        expect.objectContaining({ field: 'erros', issue: expect.stringContaining('total') }),
      ]);
      expect(prisma.registroQuestoes.create).not.toHaveBeenCalled();
    });

    it('data de hoje (2026-07-07) e o "hoje" em UTC+14 (2026-07-08) são aceitos (CA-3, folga TZ)', async () => {
      await expect(
        service.criar(aluno, { temaId, data: '2026-07-07', total: 1, erros: 0 }),
      ).resolves.toMatchObject({ data: '2026-07-07' });
      await expect(
        service.criar(aluno, { temaId, data: '2026-07-08', total: 1, erros: 0 }),
      ).resolves.toMatchObject({ data: '2026-07-08' });
    });

    it('data futura mesmo com folga UTC+14 (2026-07-09) → 422 em data (CA-3)', async () => {
      let caught: unknown;
      try {
        await service.criar(aluno, { temaId, data: '2026-07-09', total: 1, erros: 0 });
      } catch (error) {
        caught = error;
      }
      expect(getDetails(caught)).toEqual([
        expect.objectContaining({ field: 'data', issue: expect.stringContaining('futura') }),
      ]);
      expect(prisma.registroQuestoes.create).not.toHaveBeenCalled();
    });

    it('data de calendário inexistente (2026-02-30) → 422 em data', async () => {
      let caught: unknown;
      try {
        await service.criar(aluno, { temaId, data: '2026-02-30', total: 1, erros: 0 });
      } catch (error) {
        caught = error;
      }
      expect(getDetails(caught)).toEqual([
        expect.objectContaining({ field: 'data', issue: expect.stringContaining('calendário') }),
      ]);
    });

    it('tema inexistente / soft-deleted / de plano deletado → 422 em temaId (CB-4)', async () => {
      const cenarios = [
        null,
        { id: temaId, deletedAt: NOW, disciplina: { deletedAt: null, plano: buildPlano() } },
        { id: temaId, deletedAt: null, disciplina: { deletedAt: null, plano: buildPlano({ deletedAt: NOW }) } },
      ];
      for (const cenario of cenarios) {
        prisma.tema.findUnique.mockResolvedValue(cenario);
        let caught: unknown;
        try {
          await service.criar(aluno, { temaId, data: '2026-07-01', total: 1, erros: 0 });
        } catch (error) {
          caught = error;
        }
        expect(getDetails(caught)).toEqual([
          expect.objectContaining({ field: 'temaId', issue: 'tema inexistente' }),
        ]);
      }
      expect(prisma.registroQuestoes.create).not.toHaveBeenCalled();
    });

    it('tema de plano PESSOAL de outro aluno → 422 (não 403) com details em temaId', async () => {
      mockTemaValido(buildPlano({ tipo: 'PESSOAL', publicado: false, autorId: outroAluno.sub }));
      let caught: unknown;
      try {
        await service.criar(aluno, { temaId, data: '2026-07-01', total: 1, erros: 0 });
      } catch (error) {
        caught = error;
      }
      expect(caught).not.toBeInstanceOf(ForbiddenException);
      expect(getDetails(caught)).toEqual([
        expect.objectContaining({ field: 'temaId', issue: expect.stringContaining('acessível') }),
      ]);
    });

    it('tema de plano OFICIAL não publicado → 422 (tema ilegível para o aluno)', async () => {
      mockTemaValido(buildPlano({ publicado: false }));
      let caught: unknown;
      try {
        await service.criar(aluno, { temaId, data: '2026-07-01', total: 1, erros: 0 });
      } catch (error) {
        caught = error;
      }
      expect(getDetails(caught)).toEqual([
        expect.objectContaining({ field: 'temaId', issue: expect.stringContaining('acessível') }),
      ]);
    });

    it('subtemaId válido (filho do tema) é persistido (CA-4/RN-4)', async () => {
      mockSubtemaDe(temaId);
      const result = await service.criar(aluno, {
        temaId,
        subtemaId,
        data: '2026-07-01',
        total: 4,
        erros: 2,
      });
      expect(prisma.registroQuestoes.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ subtemaId }) }),
      );
      expect(result.subtemaId).toBe(subtemaId);
    });

    it('subtema inexistente → 422 em subtemaId (CB-4)', async () => {
      prisma.subtema.findUnique.mockResolvedValue(null);
      let caught: unknown;
      try {
        await service.criar(aluno, { temaId, subtemaId, data: '2026-07-01', total: 1, erros: 0 });
      } catch (error) {
        caught = error;
      }
      expect(getDetails(caught)).toEqual([
        expect.objectContaining({ field: 'subtemaId', issue: 'subtema inexistente' }),
      ]);
    });

    it('subtema de OUTRO tema → 422 em subtemaId (CA-4)', async () => {
      mockSubtemaDe(randomUUID());
      let caught: unknown;
      try {
        await service.criar(aluno, { temaId, subtemaId, data: '2026-07-01', total: 1, erros: 0 });
      } catch (error) {
        caught = error;
      }
      expect(getDetails(caught)).toEqual([
        expect.objectContaining({
          field: 'subtemaId',
          issue: expect.stringContaining('pertencer ao tema'),
        }),
      ]);
      expect(prisma.registroQuestoes.create).not.toHaveBeenCalled();
    });

    it('tema E subtema inválidos → um 422 com os DOIS details acumulados', async () => {
      prisma.tema.findUnique.mockResolvedValue(null);
      prisma.subtema.findUnique.mockResolvedValue(null);
      let caught: unknown;
      try {
        await service.criar(aluno, { temaId, subtemaId, data: '2026-07-01', total: 1, erros: 0 });
      } catch (error) {
        caught = error;
      }
      const details = getDetails(caught);
      expect(details).toHaveLength(2);
      expect(details.map((d) => d.field).sort()).toEqual(['subtemaId', 'temaId']);
    });
  });

  // ---------------------------------------------------------------------------
  // list — CA-6 (escopo, filtros inclusivos, sort, paginação)
  // ---------------------------------------------------------------------------

  describe('list', () => {
    beforeEach(() => {
      prisma.registroQuestoes.findMany.mockResolvedValue([buildRegistro()]);
      prisma.registroQuestoes.count.mockResolvedValue(1);
    });

    it('escopa ao aluno, exclui soft-deleted, ordena por -data (default) e devolve envelope paginado', async () => {
      const result = await service.list(aluno, { page: 1, pageSize: 20 });

      expect(prisma.registroQuestoes.findMany).toHaveBeenCalledWith({
        where: { alunoId: aluno.sub, deletedAt: null },
        include: REGISTRO_INCLUDE,
        // Desempate estável (code review): RN-5 permite vários registros no
        // mesmo tema/dia — sem ordem total eles flutuariam entre páginas.
        orderBy: [{ data: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
        skip: 0,
        take: 20,
      });
      expect(result).toMatchObject({ page: 1, pageSize: 20, total: 1 });
      expect(result.data[0]).toMatchObject({ data: '2026-07-01', taxaErro: 0.4 });
    });

    it('filtros temaId/subtemaId/from/to: from e to AMBOS inclusivos (gte/lte) sobre DATE', async () => {
      const outroSubtemaId = randomUUID();
      await service.list(aluno, {
        page: 1,
        pageSize: 20,
        temaId,
        subtemaId: outroSubtemaId,
        from: '2026-07-01',
        to: '2026-07-05',
      });

      expect(prisma.registroQuestoes.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            alunoId: aluno.sub,
            deletedAt: null,
            temaId,
            subtemaId: outroSubtemaId,
            data: {
              gte: new Date('2026-07-01T00:00:00Z'),
              lte: new Date('2026-07-05T00:00:00Z'),
            },
          },
        }),
      );
    });

    it('sort=total (asc) e sort=-createdAt (desc) usam a allowlist', async () => {
      await service.list(aluno, { page: 1, pageSize: 20, sort: 'total' });
      expect(prisma.registroQuestoes.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          orderBy: [{ total: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }],
        }),
      );

      await service.list(aluno, { page: 1, pageSize: 20, sort: '-createdAt' });
      expect(prisma.registroQuestoes.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] }),
      );
    });

    it('sort fora da allowlist → 422', async () => {
      await expect(
        service.list(aluno, { page: 1, pageSize: 20, sort: 'taxaErro' }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(prisma.registroQuestoes.findMany).not.toHaveBeenCalled();
    });

    it('from inválido de calendário (2026-02-30) → 422 em from', async () => {
      let caught: unknown;
      try {
        await service.list(aluno, { page: 1, pageSize: 20, from: '2026-02-30' });
      } catch (error) {
        caught = error;
      }
      expect(getDetails(caught)).toEqual([expect.objectContaining({ field: 'from' })]);
    });

    it('page/pageSize → skip/take', async () => {
      await service.list(aluno, { page: 3, pageSize: 10 });
      expect(prisma.registroQuestoes.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // getById / update / remove — CA-7 (dono), revalidação no PATCH, soft delete
  // ---------------------------------------------------------------------------

  describe('getById', () => {
    it('registro do próprio aluno → response com taxaErro', async () => {
      const registro = buildRegistro();
      prisma.registroQuestoes.findUnique.mockResolvedValue(registro);
      const result = await service.getById(aluno, registro.id);
      expect(result).toMatchObject({ id: registro.id, taxaErro: 0.4, data: '2026-07-01' });
    });

    it('inexistente → 404; soft-deleted → 404; de OUTRO aluno → 403 (CA-7)', async () => {
      prisma.registroQuestoes.findUnique.mockResolvedValue(null);
      await expect(service.getById(aluno, randomUUID())).rejects.toBeInstanceOf(NotFoundException);

      prisma.registroQuestoes.findUnique.mockResolvedValue(buildRegistro({ deletedAt: NOW }));
      await expect(service.getById(aluno, randomUUID())).rejects.toBeInstanceOf(NotFoundException);

      prisma.registroQuestoes.findUnique.mockResolvedValue(
        buildRegistro({ alunoId: outroAluno.sub }),
      );
      await expect(service.getById(aluno, randomUUID())).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('update', () => {
    let persistido: RegistroQuestoes;

    beforeEach(() => {
      persistido = buildRegistro(); // total 20, erros 8
      prisma.registroQuestoes.findUnique.mockResolvedValue(persistido);
      prisma.registroQuestoes.update.mockImplementation(
        ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
          Promise.resolve({ ...persistido, ...data, id: where.id }),
      );
    });

    it('PATCH só de erros valida contra o total PERSISTIDO: erros=25 > total=20 → 422', async () => {
      let caught: unknown;
      try {
        await service.update(aluno, persistido.id, { erros: 25 });
      } catch (error) {
        caught = error;
      }
      expect(getDetails(caught)).toEqual([expect.objectContaining({ field: 'erros' })]);
      expect(prisma.registroQuestoes.update).not.toHaveBeenCalled();
    });

    it('reduzir total abaixo dos erros persistidos (total=5 < erros=8) → 422', async () => {
      let caught: unknown;
      try {
        await service.update(aluno, persistido.id, { total: 5 });
      } catch (error) {
        caught = error;
      }
      expect(getDetails(caught)).toEqual([expect.objectContaining({ field: 'erros' })]);
      expect(prisma.registroQuestoes.update).not.toHaveBeenCalled();
    });

    it('PATCH {erros:10} → atualiza SÓ erros e recalcula taxaErro=0.5 na resposta', async () => {
      const result = await service.update(aluno, persistido.id, { erros: 10 });
      expect(prisma.registroQuestoes.update).toHaveBeenCalledWith({
        where: { id: persistido.id },
        data: { erros: 10 },
        include: REGISTRO_INCLUDE,
      });
      expect(result).toMatchObject({ total: 20, erros: 10, taxaErro: 0.5 });
    });

    it('subtemaId: null desvincula o subtema SEM consultar subtema', async () => {
      const result = await service.update(aluno, persistido.id, { subtemaId: null });
      expect(prisma.subtema.findUnique).not.toHaveBeenCalled();
      expect(prisma.registroQuestoes.update).toHaveBeenCalledWith({
        where: { id: persistido.id },
        data: { subtemaId: null },
        include: REGISTRO_INCLUDE,
      });
      expect(result.subtemaId).toBeNull();
    });

    it('subtemaId de OUTRO tema → 422; do MESMO tema → atualiza', async () => {
      mockSubtemaDe(randomUUID());
      let caught: unknown;
      try {
        await service.update(aluno, persistido.id, { subtemaId });
      } catch (error) {
        caught = error;
      }
      expect(getDetails(caught)).toEqual([
        expect.objectContaining({
          field: 'subtemaId',
          issue: expect.stringContaining('pertencer ao tema'),
        }),
      ]);

      mockSubtemaDe(persistido.temaId);
      const result = await service.update(aluno, persistido.id, { subtemaId });
      expect(result.subtemaId).toBe(subtemaId);
    });

    it('data futura no PATCH → 422; data válida → atualiza em 00:00Z', async () => {
      await expect(
        service.update(aluno, persistido.id, { data: '2026-07-09' }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);

      const result = await service.update(aluno, persistido.id, { data: '2026-07-05' });
      expect(prisma.registroQuestoes.update).toHaveBeenCalledWith({
        where: { id: persistido.id },
        data: { data: new Date('2026-07-05T00:00:00Z') },
        include: REGISTRO_INCLUDE,
      });
      expect(result.data).toBe('2026-07-05');
    });

    it('registro de outro aluno → 403; inexistente → 404 (CA-7)', async () => {
      prisma.registroQuestoes.findUnique.mockResolvedValue(
        buildRegistro({ alunoId: outroAluno.sub }),
      );
      await expect(service.update(aluno, randomUUID(), { erros: 1 })).rejects.toBeInstanceOf(
        ForbiddenException,
      );

      prisma.registroQuestoes.findUnique.mockResolvedValue(null);
      await expect(service.update(aluno, randomUUID(), { erros: 1 })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('soft delete: update com deletedAt, nunca delete físico', async () => {
      const registro = buildRegistro();
      prisma.registroQuestoes.findUnique.mockResolvedValue(registro);
      prisma.registroQuestoes.update.mockResolvedValue(registro);

      await service.remove(aluno, registro.id);

      expect(prisma.registroQuestoes.update).toHaveBeenCalledWith({
        where: { id: registro.id },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('registro de outro aluno → 403; já soft-deleted → 404', async () => {
      prisma.registroQuestoes.findUnique.mockResolvedValue(
        buildRegistro({ alunoId: outroAluno.sub }),
      );
      await expect(service.remove(aluno, randomUUID())).rejects.toBeInstanceOf(
        ForbiddenException,
      );

      prisma.registroQuestoes.findUnique.mockResolvedValue(buildRegistro({ deletedAt: NOW }));
      await expect(service.remove(aluno, randomUUID())).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // desempenho — CA-8, RN-5, D-3 (janela default), CB-3, ordenação
  // ---------------------------------------------------------------------------

  describe('desempenho', () => {
    beforeEach(() => {
      prisma.registroQuestoes.groupBy.mockResolvedValue([]);
    });

    it('sem from/to usa janela de 30 dias-calendário INCLUSIVOS terminando "hoje" (UTC+14) e a ecoa (D-3)', async () => {
      const result = await service.desempenho(aluno, {});

      // now 2026-07-07T12:00Z + 14h → hoje=2026-07-08; from = to − 29 dias
      expect(result).toEqual({ data: [], from: '2026-06-09', to: '2026-07-08' });
      expect(prisma.registroQuestoes.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['temaId'],
          where: {
            alunoId: aluno.sub,
            deletedAt: null,
            data: {
              gte: new Date('2026-06-09T00:00:00Z'),
              lte: new Date('2026-07-08T00:00:00Z'),
            },
          },
          _sum: { total: true, erros: true },
        }),
      );
    });

    it('from/to explícitos são aplicados (gte/lte) e ecoados; temaId entra no where', async () => {
      const result = await service.desempenho(aluno, {
        temaId,
        from: '2026-06-01',
        to: '2026-06-30',
      });

      expect(result).toMatchObject({ from: '2026-06-01', to: '2026-06-30' });
      expect(prisma.registroQuestoes.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            temaId,
            data: {
              gte: new Date('2026-06-01T00:00:00Z'),
              lte: new Date('2026-06-30T00:00:00Z'),
            },
          }),
        }),
      );
    });

    it('agrega somas por tema com temaNome e ordena: taxaErro desc, totalErros desc, temaId asc', async () => {
      const tema1 = '11111111-1111-4111-8111-111111111111'; // 0.3
      const tema2 = '22222222-2222-4222-8222-222222222222'; // 0.8 com 8 erros
      const tema3 = '33333333-3333-4333-8333-333333333333'; // 0.8 com 80 erros
      const tema4 = '44444444-4444-4444-8444-444444444444'; // 0.8 com 8 erros (empate total c/ tema2)

      prisma.registroQuestoes.groupBy.mockResolvedValue([
        { temaId: tema1, _sum: { total: 20, erros: 6 } },
        { temaId: tema4, _sum: { total: 10, erros: 8 } },
        { temaId: tema2, _sum: { total: 10, erros: 8 } },
        { temaId: tema3, _sum: { total: 100, erros: 80 } },
      ]);
      prisma.tema.findMany.mockResolvedValue([
        { id: tema1, nome: 'Crase' },
        { id: tema2, nome: 'Concordância' },
        { id: tema3, nome: 'Regência' },
        { id: tema4, nome: 'Pontuação' },
      ]);

      const result = await service.desempenho(aluno, { from: '2026-06-01', to: '2026-06-30' });

      expect(result.data).toEqual([
        { temaId: tema3, temaNome: 'Regência', totalQuestoes: 100, totalErros: 80, taxaErro: 0.8 },
        { temaId: tema2, temaNome: 'Concordância', totalQuestoes: 10, totalErros: 8, taxaErro: 0.8 },
        { temaId: tema4, temaNome: 'Pontuação', totalQuestoes: 10, totalErros: 8, taxaErro: 0.8 },
        { temaId: tema1, temaNome: 'Crase', totalQuestoes: 20, totalErros: 6, taxaErro: 0.3 },
      ]);
    });

    it('taxa agregada arredonda a 4 casas (1 erro em 3 → 0.3333)', async () => {
      prisma.registroQuestoes.groupBy.mockResolvedValue([
        { temaId, _sum: { total: 3, erros: 1 } },
      ]);
      prisma.tema.findMany.mockResolvedValue([{ id: temaId, nome: 'Crase' }]);

      const result = await service.desempenho(aluno, { from: '2026-06-01', to: '2026-06-30' });
      expect(result.data[0].taxaErro).toBe(0.3333);
    });

    it('guarda de _sum nulo: totalQuestoes/totalErros 0 e taxaErro 0 (D-5)', async () => {
      prisma.registroQuestoes.groupBy.mockResolvedValue([
        { temaId, _sum: { total: null, erros: null } },
      ]);
      prisma.tema.findMany.mockResolvedValue([]);

      const result = await service.desempenho(aluno, { from: '2026-06-01', to: '2026-06-30' });
      expect(result.data[0]).toEqual({
        temaId,
        temaNome: '',
        totalQuestoes: 0,
        totalErros: 0,
        taxaErro: 0,
      });
    });

    it('período sem registros → { data: [], from, to } (CB-3)', async () => {
      const result = await service.desempenho(aluno, { from: '2020-01-01', to: '2020-01-31' });
      expect(result).toEqual({ data: [], from: '2020-01-01', to: '2020-01-31' });
    });

    it('from/to inválidos de calendário → 422', async () => {
      await expect(service.desempenho(aluno, { from: '2026-02-30' })).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      await expect(service.desempenho(aluno, { to: '2026-13-01' })).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });
  });
});
