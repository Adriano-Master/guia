import { randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Matricula, MatriculaStatus, Prisma, Role, Turma } from '@prisma/client';
import { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { PrismaService } from '../../prisma/prisma.service';
import { MatriculasService } from './matriculas.service';
import { TurmasAccessService } from './turmas-access.service';

const NOW = new Date('2026-07-07T12:00:00Z');

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '6.8.0',
  });
}

function buildUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return { sub: randomUUID(), role: Role.ALUNO, origem: 'PROPRIO', ...overrides };
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

function buildMatricula(overrides: Partial<Matricula> = {}): Matricula {
  return {
    id: randomUUID(),
    turmaId: randomUUID(),
    alunoId: randomUUID(),
    status: MatriculaStatus.ATIVA,
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
  update: jest.Mock;
};

function modelMock(): ModelMock {
  return {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
}

describe('MatriculasService (unit)', () => {
  let prisma: {
    turma: ModelMock;
    matricula: ModelMock;
    $transaction: jest.Mock;
  };
  let service: MatriculasService;

  const aluno = buildUser();
  const outroAluno = buildUser();
  const professor = buildUser({ role: Role.PROFESSOR });
  const outroProfessor = buildUser({ role: Role.PROFESSOR });
  const admin = buildUser({ role: Role.ADMIN });
  const moderador = buildUser({ role: Role.MODERADOR });

  beforeEach(() => {
    prisma = {
      turma: modelMock(),
      matricula: modelMock(),
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    service = new MatriculasService(
      prisma as unknown as PrismaService,
      new TurmasAccessService(prisma as unknown as PrismaService),
    );
  });

  // ---------------------------------------------------------------------------
  // matricular — 404 / 409 / criação / reativação / corrida
  // ---------------------------------------------------------------------------

  describe('matricular', () => {
    const turma = buildTurma({ professorId: professor.sub });

    beforeEach(() => {
      prisma.turma.findUnique.mockResolvedValue(turma);
      prisma.matricula.findUnique.mockResolvedValue(null);
      prisma.matricula.create.mockImplementation(({ data }: { data: Partial<Matricula> }) =>
        Promise.resolve({
          ...buildMatricula({ ...data }),
          turma: { id: turma.id, nome: turma.nome, descricao: null, ativa: true },
        }),
      );
    });

    it('código inválido (turma não encontrada) → 404', async () => {
      prisma.turma.findUnique.mockResolvedValue(null);
      await expect(service.matricular(aluno, { codigoConvite: 'NAOEXIST' })).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.matricula.create).not.toHaveBeenCalled();
    });

    it('turma soft-deleted → 404 (código antigo deixa de resolver)', async () => {
      prisma.turma.findUnique.mockResolvedValue(buildTurma({ deletedAt: NOW }));
      await expect(service.matricular(aluno, { codigoConvite: 'ABCD2345' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('turma ativa=false → 409 (RN-05: bloqueia novas matrículas)', async () => {
      prisma.turma.findUnique.mockResolvedValue(buildTurma({ ativa: false }));
      await expect(service.matricular(aluno, { codigoConvite: 'ABCD2345' })).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.matricula.create).not.toHaveBeenCalled();
      expect(prisma.matricula.update).not.toHaveBeenCalled();
    });

    it('sem matrícula prévia → cria ATIVA com (turmaId, alunoId) e reativada=false (201)', async () => {
      const result = await service.matricular(aluno, { codigoConvite: turma.codigoConvite });

      expect(prisma.turma.findUnique).toHaveBeenCalledWith({
        where: { codigoConvite: turma.codigoConvite },
      });
      expect(prisma.matricula.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: { turmaId: turma.id, alunoId: aluno.sub } }),
      );
      expect(result.reativada).toBe(false);
      expect(result.matricula).toMatchObject({
        turmaId: turma.id,
        alunoId: aluno.sub,
        status: MatriculaStatus.ATIVA,
        turma: { id: turma.id, nome: turma.nome },
      });
    });

    it('matrícula já ATIVA → 409, sem update nem create', async () => {
      prisma.matricula.findUnique.mockResolvedValue(
        buildMatricula({ turmaId: turma.id, alunoId: aluno.sub, status: MatriculaStatus.ATIVA }),
      );
      await expect(
        service.matricular(aluno, { codigoConvite: turma.codigoConvite }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.matricula.create).not.toHaveBeenCalled();
      expect(prisma.matricula.update).not.toHaveBeenCalled();
    });

    it('matrícula INATIVA → reativa a MESMA linha (RN-03) e reativada=true (200)', async () => {
      const existente = buildMatricula({
        turmaId: turma.id,
        alunoId: aluno.sub,
        status: MatriculaStatus.INATIVA,
      });
      prisma.matricula.findUnique.mockResolvedValue(existente);
      prisma.matricula.update.mockResolvedValue({
        ...existente,
        status: MatriculaStatus.ATIVA,
        turma: { id: turma.id, nome: turma.nome, descricao: null, ativa: true },
      });

      const result = await service.matricular(aluno, { codigoConvite: turma.codigoConvite });

      expect(prisma.matricula.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: existente.id },
          data: { status: MatriculaStatus.ATIVA, deletedAt: null },
        }),
      );
      expect(prisma.matricula.create).not.toHaveBeenCalled();
      expect(result.reativada).toBe(true);
      expect(result.matricula.status).toBe(MatriculaStatus.ATIVA);
    });

    it('matrícula SOFT-DELETED (mesmo ATIVA) → revive com deletedAt=null e reativada=true', async () => {
      const morta = buildMatricula({
        turmaId: turma.id,
        alunoId: aluno.sub,
        status: MatriculaStatus.ATIVA,
        deletedAt: NOW,
      });
      prisma.matricula.findUnique.mockResolvedValue(morta);
      prisma.matricula.update.mockResolvedValue({
        ...morta,
        deletedAt: null,
        turma: { id: turma.id, nome: turma.nome, descricao: null, ativa: true },
      });

      const result = await service.matricular(aluno, { codigoConvite: turma.codigoConvite });

      expect(prisma.matricula.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: MatriculaStatus.ATIVA, deletedAt: null },
        }),
      );
      expect(result.reativada).toBe(true);
    });

    it('corrida: P2002 no create (outra requisição venceu o unique) → 409', async () => {
      prisma.matricula.create.mockRejectedValue(p2002());
      await expect(
        service.matricular(aluno, { codigoConvite: turma.codigoConvite }),
      ).rejects.toThrow(ConflictException);
    });

    it('erro não-P2002 no create propaga sem virar 409', async () => {
      prisma.matricula.create.mockRejectedValue(new Error('conexão caiu'));
      await expect(
        service.matricular(aluno, { codigoConvite: turma.codigoConvite }),
      ).rejects.toThrow('conexão caiu');
    });
  });

  // ---------------------------------------------------------------------------
  // listByTurma — dono/moderação, filtro ?status=, paginação
  // ---------------------------------------------------------------------------

  describe('listByTurma', () => {
    const turma = buildTurma({ professorId: professor.sub });
    const query = { page: 1, pageSize: 20 };

    beforeEach(() => {
      prisma.turma.findUnique.mockResolvedValue(turma);
      prisma.matricula.findMany.mockResolvedValue([
        {
          ...buildMatricula({ turmaId: turma.id }),
          aluno: { id: randomUUID(), nome: 'Aluno Um', email: 'a1@guia.test' },
        },
      ]);
      prisma.matricula.count.mockResolvedValue(1);
    });

    it('dono lista com join de aluno {id, nome, email} e envelope paginado', async () => {
      const result = await service.listByTurma(professor, turma.id, query);

      expect(prisma.matricula.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { turmaId: turma.id, deletedAt: null },
          include: { aluno: { select: { id: true, nome: true, email: true } } },
        }),
      );
      expect(result).toMatchObject({ page: 1, pageSize: 20, total: 1 });
      expect(result.data[0].aluno).toEqual({
        id: expect.any(String),
        nome: 'Aluno Um',
        email: 'a1@guia.test',
      });
    });

    it('filtro ?status=INATIVA restringe o where', async () => {
      await service.listByTurma(professor, turma.id, {
        ...query,
        status: MatriculaStatus.INATIVA,
      });
      expect(prisma.matricula.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { turmaId: turma.id, deletedAt: null, status: MatriculaStatus.INATIVA },
        }),
      );
    });

    it('professor não-dono → 403 sem consultar matrículas; ADMIN/MODERADOR passam', async () => {
      await expect(service.listByTurma(outroProfessor, turma.id, query)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.matricula.findMany).not.toHaveBeenCalled();

      for (const user of [admin, moderador]) {
        await expect(service.listByTurma(user, turma.id, query)).resolves.toMatchObject({
          total: 1,
        });
      }
    });

    it('turma inexistente/soft-deleted → 404', async () => {
      prisma.turma.findUnique.mockResolvedValue(null);
      await expect(service.listByTurma(professor, randomUUID(), query)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // listMe — escopo do aluno; turma soft-deleted fora
  // ---------------------------------------------------------------------------

  describe('listMe', () => {
    const query = { page: 1, pageSize: 20 };

    beforeEach(() => {
      prisma.matricula.findMany.mockResolvedValue([
        {
          ...buildMatricula({ alunoId: aluno.sub }),
          turma: { id: randomUUID(), nome: 'Turma Alfa', descricao: null, ativa: true },
        },
      ]);
      prisma.matricula.count.mockResolvedValue(1);
    });

    it('filtra por alunoId autenticado e EXCLUI turmas soft-deleted, com resumo da turma', async () => {
      const result = await service.listMe(aluno, query);

      expect(prisma.matricula.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { alunoId: aluno.sub, deletedAt: null, turma: { deletedAt: null } },
          include: {
            turma: { select: { id: true, nome: true, descricao: true, ativa: true } },
          },
        }),
      );
      expect(result).toMatchObject({ page: 1, pageSize: 20, total: 1 });
      expect(result.data[0].turma).toMatchObject({ nome: 'Turma Alfa', ativa: true });
    });

    it('filtro ?status= aplicado ao where', async () => {
      await service.listMe(aluno, { ...query, status: MatriculaStatus.ATIVA });
      expect(prisma.matricula.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: MatriculaStatus.ATIVA }),
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // updateStatus — dono OU próprio aluno; demais 403; soft-deleted 404
  // ---------------------------------------------------------------------------

  describe('updateStatus', () => {
    const turma = buildTurma({ professorId: professor.sub });
    const matricula = {
      ...buildMatricula({ turmaId: turma.id, alunoId: aluno.sub }),
      turma,
    };

    beforeEach(() => {
      prisma.matricula.findUnique.mockResolvedValue(matricula);
      prisma.matricula.update.mockImplementation(
        ({ data }: { data: { status: MatriculaStatus } }) =>
          Promise.resolve({
            ...matricula,
            status: data.status,
            turma: { id: turma.id, nome: turma.nome, descricao: null, ativa: true },
          }),
      );
    });

    it('o PRÓPRIO aluno se inativa (sai da turma) → ok', async () => {
      const result = await service.updateStatus(aluno, matricula.id, {
        status: MatriculaStatus.INATIVA,
      });
      expect(result.status).toBe(MatriculaStatus.INATIVA);
      expect(prisma.matricula.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: matricula.id },
          data: { status: MatriculaStatus.INATIVA },
        }),
      );
    });

    it('REGRESSÃO review: o PRÓPRIO aluno com {status: ATIVA} → 403 orientando POST /matriculas, nada gravado', async () => {
      // PATCH {ATIVA} pelo aluno contornaria regenerar código e turma inativa:
      // rematrícula só via POST /matriculas (valida código vigente + RN-05).
      await expect(
        service.updateStatus(aluno, matricula.id, { status: MatriculaStatus.ATIVA }),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.updateStatus(aluno, matricula.id, { status: MatriculaStatus.ATIVA }),
      ).rejects.toThrow(/POST \/matriculas/);
      expect(prisma.matricula.update).not.toHaveBeenCalled();
    });

    it('professor DONO readmite (ATIVA) → ok; ADMIN/MODERADOR também', async () => {
      for (const user of [professor, admin, moderador]) {
        const result = await service.updateStatus(user, matricula.id, {
          status: MatriculaStatus.ATIVA,
        });
        expect(result.status).toBe(MatriculaStatus.ATIVA);
      }
    });

    it('OUTRO aluno → 403; professor de OUTRA turma → 403; nada gravado', async () => {
      for (const user of [outroAluno, outroProfessor]) {
        await expect(
          service.updateStatus(user, matricula.id, { status: MatriculaStatus.INATIVA }),
        ).rejects.toThrow(ForbiddenException);
      }
      expect(prisma.matricula.update).not.toHaveBeenCalled();
    });

    it('matrícula inexistente ou soft-deleted → 404', async () => {
      prisma.matricula.findUnique.mockResolvedValue(null);
      await expect(
        service.updateStatus(aluno, randomUUID(), { status: MatriculaStatus.INATIVA }),
      ).rejects.toThrow(NotFoundException);

      prisma.matricula.findUnique.mockResolvedValue({ ...matricula, deletedAt: NOW });
      await expect(
        service.updateStatus(aluno, matricula.id, { status: MatriculaStatus.INATIVA }),
      ).rejects.toThrow(NotFoundException);
    });

    it('matrícula de turma SOFT-DELETED → 404 mesmo para o dono', async () => {
      prisma.matricula.findUnique.mockResolvedValue({
        ...matricula,
        turma: buildTurma({ ...turma, deletedAt: NOW }),
      });
      for (const user of [professor, aluno]) {
        await expect(
          service.updateStatus(user, matricula.id, { status: MatriculaStatus.ATIVA }),
        ).rejects.toThrow(NotFoundException);
      }
      expect(prisma.matricula.update).not.toHaveBeenCalled();
    });
  });
});
