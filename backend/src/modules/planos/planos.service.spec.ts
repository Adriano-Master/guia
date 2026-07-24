import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PesoDisciplina, Plano, Prisma } from '@prisma/client';
import { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { PrismaService } from '../../prisma/prisma.service';
import { ListPlanosQueryDto } from './dto/list-planos-query.dto';
import { PlanosAccessService } from './planos-access.service';
import { PlanosService } from './planos.service';

const NOW = new Date('2026-07-06T12:00:00Z');

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

function buildPeso(
  planoId: string,
  disciplinaId: string,
  peso: string,
  overrides: Partial<PesoDisciplina> = {},
): PesoDisciplina {
  return {
    id: randomUUID(),
    planoId,
    disciplinaId,
    pesoPercentual: decimal(peso),
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

function listQuery(overrides: Partial<ListPlanosQueryDto> = {}): ListPlanosQueryDto {
  return { page: 1, pageSize: 20, ...overrides } as ListPlanosQueryDto;
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

describe('PlanosService (unit)', () => {
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
  const admin = buildUser({ role: 'ADMIN' });
  const aluno = buildUser({ role: 'ALUNO' });
  const outroAluno = buildUser({ role: 'ALUNO' });

  beforeEach(() => {
    prisma = {
      plano: modelMock(),
      disciplina: modelMock(),
      tema: modelMock(),
      subtema: modelMock(),
      pesoDisciplina: modelMock(),
      // Regra de matrícula: EXISTS TurmaPlano⋈Turma⋈Matricula do access
      // service; default sem vínculo (aluno não matriculado).
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

  describe('create — RN-01/CA-01/CA-02', () => {
    it('ALUNO criando OFICIAL → ForbiddenException 403 e nada é persistido', async () => {
      await expect(
        service.create(aluno, { titulo: 'Oficial do aluno', tipo: 'OFICIAL' }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.plano.create).not.toHaveBeenCalled();
    });

    it('interno (PROFESSOR) criando PESSOAL → ForbiddenException 403', async () => {
      await expect(
        service.create(professor, { titulo: 'Pessoal do professor', tipo: 'PESSOAL' }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.plano.create).not.toHaveBeenCalled();
    });

    it('interno cria OFICIAL com autorId = usuário autenticado e publicado=false', async () => {
      const plano = buildPlano({ autorId: professor.sub, tipo: 'OFICIAL' });
      prisma.plano.create.mockResolvedValue(plano);

      const result = await service.create(professor, { titulo: 'Analista TRF', tipo: 'OFICIAL' });

      expect(prisma.plano.create).toHaveBeenCalledWith({
        data: { titulo: 'Analista TRF', descricao: null, tipo: 'OFICIAL', autorId: professor.sub },
      });
      expect(result).toMatchObject({ tipo: 'OFICIAL', autorId: professor.sub, publicado: false });
    });

    it('ALUNO cria PESSOAL com autorId = aluno (CA-02)', async () => {
      const plano = buildPlano({ autorId: aluno.sub, tipo: 'PESSOAL' });
      prisma.plano.create.mockResolvedValue(plano);

      const result = await service.create(aluno, { titulo: 'Meu plano', tipo: 'PESSOAL' });
      expect(prisma.plano.create).toHaveBeenCalledWith({
        data: { titulo: 'Meu plano', descricao: null, tipo: 'PESSOAL', autorId: aluno.sub },
      });
      expect(result.tipo).toBe('PESSOAL');
    });
  });

  describe('list — escopo por papel', () => {
    beforeEach(() => {
      prisma.plano.findMany.mockResolvedValue([buildPlano()]);
      prisma.plano.count.mockResolvedValue(1);
    });

    it('ALUNO só enxerga os próprios planos + OFICIAIS publicados de turmas com matrícula ATIVA', async () => {
      await service.list(aluno, listQuery());
      const where = prisma.plano.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({
        deletedAt: null,
        OR: [
          { autorId: aluno.sub },
          {
            tipo: 'OFICIAL',
            publicado: true,
            turmas: {
              some: {
                turma: {
                  deletedAt: null,
                  matriculas: {
                    some: { alunoId: aluno.sub, status: 'ATIVA', deletedAt: null },
                  },
                },
              },
            },
          },
        ],
      });
      expect(prisma.plano.count).toHaveBeenCalledWith({ where });
    });

    it('interno enxerga tudo (sem cláusula OR de escopo)', async () => {
      await service.list(admin, listQuery());
      const where = prisma.plano.findMany.mock.calls[0][0].where;
      expect(where.OR).toBeUndefined();
      expect(where).toMatchObject({ deletedAt: null });
    });

    it('aplica filtros tipo/publicado/autorId e retorna envelope { data, page, pageSize, total }', async () => {
      prisma.plano.count.mockResolvedValue(7);
      const result = await service.list(
        admin,
        listQuery({ tipo: 'OFICIAL', publicado: true, autorId: professor.sub, page: 2, pageSize: 5 }),
      );

      expect(prisma.plano.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tipo: 'OFICIAL',
            publicado: true,
            autorId: professor.sub,
          }),
          skip: 5,
          take: 5,
        }),
      );
      expect(result).toMatchObject({ page: 2, pageSize: 5, total: 7 });
    });
  });

  describe('getById — leitura com escopo', () => {
    it('plano inexistente → NotFoundException 404', async () => {
      prisma.plano.findUnique.mockResolvedValue(null);
      await expect(service.getById(admin, randomUUID())).rejects.toThrow(NotFoundException);
    });

    it('plano soft-deletado → NotFoundException 404', async () => {
      prisma.plano.findUnique.mockResolvedValue(buildPlano({ deletedAt: NOW }));
      await expect(service.getById(admin, randomUUID())).rejects.toThrow(NotFoundException);
    });

    it('aluno lendo OFICIAL NÃO publicado (rascunho) → ForbiddenException 403', async () => {
      prisma.plano.findUnique.mockResolvedValue(buildPlano({ publicado: false }));
      await expect(service.getById(aluno, randomUUID())).rejects.toThrow(ForbiddenException);
    });

    it('aluno lendo PESSOAL de outro aluno → ForbiddenException 403 (CA-12)', async () => {
      prisma.plano.findUnique.mockResolvedValue(
        buildPlano({ tipo: 'PESSOAL', autorId: outroAluno.sub }),
      );
      await expect(service.getById(aluno, randomUUID())).rejects.toThrow(ForbiddenException);
    });

    it('aluno lendo OFICIAL publicado de turma matriculada → permitido', async () => {
      const plano = buildPlano({ publicado: true });
      // vínculo TurmaPlano + matrícula ATIVA do aluno (regra de matrícula)
      prisma.turmaPlano.findFirst.mockResolvedValue({ id: randomUUID() });
      // 1ª chamada: loadPlanoOrThrow; 2ª: getTree
      prisma.plano.findUnique
        .mockResolvedValueOnce(plano)
        .mockResolvedValueOnce({ ...plano, disciplinas: [], pesos: [] });

      const result = await service.getById(aluno, plano.id);
      expect(result).toMatchObject({ id: plano.id, publicado: true });
    });
  });

  describe('update/remove — autorização (CA-12/RN-06)', () => {
    it('aluno editando plano OFICIAL → 403', async () => {
      prisma.plano.findUnique.mockResolvedValue(buildPlano({ publicado: true }));
      await expect(service.update(aluno, randomUUID(), { titulo: 'X' })).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.plano.update).not.toHaveBeenCalled();
    });

    it('aluno editando PESSOAL de outro aluno → 403', async () => {
      prisma.plano.findUnique.mockResolvedValue(
        buildPlano({ tipo: 'PESSOAL', autorId: outroAluno.sub }),
      );
      await expect(service.remove(aluno, randomUUID())).rejects.toThrow(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('interno que não é autor pode editar OFICIAL (RN-06)', async () => {
      const plano = buildPlano({ autorId: professor.sub });
      prisma.plano.findUnique.mockResolvedValue(plano);
      prisma.plano.update.mockResolvedValue({ ...plano, titulo: 'Novo título' });

      const result = await service.update(admin, plano.id, { titulo: 'Novo título' });
      expect(result.titulo).toBe('Novo título');
    });
  });

  describe('remove — cascade soft delete (CA-11)', () => {
    it('marca deletedAt em subtemas, temas, disciplinas, pesos e no plano, em transação', async () => {
      const plano = buildPlano({ tipo: 'PESSOAL', autorId: aluno.sub });
      prisma.plano.findUnique.mockResolvedValue(plano);
      prisma.subtema.updateMany.mockResolvedValue({ count: 3 });
      prisma.tema.updateMany.mockResolvedValue({ count: 2 });
      prisma.disciplina.updateMany.mockResolvedValue({ count: 1 });
      prisma.pesoDisciplina.updateMany.mockResolvedValue({ count: 1 });
      prisma.plano.update.mockResolvedValue({ ...plano, deletedAt: NOW });

      await service.remove(aluno, plano.id);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.subtema.updateMany).toHaveBeenCalledWith({
        where: { deletedAt: null, tema: { disciplina: { planoId: plano.id } } },
        data: { deletedAt: expect.any(Date) },
      });
      expect(prisma.tema.updateMany).toHaveBeenCalledWith({
        where: { deletedAt: null, disciplina: { planoId: plano.id } },
        data: { deletedAt: expect.any(Date) },
      });
      expect(prisma.disciplina.updateMany).toHaveBeenCalledWith({
        where: { deletedAt: null, planoId: plano.id },
        data: { deletedAt: expect.any(Date) },
      });
      expect(prisma.pesoDisciplina.updateMany).toHaveBeenCalledWith({
        where: { deletedAt: null, planoId: plano.id },
        data: { deletedAt: expect.any(Date) },
      });
      expect(prisma.plano.update).toHaveBeenCalledWith({
        where: { id: plano.id },
        data: { deletedAt: expect.any(Date) },
      });
    });
  });

  describe('listPesos — leitura com escopo', () => {
    it('retorna pesos ativos serializados como number com 2 casas', async () => {
      const plano = buildPlano({ publicado: true });
      prisma.turmaPlano.findFirst.mockResolvedValue({ id: randomUUID() });
      prisma.plano.findUnique.mockResolvedValue(plano);
      prisma.pesoDisciplina.findMany.mockResolvedValue([
        buildPeso(plano.id, randomUUID(), '60.00'),
        buildPeso(plano.id, randomUUID(), '40.00'),
      ]);

      const result = await service.listPesos(aluno, plano.id);
      expect(prisma.pesoDisciplina.findMany).toHaveBeenCalledWith({
        where: { planoId: plano.id, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      });
      expect(result.map((p) => p.pesoPercentual)).toEqual([60, 40]);
    });

    it('aluno lendo pesos de PESSOAL alheio → 403', async () => {
      prisma.plano.findUnique.mockResolvedValue(
        buildPlano({ tipo: 'PESSOAL', autorId: outroAluno.sub }),
      );
      await expect(service.listPesos(aluno, randomUUID())).rejects.toThrow(ForbiddenException);
    });
  });

  describe('setPesos — invariante Σ = 100 (RN-02/CA-03/CB-02)', () => {
    const plano = buildPlano({ autorId: professor.sub });
    const discA = randomUUID();
    const discB = randomUUID();
    const discC = randomUUID();

    beforeEach(() => {
      prisma.plano.findUnique.mockResolvedValue(plano);
      prisma.disciplina.findMany.mockResolvedValue([{ id: discA }, { id: discB }, { id: discC }]);
    });

    it('Σ = 100.00 exata → aceita e substitui os pesos atomicamente (hard delete + create)', async () => {
      prisma.pesoDisciplina.findMany.mockResolvedValue([
        buildPeso(plano.id, discA, '33.33'),
        buildPeso(plano.id, discB, '33.33'),
        buildPeso(plano.id, discC, '33.34'),
      ]);
      prisma.pesoDisciplina.createMany.mockResolvedValue({ count: 3 });
      prisma.pesoDisciplina.deleteMany.mockResolvedValue({ count: 0 });

      const result = await service.setPesos(professor, plano.id, {
        pesos: [
          { disciplinaId: discA, pesoPercentual: 33.33 },
          { disciplinaId: discB, pesoPercentual: 33.33 },
          { disciplinaId: discC, pesoPercentual: 33.34 },
        ],
      });

      // Substituição hard-delete dentro da transação (nunca soft) — evita violar o unique
      expect(prisma.pesoDisciplina.deleteMany).toHaveBeenCalledWith({
        where: { planoId: plano.id },
      });
      const createData = prisma.pesoDisciplina.createMany.mock.calls[0][0].data as Array<{
        pesoPercentual: Prisma.Decimal;
      }>;
      const soma = createData.reduce((acc, p) => acc.plus(p.pesoPercentual), decimal(0));
      expect(soma.equals(decimal(100))).toBe(true);
      expect(result).toHaveLength(3);
      expect(result.map((p) => p.pesoPercentual)).toEqual([33.33, 33.33, 33.34]);
    });

    it('soma com armadilha de ponto flutuante (10.1+20.2+30.3+39.4) → aceita como 100.00', async () => {
      // Em float, 10.1+20.2+30.3+39.4 = 100.00000000000001; com Decimal deve ser exato.
      const discD = randomUUID();
      prisma.disciplina.findMany.mockResolvedValue([
        { id: discA },
        { id: discB },
        { id: discC },
        { id: discD },
      ]);
      prisma.pesoDisciplina.createMany.mockResolvedValue({ count: 4 });
      prisma.pesoDisciplina.deleteMany.mockResolvedValue({ count: 0 });
      prisma.pesoDisciplina.findMany.mockResolvedValue([
        buildPeso(plano.id, discA, '10.10'),
        buildPeso(plano.id, discB, '20.20'),
        buildPeso(plano.id, discC, '30.30'),
        buildPeso(plano.id, discD, '39.40'),
      ]);

      await expect(
        service.setPesos(professor, plano.id, {
          pesos: [
            { disciplinaId: discA, pesoPercentual: 10.1 },
            { disciplinaId: discB, pesoPercentual: 20.2 },
            { disciplinaId: discC, pesoPercentual: 30.3 },
            { disciplinaId: discD, pesoPercentual: 39.4 },
          ],
        }),
      ).resolves.toHaveLength(4);
    });

    it.each([
      ['99.99', [33.33, 33.33, 33.33]],
      ['100.01', [33.34, 33.33, 33.34]],
    ])(
      'Σ = %s → 422 com details [{ field: "pesoPercentual", issue: "soma deve ser 100" }]',
      async (_soma, valores) => {
        let caught: unknown;
        try {
          await service.setPesos(professor, plano.id, {
            pesos: [
              { disciplinaId: discA, pesoPercentual: valores[0] },
              { disciplinaId: discB, pesoPercentual: valores[1] },
              { disciplinaId: discC, pesoPercentual: valores[2] },
            ],
          });
        } catch (error) {
          caught = error;
        }

        expect(getDetails(caught)).toEqual([
          { field: 'pesoPercentual', issue: 'soma deve ser 100' },
        ]);
        expect(prisma.pesoDisciplina.deleteMany).not.toHaveBeenCalled();
        expect(prisma.pesoDisciplina.createMany).not.toHaveBeenCalled();
      },
    );

    it('disciplinaId duplicado no payload → ConflictException 409 (CA-04/CB-06)', async () => {
      await expect(
        service.setPesos(professor, plano.id, {
          pesos: [
            { disciplinaId: discA, pesoPercentual: 50 },
            { disciplinaId: discA, pesoPercentual: 50 },
          ],
        }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.pesoDisciplina.deleteMany).not.toHaveBeenCalled();
    });

    it('disciplinaId que não pertence ao plano → 422 com field=disciplinaId', async () => {
      const alheia = randomUUID();
      let caught: unknown;
      try {
        await service.setPesos(professor, plano.id, {
          pesos: [
            { disciplinaId: discA, pesoPercentual: 50 },
            { disciplinaId: alheia, pesoPercentual: 50 },
          ],
        });
      } catch (error) {
        caught = error;
      }

      const details = getDetails(caught);
      expect(details).toEqual([
        expect.objectContaining({ field: 'disciplinaId', issue: expect.stringContaining(alheia) }),
      ]);
      expect(prisma.pesoDisciplina.deleteMany).not.toHaveBeenCalled();
    });

    it('disciplina soft-deletada não conta como válida → 422', async () => {
      // findMany filtra deletedAt: null; a soft-deletada não volta na lista.
      prisma.disciplina.findMany.mockResolvedValue([{ id: discA }]);
      await expect(
        service.setPesos(professor, plano.id, {
          pesos: [
            { disciplinaId: discA, pesoPercentual: 50 },
            { disciplinaId: discB, pesoPercentual: 50 },
          ],
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('aluno tentando definir pesos de plano OFICIAL → 403 antes de qualquer validação', async () => {
      await expect(
        service.setPesos(aluno, plano.id, {
          pesos: [{ disciplinaId: discA, pesoPercentual: 100 }],
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('publicar — CA-05/CB-01/RN-05', () => {
    it('plano PESSOAL (mesmo pelo autor) → 422 com field=tipo', async () => {
      prisma.plano.findUnique.mockResolvedValue(
        buildPlano({ tipo: 'PESSOAL', autorId: aluno.sub }),
      );

      let caught: unknown;
      try {
        await service.publicar(aluno, randomUUID());
      } catch (error) {
        caught = error;
      }
      expect(getDetails(caught)).toEqual([
        expect.objectContaining({ field: 'tipo' }),
      ]);
      expect(prisma.plano.update).not.toHaveBeenCalled();
    });

    it('sem disciplinas → 422 com details incluindo field=disciplinas (CB-01)', async () => {
      prisma.plano.findUnique.mockResolvedValue(buildPlano());
      prisma.disciplina.count.mockResolvedValue(0);
      prisma.pesoDisciplina.findMany.mockResolvedValue([]);

      let caught: unknown;
      try {
        await service.publicar(professor, randomUUID());
      } catch (error) {
        caught = error;
      }
      expect(getDetails(caught)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'disciplinas' }),
          { field: 'pesoPercentual', issue: 'soma deve ser 100' },
        ]),
      );
      expect(prisma.plano.update).not.toHaveBeenCalled();
    });

    it('pesos ≠ 100 → 422 com "soma deve ser 100"', async () => {
      const plano = buildPlano();
      prisma.plano.findUnique.mockResolvedValue(plano);
      prisma.disciplina.count.mockResolvedValue(2);
      prisma.pesoDisciplina.findMany.mockResolvedValue([
        buildPeso(plano.id, randomUUID(), '60.00'),
        buildPeso(plano.id, randomUUID(), '39.99'),
      ]);

      let caught: unknown;
      try {
        await service.publicar(professor, plano.id);
      } catch (error) {
        caught = error;
      }
      expect(getDetails(caught)).toEqual([
        { field: 'pesoPercentual', issue: 'soma deve ser 100' },
      ]);
    });

    it('plano consistente → seta publicado=true', async () => {
      const plano = buildPlano();
      prisma.plano.findUnique.mockResolvedValue(plano);
      prisma.disciplina.count.mockResolvedValue(2);
      prisma.pesoDisciplina.findMany.mockResolvedValue([
        buildPeso(plano.id, randomUUID(), '60.00'),
        buildPeso(plano.id, randomUUID(), '40.00'),
      ]);
      prisma.plano.update.mockResolvedValue({ ...plano, publicado: true });

      const result = await service.publicar(professor, plano.id);
      expect(prisma.plano.update).toHaveBeenCalledWith({
        where: { id: plano.id },
        data: { publicado: true },
      });
      expect(result.publicado).toBe(true);
    });

    it('já publicado → idempotente: retorna o plano sem revalidar nem atualizar', async () => {
      const plano = buildPlano({ publicado: true });
      prisma.plano.findUnique.mockResolvedValue(plano);

      const result = await service.publicar(professor, plano.id);
      expect(result.publicado).toBe(true);
      expect(prisma.plano.update).not.toHaveBeenCalled();
      expect(prisma.disciplina.count).not.toHaveBeenCalled();
    });

    it('aluno tentando publicar OFICIAL → 403 (autorização em camada de service)', async () => {
      prisma.plano.findUnique.mockResolvedValue(buildPlano());
      await expect(service.publicar(aluno, randomUUID())).rejects.toThrow(ForbiddenException);
    });
  });

  describe('derivar — CA-06/CA-08/CA-09/CB-04/CB-05/RN-03', () => {
    it('origem inexistente → NotFoundException 404', async () => {
      prisma.plano.findUnique.mockResolvedValue(null);
      await expect(service.derivar(aluno, randomUUID(), {})).rejects.toThrow(NotFoundException);
    });

    it('origem PESSOAL → 422 (CA-08)', async () => {
      prisma.plano.findUnique.mockResolvedValue(
        buildPlano({ tipo: 'PESSOAL', autorId: aluno.sub }),
      );
      await expect(service.derivar(aluno, randomUUID(), {})).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(prisma.plano.create).not.toHaveBeenCalled();
    });

    it('origem OFICIAL não publicada → 422 (CB-05)', async () => {
      prisma.plano.findUnique.mockResolvedValue(buildPlano({ publicado: false }));
      await expect(service.derivar(aluno, randomUUID(), {})).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(prisma.plano.create).not.toHaveBeenCalled();
    });

    it('origem publicada mas com pesos ≠ 100 (inconsistente pós-remoção) → 422 (CB-04)', async () => {
      const origem = buildPlano({ publicado: true });
      prisma.turmaPlano.findFirst.mockResolvedValue({ id: randomUUID() });
      prisma.plano.findUnique.mockResolvedValue(origem);
      prisma.disciplina.count.mockResolvedValue(2);
      prisma.pesoDisciplina.findMany.mockResolvedValue([
        buildPeso(origem.id, randomUUID(), '60.00'),
      ]);

      let caught: unknown;
      try {
        await service.derivar(aluno, origem.id, {});
      } catch (error) {
        caught = error;
      }
      expect(getDetails(caught)).toEqual([
        { field: 'pesoPercentual', issue: 'soma deve ser 100' },
      ]);
      expect(prisma.plano.create).not.toHaveBeenCalled();
    });

    it('deep copy: copia árvore inteira com ids NOVOS, FKs remapeadas e Σ pesos = 100 (CA-06/CA-09)', async () => {
      const origem = buildPlano({ publicado: true, titulo: 'Analista TRF', descricao: 'desc' });
      const d1 = {
        id: randomUUID(),
        planoId: origem.id,
        nome: 'Português',
        ordem: 1,
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
      };
      const d2 = { ...d1, id: randomUUID(), nome: 'Direito', ordem: 2 };
      const t1 = {
        id: randomUUID(),
        disciplinaId: d1.id,
        nome: 'Colocação pronominal',
        ordem: 1,
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
      };
      const s1 = {
        id: randomUUID(),
        temaId: t1.id,
        nome: 'Mesóclise',
        ordem: 1,
        duracaoEstimadaMin: 30,
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
      };
      const pesos = [buildPeso(origem.id, d1.id, '60.00'), buildPeso(origem.id, d2.id, '40.00')];

      // vínculo TurmaPlano + matrícula ATIVA do aluno (regra de matrícula)
      prisma.turmaPlano.findFirst.mockResolvedValue({ id: randomUUID() });
      // loadPlanoOrThrow
      prisma.plano.findUnique.mockResolvedValueOnce(origem);
      // assertPlanoConsistente
      prisma.disciplina.count.mockResolvedValue(2);
      prisma.pesoDisciplina.findMany.mockResolvedValue(pesos);
      // árvore da origem
      prisma.plano.findUniqueOrThrow.mockResolvedValue({
        ...origem,
        disciplinas: [
          { ...d1, temas: [{ ...t1, subtemas: [s1] }] },
          { ...d2, temas: [] },
        ],
        pesos,
      });

      const novo = buildPlano({
        id: randomUUID(),
        tipo: 'PESSOAL',
        autorId: aluno.sub,
        planoOrigemId: origem.id,
        titulo: 'Analista TRF (pessoal)',
      });
      const d1Copy = { ...d1, id: randomUUID(), planoId: novo.id };
      const d2Copy = { ...d2, id: randomUUID(), planoId: novo.id };
      const t1Copy = { ...t1, id: randomUUID(), disciplinaId: d1Copy.id };
      const s1Copy = { ...s1, id: randomUUID(), temaId: t1Copy.id };

      prisma.plano.create.mockResolvedValue(novo);
      prisma.disciplina.createMany.mockResolvedValue({ count: 2 });
      prisma.tema.createMany.mockResolvedValue({ count: 1 });
      prisma.subtema.createMany.mockResolvedValue({ count: 1 });
      prisma.pesoDisciplina.createMany.mockResolvedValue({ count: 2 });

      // getTree do plano novo
      prisma.plano.findUnique.mockResolvedValueOnce({
        ...novo,
        disciplinas: [
          { ...d1Copy, temas: [{ ...t1Copy, subtemas: [s1Copy] }] },
          { ...d2Copy, temas: [] },
        ],
        pesos: [buildPeso(novo.id, d1Copy.id, '60.00'), buildPeso(novo.id, d2Copy.id, '40.00')],
      });

      const result = await service.derivar(aluno, origem.id, {});

      // Plano novo: PESSOAL, autor = aluno, rastreabilidade, título default e
      // id pré-gerado em memória (cópia em lote via createMany).
      expect(prisma.plano.create).toHaveBeenCalledWith({
        data: {
          id: expect.any(String),
          titulo: 'Analista TRF (pessoal)',
          descricao: 'desc',
          tipo: 'PESSOAL',
          autorId: aluno.sub,
          planoOrigemId: origem.id,
        },
      });
      const novoPlanoId = (
        prisma.plano.create.mock.calls[0][0] as { data: { id: string } }
      ).data.id;

      // Disciplinas copiadas em lote, com ids NOVOS, apontando para o plano NOVO
      const disciplinasData = prisma.disciplina.createMany.mock.calls[0][0].data as Array<{
        id: string;
        planoId: string;
        nome: string;
        ordem: number;
      }>;
      expect(disciplinasData).toEqual([
        { id: expect.any(String), planoId: novoPlanoId, nome: 'Português', ordem: 1 },
        { id: expect.any(String), planoId: novoPlanoId, nome: 'Direito', ordem: 2 },
      ]);
      const [d1CopyId, d2CopyId] = disciplinasData.map((d) => d.id);
      expect([d1CopyId, d2CopyId]).not.toContain(d1.id);
      expect([d1CopyId, d2CopyId]).not.toContain(d2.id);

      // Tema remapeado para o id COPIADO da disciplina (não o original)
      const temasData = prisma.tema.createMany.mock.calls[0][0].data as Array<{
        id: string;
        disciplinaId: string;
        nome: string;
        ordem: number;
      }>;
      expect(temasData).toEqual([
        { id: expect.any(String), disciplinaId: d1CopyId, nome: 'Colocação pronominal', ordem: 1 },
      ]);

      // Subtema remapeado para o tema copiado, preservando duração
      expect(prisma.subtema.createMany).toHaveBeenCalledWith({
        data: [{ temaId: temasData[0].id, nome: 'Mesóclise', ordem: 1, duracaoEstimadaMin: 30 }],
      });

      // Pesos remapeados; Σ dos pesos copiados = 100 (CA-09)
      const pesosData = prisma.pesoDisciplina.createMany.mock.calls[0][0].data as Array<{
        planoId: string;
        disciplinaId: string;
        pesoPercentual: Prisma.Decimal;
      }>;
      expect(pesosData.map((p) => p.disciplinaId).sort()).toEqual(
        [d1CopyId, d2CopyId].sort(),
      );
      expect(pesosData.every((p) => p.planoId === novoPlanoId)).toBe(true);
      const soma = pesosData.reduce((acc, p) => acc.plus(p.pesoPercentual), decimal(0));
      expect(soma.equals(decimal(100))).toBe(true);

      // Resposta: novo plano com ids próprios (nenhum id da origem reaparece)
      expect(result).toMatchObject({
        tipo: 'PESSOAL',
        autorId: aluno.sub,
        planoOrigemId: origem.id,
      });
      const idsOrigem = [origem.id, d1.id, d2.id, t1.id, s1.id];
      const idsCopia = [
        result.id,
        ...(result.disciplinas ?? []).flatMap((d) => [
          d.id,
          ...(d.temas ?? []).flatMap((t) => [t.id, ...(t.subtemas ?? []).map((s) => s.id)]),
        ]),
      ];
      expect(idsCopia.filter((id) => idsOrigem.includes(id))).toEqual([]);
    });

    it('respeita titulo customizado do body', async () => {
      const origem = buildPlano({ publicado: true });
      prisma.turmaPlano.findFirst.mockResolvedValue({ id: randomUUID() });
      prisma.plano.findUnique.mockResolvedValueOnce(origem);
      prisma.disciplina.count.mockResolvedValue(1);
      prisma.pesoDisciplina.findMany.mockResolvedValue([
        buildPeso(origem.id, randomUUID(), '100.00'),
      ]);
      prisma.plano.findUniqueOrThrow.mockResolvedValue({
        ...origem,
        disciplinas: [],
        pesos: [],
      });
      const novo = buildPlano({ tipo: 'PESSOAL', titulo: 'Meu plano', autorId: aluno.sub });
      prisma.plano.create.mockResolvedValue(novo);
      prisma.plano.findUnique.mockResolvedValueOnce({ ...novo, disciplinas: [], pesos: [] });

      await service.derivar(aluno, origem.id, { titulo: 'Meu plano' });
      expect(prisma.plano.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ titulo: 'Meu plano' }),
      });
    });
  });
});
