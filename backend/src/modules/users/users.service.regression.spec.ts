import { randomUUID } from 'node:crypto';
import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TokenService } from '../auth/token.service';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UsersService } from './users.service';

/**
 * Testes de REGRESSÃO das correções de code review em auth-e-usuarios:
 *  - allowlist de sort inclui ultimoLoginAt;
 *  - regra do último admin roda em transação Serializable com retry de P2034.
 * Não duplicam os cenários já cobertos em users.service.spec.ts.
 */

function buildUser(overrides: Partial<User> = {}): User {
  const now = new Date('2026-07-06T12:00:00Z');
  return {
    id: randomUUID(),
    nome: 'Usuário Teste',
    email: 'usuario@guia.test',
    senhaHash: 'definido-por-teste',
    role: 'ALUNO',
    status: 'ATIVO',
    origem: 'PROPRIO',
    ultimoLoginAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

function listQuery(overrides: Partial<ListUsersQueryDto> = {}): ListUsersQueryDto {
  return { page: 1, pageSize: 20, ...overrides } as ListUsersQueryDto;
}

function p2034(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Transaction failed due to a write conflict or a deadlock. Please retry your transaction',
    { code: 'P2034', clientVersion: 'test' },
  );
}

describe('UsersService (unit) — regressões de code review', () => {
  let prisma: {
    user: {
      findUnique: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let tx: { user: { findUnique: jest.Mock; update: jest.Mock; count: jest.Mock } };
  let service: UsersService;

  beforeEach(() => {
    tx = { user: { findUnique: jest.fn(), update: jest.fn(), count: jest.fn() } };
    prisma = {
      user: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn(), count: jest.fn() },
      $transaction: jest.fn(
        (arg: unknown): Promise<unknown> =>
          Array.isArray(arg)
            ? Promise.all(arg)
            : (arg as (t: typeof tx) => Promise<unknown>)(tx),
      ),
    };
    const tokenService = {
      signImpersonationToken: jest.fn().mockResolvedValue('impersonation-token'),
    };
    service = new UsersService(
      prisma as unknown as PrismaService,
      tokenService as unknown as TokenService,
    );
  });

  describe('list — sort por ultimoLoginAt (novo campo da allowlist)', () => {
    beforeEach(() => {
      prisma.user.findMany.mockResolvedValue([buildUser()]);
      prisma.user.count.mockResolvedValue(1);
    });

    // orderBy vira array com desempate estável (code review de questões).
    it('sort=-ultimoLoginAt → orderBy { ultimoLoginAt: "desc" }', async () => {
      await service.list(listQuery({ sort: '-ultimoLoginAt' }));
      expect(prisma.user.findMany.mock.calls[0][0].orderBy).toEqual([
        { ultimoLoginAt: 'desc' },
        { createdAt: 'desc' },
        { id: 'asc' },
      ]);
    });

    it('sort=ultimoLoginAt → orderBy { ultimoLoginAt: "asc" }', async () => {
      await service.list(listQuery({ sort: 'ultimoLoginAt' }));
      expect(prisma.user.findMany.mock.calls[0][0].orderBy).toEqual([
        { ultimoLoginAt: 'asc' },
        { createdAt: 'desc' },
        { id: 'asc' },
      ]);
    });

    it('allowlist do erro de sort inválido é nome|email|createdAt|ultimoLoginAt', async () => {
      let caught: unknown;
      try {
        await service.list(listQuery({ sort: 'role' }));
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(UnprocessableEntityException);
      const body = (caught as UnprocessableEntityException).getResponse() as {
        details: Array<{ field: string; issue: string }>;
      };
      expect(body.details[0].field).toBe('sort');
      expect(body.details[0].issue).toBe(
        'campo deve ser um de: nome, email, createdAt, ultimoLoginAt',
      );
    });
  });

  describe('adminUpdate — transação Serializable com retry de P2034', () => {
    it('usa $transaction com isolationLevel Serializable', async () => {
      const aluno = buildUser({ role: 'ALUNO', status: 'ATIVO' });
      tx.user.findUnique.mockResolvedValue(aluno);
      tx.user.update.mockResolvedValue({ ...aluno, role: 'ADMIN' });

      await service.adminUpdate(aluno.id, { role: 'ADMIN' });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction.mock.calls[0][1]).toEqual({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
      expect(prisma.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'Serializable' });
    });

    it('P2034 na 1ª tentativa → re-tenta e a 2ª conclui com sucesso', async () => {
      const aluno = buildUser({ role: 'ALUNO', status: 'ATIVO' });
      tx.user.findUnique.mockResolvedValue(aluno);
      tx.user.update.mockResolvedValue({ ...aluno, role: 'ADMIN' });
      prisma.$transaction
        .mockRejectedValueOnce(p2034())
        .mockImplementation((fn: (t: typeof tx) => Promise<unknown>) => fn(tx));

      const result = await service.adminUpdate(aluno.id, { role: 'ADMIN' });

      expect(result.role).toBe('ADMIN');
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
      // Toda tentativa mantém o isolamento Serializable
      for (const call of prisma.$transaction.mock.calls) {
        expect(call[1]).toEqual({ isolationLevel: 'Serializable' });
      }
    });

    it('P2034 persistente → desiste após 3 tentativas e propaga o erro', async () => {
      prisma.$transaction.mockRejectedValue(p2034());

      let caught: unknown;
      try {
        await service.adminUpdate(randomUUID(), { role: 'ADMIN' });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      expect((caught as Prisma.PrismaClientKnownRequestError).code).toBe('P2034');
      expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    });

    it('erro que não é P2034 não é re-tentado (propaga na 1ª tentativa)', async () => {
      prisma.$transaction.mockRejectedValue(new Error('conexão caiu'));

      await expect(service.adminUpdate(randomUUID(), { role: 'ADMIN' })).rejects.toThrow(
        'conexão caiu',
      );
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });
});
