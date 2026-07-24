import { randomUUID } from 'node:crypto';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Disciplina, Plano, Subtema, Tema } from '@prisma/client';
import { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { PrismaService } from '../../prisma/prisma.service';
import { DisciplinasService } from './disciplinas.service';
import { PlanosAccessService } from './planos-access.service';
import { SubtemasService } from './subtemas.service';
import { TemasService } from './temas.service';

const NOW = new Date('2026-07-06T12:00:00Z');

function buildUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return { sub: randomUUID(), role: 'ALUNO', origem: 'PROPRIO', ...overrides };
}

function buildPlano(overrides: Partial<Plano> = {}): Plano {
  return {
    id: randomUUID(),
    titulo: 'Plano',
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

function buildDisciplina(planoId: string, overrides: Partial<Disciplina> = {}): Disciplina {
  return {
    id: randomUUID(),
    planoId,
    nome: 'Português',
    ordem: 1,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

function buildTema(disciplinaId: string, overrides: Partial<Tema> = {}): Tema {
  return {
    id: randomUUID(),
    disciplinaId,
    nome: 'Colocação pronominal',
    ordem: 1,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

function buildSubtema(temaId: string, overrides: Partial<Subtema> = {}): Subtema {
  return {
    id: randomUUID(),
    temaId,
    nome: 'Mesóclise',
    ordem: 1,
    duracaoEstimadaMin: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

type ModelMock = Record<
  'findUnique' | 'findMany' | 'create' | 'update' | 'updateMany',
  jest.Mock
>;

function modelMock(): ModelMock {
  return {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  };
}

describe('Disciplinas/Temas/Subtemas services (unit)', () => {
  let prisma: {
    plano: ModelMock;
    disciplina: ModelMock;
    tema: ModelMock;
    subtema: ModelMock;
    pesoDisciplina: ModelMock;
    turmaPlano: { findFirst: jest.Mock };
    $transaction: jest.Mock;
  };
  let disciplinas: DisciplinasService;
  let temas: TemasService;
  let subtemas: SubtemasService;

  const professor = buildUser({ role: 'PROFESSOR' });
  const aluno = buildUser({ role: 'ALUNO' });
  const outroAluno = buildUser({ role: 'ALUNO' });

  beforeEach(() => {
    prisma = {
      plano: modelMock(),
      disciplina: modelMock(),
      tema: modelMock(),
      subtema: modelMock(),
      pesoDisciplina: modelMock(),
      // Regra de matrícula do access service; default sem vínculo.
      turmaPlano: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((arg: unknown): Promise<unknown> => Promise.all(arg as unknown[])),
    };
    const access = new PlanosAccessService(prisma as unknown as PrismaService);
    disciplinas = new DisciplinasService(prisma as unknown as PrismaService, access);
    temas = new TemasService(prisma as unknown as PrismaService, access);
    subtemas = new SubtemasService(prisma as unknown as PrismaService, access);
  });

  describe('CA-10 — pai inexistente ou soft-deletado → 404', () => {
    it('criar disciplina em plano inexistente → 404', async () => {
      prisma.plano.findUnique.mockResolvedValue(null);
      await expect(
        disciplinas.create(professor, randomUUID(), { nome: 'Português', ordem: 1 }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.disciplina.create).not.toHaveBeenCalled();
    });

    it('criar disciplina em plano soft-deletado → 404', async () => {
      prisma.plano.findUnique.mockResolvedValue(buildPlano({ deletedAt: NOW }));
      await expect(
        disciplinas.create(professor, randomUUID(), { nome: 'Português', ordem: 1 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('criar tema em disciplina inexistente → 404', async () => {
      prisma.disciplina.findUnique.mockResolvedValue(null);
      await expect(
        temas.create(professor, randomUUID(), { nome: 'Tema', ordem: 1 }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.tema.create).not.toHaveBeenCalled();
    });

    it('criar tema em disciplina soft-deletada → 404', async () => {
      const plano = buildPlano();
      prisma.disciplina.findUnique.mockResolvedValue({
        ...buildDisciplina(plano.id, { deletedAt: NOW }),
        plano,
      });
      await expect(
        temas.create(professor, randomUUID(), { nome: 'Tema', ordem: 1 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('criar tema em disciplina cujo PLANO foi soft-deletado → 404 (cadeia inteira)', async () => {
      const plano = buildPlano({ deletedAt: NOW });
      prisma.disciplina.findUnique.mockResolvedValue({ ...buildDisciplina(plano.id), plano });
      await expect(
        temas.create(professor, randomUUID(), { nome: 'Tema', ordem: 1 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('criar subtema em tema inexistente → 404', async () => {
      prisma.tema.findUnique.mockResolvedValue(null);
      await expect(
        subtemas.create(professor, randomUUID(), { nome: 'Subtema', ordem: 1 }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.subtema.create).not.toHaveBeenCalled();
    });

    it('criar subtema em tema soft-deletado → 404', async () => {
      const plano = buildPlano();
      const disciplina = buildDisciplina(plano.id);
      prisma.tema.findUnique.mockResolvedValue({
        ...buildTema(disciplina.id, { deletedAt: NOW }),
        disciplina: { ...disciplina, plano },
      });
      await expect(
        subtemas.create(professor, randomUUID(), { nome: 'Subtema', ordem: 1 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('CA-12 — autorização herdada do plano', () => {
    it('aluno criando disciplina em plano OFICIAL → 403', async () => {
      prisma.plano.findUnique.mockResolvedValue(buildPlano({ publicado: true }));
      await expect(
        disciplinas.create(aluno, randomUUID(), { nome: 'Português', ordem: 1 }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.disciplina.create).not.toHaveBeenCalled();
    });

    it('aluno editando disciplina de plano PESSOAL de outro aluno → 403', async () => {
      const plano = buildPlano({ tipo: 'PESSOAL', autorId: outroAluno.sub });
      prisma.disciplina.findUnique.mockResolvedValue({ ...buildDisciplina(plano.id), plano });
      await expect(disciplinas.update(aluno, randomUUID(), { nome: 'X' })).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.disciplina.update).not.toHaveBeenCalled();
    });

    it('aluno editando TEMA de plano OFICIAL (rota top-level) → 403', async () => {
      const plano = buildPlano({ publicado: true });
      const disciplina = buildDisciplina(plano.id);
      prisma.tema.findUnique.mockResolvedValue({
        ...buildTema(disciplina.id),
        disciplina: { ...disciplina, plano },
      });
      await expect(temas.update(aluno, randomUUID(), { nome: 'X' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('aluno removendo SUBTEMA de plano PESSOAL alheio → 403', async () => {
      const plano = buildPlano({ tipo: 'PESSOAL', autorId: outroAluno.sub });
      const disciplina = buildDisciplina(plano.id);
      const tema = buildTema(disciplina.id);
      prisma.subtema.findUnique.mockResolvedValue({
        ...buildSubtema(tema.id),
        tema: { ...tema, disciplina: { ...disciplina, plano } },
      });
      await expect(subtemas.remove(aluno, randomUUID())).rejects.toThrow(ForbiddenException);
      expect(prisma.subtema.update).not.toHaveBeenCalled();
    });

    it('leitura de PESSOAL alheio (listar disciplinas) → 403; OFICIAL publicado de turma matriculada → permitido', async () => {
      prisma.plano.findUnique.mockResolvedValueOnce(
        buildPlano({ tipo: 'PESSOAL', autorId: outroAluno.sub }),
      );
      await expect(disciplinas.listByPlano(aluno, randomUUID())).rejects.toThrow(
        ForbiddenException,
      );

      // vínculo TurmaPlano + matrícula ATIVA (regra de matrícula)
      prisma.turmaPlano.findFirst.mockResolvedValue({ id: randomUUID() });
      prisma.plano.findUnique.mockResolvedValueOnce(buildPlano({ publicado: true }));
      prisma.disciplina.findMany.mockResolvedValue([]);
      await expect(disciplinas.listByPlano(aluno, randomUUID())).resolves.toEqual([]);
    });

    it('autor do PESSOAL pode criar disciplina', async () => {
      const plano = buildPlano({ tipo: 'PESSOAL', autorId: aluno.sub });
      prisma.plano.findUnique.mockResolvedValue(plano);
      prisma.disciplina.create.mockResolvedValue(buildDisciplina(plano.id));

      await expect(
        disciplinas.create(aluno, plano.id, { nome: 'Português', ordem: 1 }),
      ).resolves.toMatchObject({ planoId: plano.id, nome: 'Português' });
      expect(prisma.disciplina.create).toHaveBeenCalledWith({
        data: { planoId: plano.id, nome: 'Português', ordem: 1 },
      });
    });
  });

  describe('CB-04 — remoção de disciplina soft-deleta temas, subtemas e o peso associado', () => {
    it('DisciplinasService.remove marca deletedAt em cascata, em transação', async () => {
      const plano = buildPlano({ autorId: professor.sub });
      const disciplina = buildDisciplina(plano.id);
      prisma.disciplina.findUnique.mockResolvedValue({ ...disciplina, plano });
      prisma.subtema.updateMany.mockResolvedValue({ count: 2 });
      prisma.tema.updateMany.mockResolvedValue({ count: 1 });
      prisma.pesoDisciplina.updateMany.mockResolvedValue({ count: 1 });
      prisma.disciplina.update.mockResolvedValue({ ...disciplina, deletedAt: NOW });

      await disciplinas.remove(professor, disciplina.id);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.subtema.updateMany).toHaveBeenCalledWith({
        where: { deletedAt: null, tema: { disciplinaId: disciplina.id } },
        data: { deletedAt: expect.any(Date) },
      });
      expect(prisma.tema.updateMany).toHaveBeenCalledWith({
        where: { deletedAt: null, disciplinaId: disciplina.id },
        data: { deletedAt: expect.any(Date) },
      });
      expect(prisma.pesoDisciplina.updateMany).toHaveBeenCalledWith({
        where: { deletedAt: null, disciplinaId: disciplina.id },
        data: { deletedAt: expect.any(Date) },
      });
      expect(prisma.disciplina.update).toHaveBeenCalledWith({
        where: { id: disciplina.id },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('TemasService.remove soft-deleta o tema e seus subtemas', async () => {
      const plano = buildPlano({ autorId: professor.sub });
      const disciplina = buildDisciplina(plano.id);
      const tema = buildTema(disciplina.id);
      prisma.tema.findUnique.mockResolvedValue({ ...tema, disciplina: { ...disciplina, plano } });
      prisma.subtema.updateMany.mockResolvedValue({ count: 2 });
      prisma.tema.update.mockResolvedValue({ ...tema, deletedAt: NOW });

      await temas.remove(professor, tema.id);

      expect(prisma.subtema.updateMany).toHaveBeenCalledWith({
        where: { deletedAt: null, temaId: tema.id },
        data: { deletedAt: expect.any(Date) },
      });
      expect(prisma.tema.update).toHaveBeenCalledWith({
        where: { id: tema.id },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('SubtemasService.remove soft-deleta apenas o subtema', async () => {
      const plano = buildPlano({ autorId: professor.sub });
      const disciplina = buildDisciplina(plano.id);
      const tema = buildTema(disciplina.id);
      const subtema = buildSubtema(tema.id);
      prisma.subtema.findUnique.mockResolvedValue({
        ...subtema,
        tema: { ...tema, disciplina: { ...disciplina, plano } },
      });
      prisma.subtema.update.mockResolvedValue({ ...subtema, deletedAt: NOW });

      await subtemas.remove(professor, subtema.id);

      expect(prisma.subtema.update).toHaveBeenCalledWith({
        where: { id: subtema.id },
        data: { deletedAt: expect.any(Date) },
      });
      expect(prisma.tema.update).not.toHaveBeenCalled();
    });
  });

  describe('caminho feliz de temas e subtemas', () => {
    const plano = buildPlano({ autorId: professor.sub });
    const disciplina = buildDisciplina(plano.id);
    const tema = buildTema(disciplina.id);

    it('cria tema em disciplina ativa do plano', async () => {
      prisma.disciplina.findUnique.mockResolvedValue({ ...disciplina, plano });
      prisma.tema.create.mockResolvedValue(tema);

      const result = await temas.create(professor, disciplina.id, {
        nome: 'Colocação pronominal',
        ordem: 1,
      });
      expect(prisma.tema.create).toHaveBeenCalledWith({
        data: { disciplinaId: disciplina.id, nome: 'Colocação pronominal', ordem: 1 },
      });
      expect(result).toMatchObject({ disciplinaId: disciplina.id, nome: 'Colocação pronominal' });
    });

    it('atualiza nome/ordem do tema (reordenação via `ordem`, RN-07)', async () => {
      prisma.tema.findUnique.mockResolvedValue({ ...tema, disciplina: { ...disciplina, plano } });
      prisma.tema.update.mockResolvedValue({ ...tema, ordem: 5 });

      const result = await temas.update(professor, tema.id, { ordem: 5 });
      expect(prisma.tema.update).toHaveBeenCalledWith({
        where: { id: tema.id },
        data: { ordem: 5 },
      });
      expect(result.ordem).toBe(5);
    });

    it('lista temas da disciplina com subtemas, apenas ativos e ordenados', async () => {
      prisma.disciplina.findUnique.mockResolvedValue({ ...disciplina, plano });
      prisma.tema.findMany.mockResolvedValue([{ ...tema, subtemas: [buildSubtema(tema.id)] }]);

      const result = await temas.listByDisciplina(professor, disciplina.id);
      expect(prisma.tema.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { disciplinaId: disciplina.id, deletedAt: null },
          orderBy: { ordem: 'asc' },
        }),
      );
      expect(result[0].subtemas).toHaveLength(1);
    });

    it('cria subtema com duracaoEstimadaMin opcional (default null)', async () => {
      prisma.tema.findUnique.mockResolvedValue({ ...tema, disciplina: { ...disciplina, plano } });
      prisma.subtema.create.mockResolvedValue(buildSubtema(tema.id));

      await subtemas.create(professor, tema.id, { nome: 'Mesóclise', ordem: 1 });
      expect(prisma.subtema.create).toHaveBeenCalledWith({
        data: { temaId: tema.id, nome: 'Mesóclise', ordem: 1, duracaoEstimadaMin: null },
      });

      prisma.subtema.create.mockResolvedValue(
        buildSubtema(tema.id, { duracaoEstimadaMin: 45 }),
      );
      const comDuracao = await subtemas.create(professor, tema.id, {
        nome: 'Próclise',
        ordem: 2,
        duracaoEstimadaMin: 45,
      });
      expect(prisma.subtema.create).toHaveBeenLastCalledWith({
        data: { temaId: tema.id, nome: 'Próclise', ordem: 2, duracaoEstimadaMin: 45 },
      });
      expect(comDuracao.duracaoEstimadaMin).toBe(45);
    });

    it('atualiza campos parciais do subtema sem tocar os demais', async () => {
      const subtema = buildSubtema(tema.id);
      prisma.subtema.findUnique.mockResolvedValue({
        ...subtema,
        tema: { ...tema, disciplina: { ...disciplina, plano } },
      });
      prisma.subtema.update.mockResolvedValue({ ...subtema, duracaoEstimadaMin: 20 });

      await subtemas.update(professor, subtema.id, { duracaoEstimadaMin: 20 });
      expect(prisma.subtema.update).toHaveBeenCalledWith({
        where: { id: subtema.id },
        data: { duracaoEstimadaMin: 20 },
      });
    });
  });

  describe('listagem filtra soft-deletados e ordena por `ordem` (RN-07)', () => {
    it('listByPlano consulta apenas registros ativos, ordenados', async () => {
      const plano = buildPlano({ publicado: true });
      prisma.turmaPlano.findFirst.mockResolvedValue({ id: randomUUID() });
      prisma.plano.findUnique.mockResolvedValue(plano);
      prisma.disciplina.findMany.mockResolvedValue([]);

      await disciplinas.listByPlano(aluno, plano.id);

      expect(prisma.disciplina.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { planoId: plano.id, deletedAt: null },
          orderBy: { ordem: 'asc' },
        }),
      );
    });

    it('listByTema (subtemas) idem', async () => {
      const plano = buildPlano({ publicado: true });
      prisma.turmaPlano.findFirst.mockResolvedValue({ id: randomUUID() });
      const disciplina = buildDisciplina(plano.id);
      const tema = buildTema(disciplina.id);
      prisma.tema.findUnique.mockResolvedValue({ ...tema, disciplina: { ...disciplina, plano } });
      prisma.subtema.findMany.mockResolvedValue([]);

      await subtemas.listByTema(aluno, tema.id);

      expect(prisma.subtema.findMany).toHaveBeenCalledWith({
        where: { temaId: tema.id, deletedAt: null },
        orderBy: { ordem: 'asc' },
      });
    });
  });
});
