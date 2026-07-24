import { randomUUID } from 'node:crypto';
import { UnprocessableEntityException } from '@nestjs/common';
import { PesoDisciplina, Plano, Prisma } from '@prisma/client';
import { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { PrismaService } from '../../prisma/prisma.service';
import { PlanosAccessService } from './planos-access.service';
import { PlanosService } from './planos.service';

/**
 * Testes de REGRESSÃO das correções de code review em plano-de-estudo:
 *  - derivar aborta com 422 quando um peso ativo referencia disciplina
 *    soft-deletada na origem (peso órfão), em vez de copiar Σ≠100;
 *  - título default do derivado ("<origem> (pessoal)") é truncado a 200 chars;
 *  - descricao vazia/whitespace normaliza para null em create e update;
 *  - deep copy em lote não chama createMany com lista vazia (guardas de length).
 * Não duplicam os cenários já cobertos em planos.service.spec.ts.
 */

const NOW = new Date('2026-07-06T12:00:00Z');
const TITULO_MAX = 200;

function decimal(value: string | number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

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
    publicado: false,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

function buildPeso(planoId: string, disciplinaId: string, peso: string): PesoDisciplina {
  return {
    id: randomUUID(),
    planoId,
    disciplinaId,
    pesoPercentual: decimal(peso),
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  };
}

function buildDisciplina(planoId: string, nome: string, ordem: number) {
  return {
    id: randomUUID(),
    planoId,
    nome,
    ordem,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
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
  findUniqueOrThrow: jest.Mock;
  findMany: jest.Mock;
  create: jest.Mock;
  createMany: jest.Mock;
  update: jest.Mock;
  updateMany: jest.Mock;
  count: jest.Mock;
  deleteMany: jest.Mock;
};

function modelMock(): ModelMock {
  return {
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    createMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
    deleteMany: jest.fn(),
  };
}

describe('PlanosService (unit) — regressões de code review', () => {
  let prisma: {
    plano: ModelMock;
    disciplina: ModelMock;
    tema: ModelMock;
    subtema: ModelMock;
    pesoDisciplina: ModelMock;
    turmaPlano: { findFirst: jest.Mock };
    $transaction: jest.Mock;
  };
  let service: PlanosService;

  const professor = buildUser({ role: 'PROFESSOR' });
  const aluno = buildUser({ role: 'ALUNO' });

  beforeEach(() => {
    prisma = {
      plano: modelMock(),
      disciplina: modelMock(),
      tema: modelMock(),
      subtema: modelMock(),
      pesoDisciplina: modelMock(),
      // Regra de matrícula do access service; default sem vínculo.
      turmaPlano: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(
        (arg: unknown): Promise<unknown> =>
          Array.isArray(arg)
            ? Promise.all(arg)
            : (arg as (tx: unknown) => Promise<unknown>)(prisma),
      ),
    };
    service = new PlanosService(
      prisma as unknown as PrismaService,
      new PlanosAccessService(prisma as unknown as PrismaService),
    );
  });

  /**
   * Prepara uma origem OFICIAL publicada e consistente (Σ pesos ativos = 100)
   * cuja árvore é a informada. Retorna a origem.
   */
  function mockOrigemDerivavel(args: {
    origem?: Partial<Plano>;
    disciplinas: Array<ReturnType<typeof buildDisciplina> & { temas: unknown[] }>;
    pesos: PesoDisciplina[];
  }): Plano {
    const origem = buildPlano({ publicado: true, ...args.origem });
    // Origem derivável pelo aluno: vinculada a turma com matrícula ATIVA
    // (regra de matrícula do assertCanRead).
    prisma.turmaPlano.findFirst.mockResolvedValue({ id: randomUUID() });
    // 1ª findUnique: loadPlanoOrThrow da origem
    prisma.plano.findUnique.mockResolvedValueOnce(origem);
    // assertPlanoConsistente (dentro da transação)
    prisma.disciplina.count.mockResolvedValue(args.disciplinas.length || 1);
    prisma.pesoDisciplina.findMany.mockResolvedValue(args.pesos);
    // snapshot da árvore na mesma transação
    prisma.plano.findUniqueOrThrow.mockResolvedValue({
      ...origem,
      disciplinas: args.disciplinas,
      pesos: args.pesos,
    });
    return origem;
  }

  /** Mocks de escrita + getTree final para o caminho feliz da derivação. */
  function mockEscritaDerivacao(origem: Plano): void {
    const novo = buildPlano({
      tipo: 'PESSOAL',
      autorId: aluno.sub,
      planoOrigemId: origem.id,
    });
    prisma.plano.create.mockResolvedValue(novo);
    prisma.disciplina.createMany.mockResolvedValue({ count: 1 });
    prisma.tema.createMany.mockResolvedValue({ count: 1 });
    prisma.subtema.createMany.mockResolvedValue({ count: 0 });
    prisma.pesoDisciplina.createMany.mockResolvedValue({ count: 1 });
    // 2ª findUnique: getTree do plano novo
    prisma.plano.findUnique.mockResolvedValueOnce({ ...novo, disciplinas: [], pesos: [] });
  }

  describe('derivar — peso órfão na origem (disciplina soft-deletada)', () => {
    it('peso ativo referenciando disciplina fora da árvore → 422 e NADA é copiado', async () => {
      const disciplinaSoftDeletadaId = randomUUID();
      const d1 = buildDisciplina('x', 'Português', 1);
      // Σ = 100 → passa em assertPlanoConsistente; o problema só aparece no
      // remapeamento: o peso de 40.00 aponta para disciplina que não está na
      // árvore ativa (soft-deletada). Pular o peso quebraria Σ=100 no derivado.
      const origem = mockOrigemDerivavel({
        disciplinas: [{ ...d1, temas: [] }],
        pesos: [
          buildPeso('x', d1.id, '60.00'),
          buildPeso('x', disciplinaSoftDeletadaId, '40.00'),
        ],
      });

      let caught: unknown;
      try {
        await service.derivar(aluno, origem.id, {});
      } catch (error) {
        caught = error;
      }

      expect(getDetails(caught)).toEqual([
        {
          field: 'pesos',
          issue: expect.stringContaining(disciplinaSoftDeletadaId),
        },
      ]);
      // Aborta ANTES de qualquer escrita: nem o plano derivado é criado.
      expect(prisma.plano.create).not.toHaveBeenCalled();
      expect(prisma.disciplina.createMany).not.toHaveBeenCalled();
      expect(prisma.pesoDisciplina.createMany).not.toHaveBeenCalled();
    });
  });

  describe('derivar — título default truncado a 200 chars', () => {
    it('origem com titulo de 200 chars → derivado recebe titulo com exatamente 200 chars (sufixo cortado)', async () => {
      const tituloMaximo = 'A'.repeat(TITULO_MAX);
      const d1 = buildDisciplina('x', 'Português', 1);
      const origem = mockOrigemDerivavel({
        origem: { titulo: tituloMaximo },
        disciplinas: [{ ...d1, temas: [] }],
        pesos: [buildPeso('x', d1.id, '100.00')],
      });
      mockEscritaDerivacao(origem);

      await service.derivar(aluno, origem.id, {});

      const data = (prisma.plano.create.mock.calls[0][0] as { data: { titulo: string } }).data;
      // `${titulo} (pessoal)` teria 210 chars → deve voltar ao limite da coluna
      expect(data.titulo).toHaveLength(TITULO_MAX);
      expect(data.titulo).toBe(tituloMaximo);
    });
  });

  describe('create/update — descricao vazia ou whitespace normaliza para null', () => {
    it.each([['vazia', ''], ['whitespace', '   ']])(
      'create com descricao %s → persiste descricao: null',
      async (_label, descricao) => {
        const plano = buildPlano({ tipo: 'PESSOAL', autorId: aluno.sub });
        prisma.plano.create.mockResolvedValue(plano);

        await service.create(aluno, { titulo: 'Meu plano', tipo: 'PESSOAL', descricao });

        expect(prisma.plano.create).toHaveBeenCalledWith({
          data: { titulo: 'Meu plano', descricao: null, tipo: 'PESSOAL', autorId: aluno.sub },
        });
      },
    );

    it.each([['vazia', ''], ['whitespace', '   ']])(
      'update com descricao %s → persiste descricao: null (limpa a descrição)',
      async (_label, descricao) => {
        const plano = buildPlano({ tipo: 'PESSOAL', autorId: aluno.sub, descricao: 'antiga' });
        prisma.plano.findUnique.mockResolvedValue(plano);
        prisma.plano.update.mockResolvedValue({ ...plano, descricao: null });

        await service.update(aluno, plano.id, { descricao });

        expect(prisma.plano.update).toHaveBeenCalledWith({
          where: { id: plano.id },
          data: { descricao: null },
        });
      },
    );

    it('update com descricao com espaços nas bordas → persiste trimada (não null)', async () => {
      const plano = buildPlano({ autorId: professor.sub });
      prisma.plano.findUnique.mockResolvedValue(plano);
      prisma.plano.update.mockResolvedValue({ ...plano, descricao: 'Edital 2026' });

      await service.update(professor, plano.id, { descricao: '  Edital 2026  ' });

      expect(prisma.plano.update).toHaveBeenCalledWith({
        where: { id: plano.id },
        data: { descricao: 'Edital 2026' },
      });
    });
  });

  describe('derivar — cópia em lote não emite createMany vazio', () => {
    it('origem com 1 disciplina, 1 tema e SEM subtemas → subtema.createMany nunca é chamado (nem com [])', async () => {
      const d1 = buildDisciplina('x', 'Português', 1);
      const t1 = {
        id: randomUUID(),
        disciplinaId: d1.id,
        nome: 'Crase',
        ordem: 1,
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
      };
      const origem = mockOrigemDerivavel({
        disciplinas: [{ ...d1, temas: [{ ...t1, subtemas: [] }] }],
        pesos: [buildPeso('x', d1.id, '100.00')],
      });
      mockEscritaDerivacao(origem);

      await service.derivar(aluno, origem.id, {});

      // Coleções vazias são puladas — evita createMany({ data: [] }) inútil.
      expect(prisma.subtema.createMany).not.toHaveBeenCalled();

      // As escritas que ocorrem mantêm as FKs pré-geradas consistentes.
      const planoId = (prisma.plano.create.mock.calls[0][0] as { data: { id: string } }).data.id;
      const disciplinasData = prisma.disciplina.createMany.mock.calls[0][0].data as Array<{
        id: string;
        planoId: string;
      }>;
      expect(disciplinasData).toHaveLength(1);
      expect(disciplinasData[0].planoId).toBe(planoId);
      expect(disciplinasData[0].id).not.toBe(d1.id);

      const temasData = prisma.tema.createMany.mock.calls[0][0].data as Array<{
        disciplinaId: string;
      }>;
      expect(temasData).toEqual([
        expect.objectContaining({ disciplinaId: disciplinasData[0].id, nome: 'Crase', ordem: 1 }),
      ]);

      const pesosData = prisma.pesoDisciplina.createMany.mock.calls[0][0].data as Array<{
        planoId: string;
        disciplinaId: string;
      }>;
      expect(pesosData).toEqual([
        expect.objectContaining({ planoId, disciplinaId: disciplinasData[0].id }),
      ]);
    });

    it('origem com disciplina SEM temas → tema.createMany e subtema.createMany não são chamados', async () => {
      const d1 = buildDisciplina('x', 'Português', 1);
      const origem = mockOrigemDerivavel({
        disciplinas: [{ ...d1, temas: [] }],
        pesos: [buildPeso('x', d1.id, '100.00')],
      });
      mockEscritaDerivacao(origem);

      await service.derivar(aluno, origem.id, {});

      expect(prisma.tema.createMany).not.toHaveBeenCalled();
      expect(prisma.subtema.createMany).not.toHaveBeenCalled();
      expect(prisma.disciplina.createMany).toHaveBeenCalledTimes(1);
      expect(prisma.pesoDisciplina.createMany).toHaveBeenCalledTimes(1);
    });
  });
});
