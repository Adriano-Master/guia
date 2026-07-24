import { randomUUID } from 'node:crypto';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { MatriculaStatus, Prisma, Role, Turma } from '@prisma/client';
import { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { PrismaService } from '../../prisma/prisma.service';
import { TurmasAccessService } from './turmas-access.service';
import { TurmasService } from './turmas.service';

const NOW = new Date('2026-07-07T12:00:00Z');

// Regex derivada do alfabeto da decisão de design:
// ABCDEFGHJKMNPQRSTUVWXYZ23456789 → A-H, J-K, M-N, P-Z, 2-9 (sem 0/O/1/I/L).
const CODIGO_REGEX = /^[A-HJ-KM-NP-Z2-9]{8}$/;

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

describe('TurmasService (unit)', () => {
  let prisma: {
    turma: ModelMock;
    matricula: ModelMock;
    $transaction: jest.Mock;
  };
  let service: TurmasService;

  const professor = buildUser();
  const outroProfessor = buildUser();
  const admin = buildUser({ role: Role.ADMIN });
  const moderador = buildUser({ role: Role.MODERADOR });
  const aluno = buildUser({ role: Role.ALUNO });

  beforeEach(() => {
    prisma = {
      turma: modelMock(),
      matricula: modelMock(),
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    service = new TurmasService(
      prisma as unknown as PrismaService,
      new TurmasAccessService(prisma as unknown as PrismaService),
    );
  });

  // ---------------------------------------------------------------------------
  // create — código de convite (formato, retry) e dados persistidos
  // ---------------------------------------------------------------------------

  describe('create — código de convite', () => {
    beforeEach(() => {
      prisma.turma.create.mockImplementation(({ data }: { data: Partial<Turma> }) =>
        Promise.resolve(buildTurma({ ...data, professorId: professor.sub })),
      );
    });

    it('gera código de 8 chars do alfabeto sem ambíguos e persiste professorId = user.sub', async () => {
      const result = await service.create(professor, { nome: 'Turma Alfa' });

      expect(prisma.turma.create).toHaveBeenCalledTimes(1);
      const data = prisma.turma.create.mock.calls[0][0].data as Record<string, unknown>;
      expect(data.codigoConvite).toMatch(CODIGO_REGEX);
      expect(data).toMatchObject({
        nome: 'Turma Alfa',
        descricao: null,
        professorId: professor.sub,
      });
      // Dono vê o código na resposta
      expect(result.codigoConvite).toMatch(CODIGO_REGEX);
      expect(result.professorId).toBe(professor.sub);
    });

    it('códigos gerados nunca contêm caracteres ambíguos (0/O/1/I/L) em 200 amostras', async () => {
      for (let i = 0; i < 200; i += 1) {
        await service.create(professor, { nome: `T${i}` });
      }
      const codigos = prisma.turma.create.mock.calls.map(
        (call) => (call[0].data as Record<string, string>).codigoConvite,
      );
      expect(codigos).toHaveLength(200);
      for (const codigo of codigos) {
        expect(codigo).toMatch(CODIGO_REGEX);
        expect(codigo).not.toMatch(/[0O1IL]/);
      }
    });

    it('descricao com espaços vira trim; vazia/ausente vira null', async () => {
      await service.create(professor, { nome: 'T', descricao: '  desc  ' });
      expect(prisma.turma.create.mock.calls[0][0].data.descricao).toBe('desc');

      await service.create(professor, { nome: 'T', descricao: '   ' });
      expect(prisma.turma.create.mock.calls[1][0].data.descricao).toBeNull();
    });

    it('colisão P2002 uma vez → tenta OUTRO código e cria com sucesso (2 chamadas)', async () => {
      prisma.turma.create
        .mockRejectedValueOnce(p2002())
        .mockImplementationOnce(({ data }: { data: Partial<Turma> }) =>
          Promise.resolve(buildTurma({ ...data, professorId: professor.sub })),
        );

      const result = await service.create(professor, { nome: 'Turma Alfa' });

      expect(prisma.turma.create).toHaveBeenCalledTimes(2);
      const codigo1 = prisma.turma.create.mock.calls[0][0].data.codigoConvite as string;
      const codigo2 = prisma.turma.create.mock.calls[1][0].data.codigoConvite as string;
      expect(codigo1).not.toBe(codigo2); // retry gera código novo, não repete o que colidiu
      expect(result.codigoConvite).toBe(codigo2);
    });

    it('colisão P2002 nas 5 tentativas → propaga o erro e para (não loop infinito)', async () => {
      prisma.turma.create.mockRejectedValue(p2002());

      await expect(service.create(professor, { nome: 'Turma Alfa' })).rejects.toMatchObject({
        code: 'P2002',
      });
      expect(prisma.turma.create).toHaveBeenCalledTimes(5);
    });

    it('erro que NÃO é P2002 propaga imediatamente, sem retry', async () => {
      prisma.turma.create.mockRejectedValue(new Error('conexão caiu'));

      await expect(service.create(professor, { nome: 'Turma Alfa' })).rejects.toThrow(
        'conexão caiu',
      );
      expect(prisma.turma.create).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // list — escopo por dono, moderação e filtro ?ativa=
  // ---------------------------------------------------------------------------

  describe('list', () => {
    beforeEach(() => {
      prisma.turma.findMany.mockResolvedValue([buildTurma({ professorId: professor.sub })]);
      prisma.turma.count.mockResolvedValue(1);
    });

    const query = { page: 1, pageSize: 20 };

    it('PROFESSOR lista só as suas: where inclui professorId', async () => {
      await service.list(professor, query);
      expect(prisma.turma.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deletedAt: null, professorId: professor.sub },
        }),
      );
    });

    it('ADMIN e MODERADOR listam todas: where SEM professorId', async () => {
      for (const user of [admin, moderador]) {
        await service.list(user, query);
      }
      for (const call of prisma.turma.findMany.mock.calls) {
        expect(call[0].where).toEqual({ deletedAt: null });
      }
    });

    it('filtro ativa=false chega ao where como booleano false (regressão coerção)', async () => {
      await service.list(professor, { ...query, ativa: false });
      expect(prisma.turma.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deletedAt: null, professorId: professor.sub, ativa: false },
        }),
      );
    });

    it('retorna envelope paginado {data, page, pageSize, total} com codigoConvite (rota é interna)', async () => {
      const result = await service.list(professor, { page: 2, pageSize: 5 });
      expect(result).toMatchObject({ page: 2, pageSize: 5, total: 1 });
      expect(result.data[0].codigoConvite).toBeDefined();
      expect(prisma.turma.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 5, take: 5 }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // getById — dono/moderação com código; aluno matriculado sem código; escopos
  // ---------------------------------------------------------------------------

  describe('getById', () => {
    const turma = buildTurma({ professorId: professor.sub });

    beforeEach(() => {
      prisma.turma.findUnique.mockResolvedValue(turma);
    });

    it('dono lê a turma COM codigoConvite', async () => {
      const result = await service.getById(professor, turma.id);
      expect(result.codigoConvite).toBe(turma.codigoConvite);
    });

    it('ADMIN e MODERADOR leem qualquer turma COM codigoConvite', async () => {
      for (const user of [admin, moderador]) {
        const result = await service.getById(user, turma.id);
        expect(result.codigoConvite).toBe(turma.codigoConvite);
      }
    });

    it('aluno com matrícula ATIVA lê a turma SEM a chave codigoConvite', async () => {
      prisma.matricula.findUnique.mockResolvedValue({
        id: randomUUID(),
        status: MatriculaStatus.ATIVA,
        deletedAt: null,
      });

      const result = await service.getById(aluno, turma.id);

      expect(result.id).toBe(turma.id);
      expect('codigoConvite' in result).toBe(false); // chave AUSENTE, não undefined
    });

    it('aluno SEM matrícula → 403', async () => {
      prisma.matricula.findUnique.mockResolvedValue(null);
      await expect(service.getById(aluno, turma.id)).rejects.toThrow(ForbiddenException);
    });

    it('aluno com matrícula INATIVA → 403 (não basta existir)', async () => {
      prisma.matricula.findUnique.mockResolvedValue({
        id: randomUUID(),
        status: MatriculaStatus.INATIVA,
        deletedAt: null,
      });
      await expect(service.getById(aluno, turma.id)).rejects.toThrow(ForbiddenException);
    });

    it('aluno com matrícula ATIVA porém soft-deleted → 403', async () => {
      prisma.matricula.findUnique.mockResolvedValue({
        id: randomUUID(),
        status: MatriculaStatus.ATIVA,
        deletedAt: NOW,
      });
      await expect(service.getById(aluno, turma.id)).rejects.toThrow(ForbiddenException);
    });

    it('outro PROFESSOR (não-dono) → 403 sem consultar matrícula', async () => {
      await expect(service.getById(outroProfessor, turma.id)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.matricula.findUnique).not.toHaveBeenCalled();
    });

    it('turma inexistente ou soft-deleted → 404', async () => {
      prisma.turma.findUnique.mockResolvedValue(null);
      await expect(service.getById(professor, randomUUID())).rejects.toThrow(NotFoundException);

      prisma.turma.findUnique.mockResolvedValue(buildTurma({ deletedAt: NOW }));
      await expect(service.getById(professor, randomUUID())).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // update / regenerarCodigo / remove — escopo de dono e efeitos
  // ---------------------------------------------------------------------------

  describe('update', () => {
    const turma = buildTurma({ professorId: professor.sub });

    beforeEach(() => {
      prisma.turma.findUnique.mockResolvedValue(turma);
      prisma.turma.update.mockImplementation(({ data }: { data: Partial<Turma> }) =>
        Promise.resolve(buildTurma({ ...turma, ...data })),
      );
    });

    it('dono altera nome/descricao/ativa', async () => {
      const result = await service.update(professor, turma.id, {
        nome: 'Novo nome',
        ativa: false,
      });
      expect(prisma.turma.update).toHaveBeenCalledWith({
        where: { id: turma.id },
        data: { nome: 'Novo nome', ativa: false },
      });
      expect(result.ativa).toBe(false);
    });

    it('professor não-dono → 403, nada gravado; ADMIN/MODERADOR passam', async () => {
      await expect(
        service.update(outroProfessor, turma.id, { nome: 'invasão' }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.turma.update).not.toHaveBeenCalled();

      for (const user of [admin, moderador]) {
        await expect(service.update(user, turma.id, { nome: 'moderação' })).resolves.toBeDefined();
      }
    });
  });

  describe('regenerarCodigo', () => {
    const turma = buildTurma({ professorId: professor.sub, codigoConvite: 'ANTIGO23' });

    beforeEach(() => {
      prisma.turma.findUnique.mockResolvedValue(turma);
      prisma.turma.update.mockImplementation(({ data }: { data: { codigoConvite: string } }) =>
        Promise.resolve(buildTurma({ ...turma, codigoConvite: data.codigoConvite })),
      );
    });

    it('dono regenera: código novo válido e DIFERENTE do anterior (RN-02)', async () => {
      const novo = await service.regenerarCodigo(professor, turma.id);
      expect(novo).toMatch(CODIGO_REGEX);
      expect(novo).not.toBe('ANTIGO23');
    });

    it('colisão P2002 no update → retry com outro código', async () => {
      prisma.turma.update
        .mockRejectedValueOnce(p2002())
        .mockImplementationOnce(({ data }: { data: { codigoConvite: string } }) =>
          Promise.resolve(buildTurma({ ...turma, codigoConvite: data.codigoConvite })),
        );

      const novo = await service.regenerarCodigo(professor, turma.id);
      expect(prisma.turma.update).toHaveBeenCalledTimes(2);
      expect(novo).toMatch(CODIGO_REGEX);
    });

    it('professor não-dono → 403; ADMIN/MODERADOR passam', async () => {
      await expect(service.regenerarCodigo(outroProfessor, turma.id)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.turma.update).not.toHaveBeenCalled();

      for (const user of [admin, moderador]) {
        await expect(service.regenerarCodigo(user, turma.id)).resolves.toMatch(CODIGO_REGEX);
      }
    });
  });

  describe('remove (soft delete, RN-08)', () => {
    const turma = buildTurma({ professorId: professor.sub });

    beforeEach(() => {
      prisma.turma.findUnique.mockResolvedValue(turma);
      prisma.turma.update.mockResolvedValue(buildTurma({ ...turma, deletedAt: NOW }));
    });

    it('dono remove: update com deletedAt (soft delete, não delete físico)', async () => {
      await service.remove(professor, turma.id);
      expect(prisma.turma.update).toHaveBeenCalledWith({
        where: { id: turma.id },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('professor não-dono → 403; turma já soft-deleted → 404', async () => {
      await expect(service.remove(outroProfessor, turma.id)).rejects.toThrow(ForbiddenException);
      expect(prisma.turma.update).not.toHaveBeenCalled();

      prisma.turma.findUnique.mockResolvedValue(buildTurma({ deletedAt: NOW }));
      await expect(service.remove(professor, turma.id)).rejects.toThrow(NotFoundException);
    });
  });
});
