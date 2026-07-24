import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { MatriculaStatus, Plano, PlanoTipo, Prisma, Role, Turma } from '@prisma/client';
import { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { PrismaService } from '../../prisma/prisma.service';
import { PlanosAccessService } from '../planos/planos-access.service';
import { TurmaPlanosService } from './turma-planos.service';
import { TurmasAccessService } from './turmas-access.service';

const NOW = new Date('2026-07-07T12:00:00Z');

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '6.8.0',
  });
}

function buildUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return { sub: randomUUID(), role: Role.PROFESSOR, origem: 'PROPRIO', ...overrides };
}

function buildTurma(overrides: Partial<Turma> = {}): Turma {
  return {
    id: randomUUID(),
    nome: 'Turma Alfa',
    descricao: null,
    professorId: randomUUID(),
    codigoConvite: 'ABCD2345',
    ativa: true,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

function buildPlano(overrides: Partial<Plano> = {}): Plano {
  return {
    id: randomUUID(),
    titulo: 'Analista Turmas',
    descricao: null,
    tipo: PlanoTipo.OFICIAL,
    autorId: randomUUID(),
    planoOrigemId: null,
    publicado: true,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

type ModelMock = {
  findUnique: jest.Mock;
  findMany: jest.Mock;
  count: jest.Mock;
  create: jest.Mock;
  deleteMany: jest.Mock;
};

function modelMock(): ModelMock {
  return {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    deleteMany: jest.fn(),
  };
}

interface UnprocessableBody {
  message: string;
  details: Array<{ field: string; issue: string }>;
}

async function capture422(promise: Promise<unknown>): Promise<UnprocessableBody> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    return (error as UnprocessableEntityException).getResponse() as UnprocessableBody;
  }
  throw new Error('esperava UnprocessableEntityException, mas a promise resolveu');
}

describe('TurmaPlanosService (unit)', () => {
  let prisma: {
    turma: ModelMock;
    matricula: ModelMock;
    plano: ModelMock;
    turmaPlano: ModelMock;
    $transaction: jest.Mock;
  };
  let service: TurmaPlanosService;

  const professor = buildUser();
  const outroProfessor = buildUser();
  const admin = buildUser({ role: Role.ADMIN });
  const moderador = buildUser({ role: Role.MODERADOR });
  const aluno = buildUser({ role: Role.ALUNO });

  const turma = buildTurma({ professorId: professor.sub });

  beforeEach(() => {
    prisma = {
      turma: modelMock(),
      matricula: modelMock(),
      plano: modelMock(),
      turmaPlano: modelMock(),
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    service = new TurmaPlanosService(
      prisma as unknown as PrismaService,
      new TurmasAccessService(prisma as unknown as PrismaService),
      new PlanosAccessService(prisma as unknown as PrismaService),
    );
    prisma.turma.findUnique.mockResolvedValue(turma);
  });

  // ---------------------------------------------------------------------------
  // vincular — RN-06 (OFICIAL + publicado), 409 unique, escopo
  // ---------------------------------------------------------------------------

  describe('vincular', () => {
    const plano = buildPlano();

    beforeEach(() => {
      prisma.plano.findUnique.mockResolvedValue(plano);
      prisma.turmaPlano.create.mockResolvedValue({
        id: randomUUID(),
        turmaId: turma.id,
        planoId: plano.id,
        createdAt: NOW,
        updatedAt: NOW,
        plano: { id: plano.id, titulo: plano.titulo, tipo: plano.tipo, publicado: true },
      });
    });

    it('plano OFICIAL publicado → cria vínculo com resumo do plano', async () => {
      const result = await service.vincular(professor, turma.id, { planoId: plano.id });

      expect(prisma.turmaPlano.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: { turmaId: turma.id, planoId: plano.id } }),
      );
      expect(result).toMatchObject({
        turmaId: turma.id,
        planoId: plano.id,
        plano: { id: plano.id, titulo: plano.titulo, tipo: PlanoTipo.OFICIAL, publicado: true },
      });
    });

    it('autoria não importa: OFICIAL publicado de OUTRO autor é vinculável (caso de borda)', async () => {
      prisma.plano.findUnique.mockResolvedValue(buildPlano({ autorId: outroProfessor.sub }));
      await expect(
        service.vincular(professor, turma.id, { planoId: plano.id }),
      ).resolves.toBeDefined();
    });

    it('plano PESSOAL → 422 com details {field: planoId, issue OFICIAL} (RN-06)', async () => {
      prisma.plano.findUnique.mockResolvedValue(
        buildPlano({ tipo: PlanoTipo.PESSOAL, publicado: false }),
      );

      const body = await capture422(service.vincular(professor, turma.id, { planoId: plano.id }));

      expect(body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'planoId', issue: expect.stringContaining('OFICIAL') }),
        ]),
      );
      expect(prisma.turmaPlano.create).not.toHaveBeenCalled();
    });

    it('OFICIAL NÃO publicado → 422 com details de publicação', async () => {
      prisma.plano.findUnique.mockResolvedValue(buildPlano({ publicado: false }));

      const body = await capture422(service.vincular(professor, turma.id, { planoId: plano.id }));

      expect(body.details).toEqual([
        expect.objectContaining({ field: 'planoId', issue: expect.stringContaining('publicado') }),
      ]);
      expect(prisma.turmaPlano.create).not.toHaveBeenCalled();
    });

    it('vínculo duplicado (P2002 no unique turma_id+plano_id) → 409', async () => {
      prisma.turmaPlano.create.mockRejectedValue(p2002());
      await expect(
        service.vincular(professor, turma.id, { planoId: plano.id }),
      ).rejects.toThrow(ConflictException);
    });

    it('plano inexistente ou soft-deleted → 404', async () => {
      prisma.plano.findUnique.mockResolvedValue(null);
      await expect(
        service.vincular(professor, turma.id, { planoId: randomUUID() }),
      ).rejects.toThrow(NotFoundException);

      prisma.plano.findUnique.mockResolvedValue(buildPlano({ deletedAt: NOW }));
      await expect(
        service.vincular(professor, turma.id, { planoId: plano.id }),
      ).rejects.toThrow(NotFoundException);
    });

    it('professor não-dono → 403 sem sequer carregar o plano; ADMIN/MODERADOR passam', async () => {
      await expect(
        service.vincular(outroProfessor, turma.id, { planoId: plano.id }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.plano.findUnique).not.toHaveBeenCalled();
      expect(prisma.turmaPlano.create).not.toHaveBeenCalled();

      for (const user of [admin, moderador]) {
        await expect(
          service.vincular(user, turma.id, { planoId: plano.id }),
        ).resolves.toBeDefined();
      }
    });

    it('turma inexistente/soft-deleted → 404 antes de tudo', async () => {
      prisma.turma.findUnique.mockResolvedValue(null);
      await expect(
        service.vincular(professor, randomUUID(), { planoId: plano.id }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // listByTurma — dono/moderação OU aluno com matrícula ATIVA (RN-07)
  // ---------------------------------------------------------------------------

  describe('listByTurma', () => {
    const query = { page: 1, pageSize: 20 };

    beforeEach(() => {
      const plano = buildPlano();
      prisma.turmaPlano.findMany.mockResolvedValue([
        {
          id: randomUUID(),
          turmaId: turma.id,
          planoId: plano.id,
          createdAt: NOW,
          updatedAt: NOW,
          plano: { id: plano.id, titulo: plano.titulo, tipo: plano.tipo, publicado: true },
        },
      ]);
      prisma.turmaPlano.count.mockResolvedValue(1);
    });

    it('dono lista paginado, excluindo planos soft-deleted do vínculo', async () => {
      const result = await service.listByTurma(professor, turma.id, query);

      expect(prisma.turmaPlano.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { turmaId: turma.id, plano: { deletedAt: null } },
        }),
      );
      expect(result).toMatchObject({ page: 1, pageSize: 20, total: 1 });
      expect(result.data[0].plano).toMatchObject({ tipo: PlanoTipo.OFICIAL, publicado: true });
    });

    it('aluno com matrícula ATIVA lista os planos da turma', async () => {
      prisma.matricula.findUnique.mockResolvedValue({
        id: randomUUID(),
        status: MatriculaStatus.ATIVA,
        deletedAt: null,
      });
      const result = await service.listByTurma(aluno, turma.id, query);
      expect(result.total).toBe(1);
    });

    it('REGRESSÃO review: para o ALUNO o where filtra publicado:true (despublicado pós-vínculo some)', async () => {
      // O GET do plano despublicado daria 403 para o aluno; listar o vínculo
      // vazaria dado inacessível (RN-06/RN-07).
      prisma.matricula.findUnique.mockResolvedValue({
        id: randomUUID(),
        status: MatriculaStatus.ATIVA,
        deletedAt: null,
      });

      await service.listByTurma(aluno, turma.id, query);

      expect(prisma.turmaPlano.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { turmaId: turma.id, plano: { deletedAt: null, publicado: true } },
        }),
      );
      expect(prisma.turmaPlano.count).toHaveBeenCalledWith({
        where: { turmaId: turma.id, plano: { deletedAt: null, publicado: true } },
      });
    });

    it('REGRESSÃO review: gestor (dono/ADMIN/MODERADOR) lista SEM filtro de publicado (vê tudo para desvincular)', async () => {
      for (const user of [professor, admin, moderador]) {
        prisma.turmaPlano.findMany.mockClear();
        await service.listByTurma(user, turma.id, query);
        expect(prisma.turmaPlano.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { turmaId: turma.id, plano: { deletedAt: null } },
          }),
        );
      }
    });

    it('aluno SEM matrícula → 403; com matrícula INATIVA → 403; soft-deleted → 403', async () => {
      const casos = [
        null,
        { id: randomUUID(), status: MatriculaStatus.INATIVA, deletedAt: null },
        { id: randomUUID(), status: MatriculaStatus.ATIVA, deletedAt: NOW },
      ];
      for (const matricula of casos) {
        prisma.matricula.findUnique.mockResolvedValue(matricula);
        await expect(service.listByTurma(aluno, turma.id, query)).rejects.toThrow(
          ForbiddenException,
        );
      }
      expect(prisma.turmaPlano.findMany).not.toHaveBeenCalled();
    });

    it('professor não-dono → 403; ADMIN/MODERADOR passam', async () => {
      await expect(service.listByTurma(outroProfessor, turma.id, query)).rejects.toThrow(
        ForbiddenException,
      );
      for (const user of [admin, moderador]) {
        await expect(service.listByTurma(user, turma.id, query)).resolves.toMatchObject({
          total: 1,
        });
      }
    });
  });

  // ---------------------------------------------------------------------------
  // desvincular — hard delete; já removido → 404
  // ---------------------------------------------------------------------------

  describe('desvincular', () => {
    const planoId = randomUUID();

    it('dono desvincula: hard delete por (turmaId, planoId)', async () => {
      prisma.turmaPlano.deleteMany.mockResolvedValue({ count: 1 });

      await expect(service.desvincular(professor, turma.id, planoId)).resolves.toBeUndefined();
      expect(prisma.turmaPlano.deleteMany).toHaveBeenCalledWith({
        where: { turmaId: turma.id, planoId },
      });
    });

    it('vínculo já removido (count 0) → 404', async () => {
      prisma.turmaPlano.deleteMany.mockResolvedValue({ count: 0 });
      await expect(service.desvincular(professor, turma.id, planoId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('professor não-dono → 403 sem deletar; ADMIN/MODERADOR passam', async () => {
      prisma.turmaPlano.deleteMany.mockResolvedValue({ count: 1 });

      await expect(service.desvincular(outroProfessor, turma.id, planoId)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.turmaPlano.deleteMany).not.toHaveBeenCalled();

      for (const user of [admin, moderador]) {
        await expect(service.desvincular(user, turma.id, planoId)).resolves.toBeUndefined();
      }
    });

    it('turma soft-deleted → 404', async () => {
      prisma.turma.findUnique.mockResolvedValue(buildTurma({ deletedAt: NOW }));
      await expect(service.desvincular(professor, turma.id, planoId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
