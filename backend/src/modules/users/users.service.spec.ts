import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TokenService } from '../auth/token.service';
import { hashPassword, verifyPassword } from '../../common/security/password';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UsersService } from './users.service';

const SENHA_ATUAL = 'senha-atual-123';

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

describe('UsersService (unit)', () => {
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
  let senhaAtualHash: string;

  beforeAll(async () => {
    senhaAtualHash = await hashPassword(SENHA_ATUAL);
  });

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

  describe('getMe / getById', () => {
    it('retorna o usuário serializado sem senhaHash', async () => {
      const user = buildUser();
      prisma.user.findUnique.mockResolvedValue(user);

      const result = await service.getById(user.id);
      expect(result).toMatchObject({ id: user.id, email: user.email });
      expect(result).not.toHaveProperty('senhaHash');
      expect(JSON.stringify(result)).not.toMatch(/senha_?hash/i);
    });

    it('inexistente → NotFoundException 404', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getById(randomUUID())).rejects.toThrow(NotFoundException);
    });

    it('soft-deletado → NotFoundException 404', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ deletedAt: new Date() }));
      await expect(service.getMe(randomUUID())).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateMe', () => {
    it('atualiza nome/email quando o novo email está livre', async () => {
      const user = buildUser();
      prisma.user.findUnique
        .mockResolvedValueOnce(user) // busca por id
        .mockResolvedValueOnce(null); // busca por email novo
      prisma.user.update.mockResolvedValue({
        ...user,
        nome: 'Novo Nome',
        email: 'novo@guia.test',
      });

      const result = await service.updateMe(user.id, {
        nome: 'Novo Nome',
        email: 'novo@guia.test',
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: user.id },
        data: { nome: 'Novo Nome', email: 'novo@guia.test' },
      });
      expect(result.email).toBe('novo@guia.test');
      expect(result).not.toHaveProperty('senhaHash');
    });

    it('email em uso por outro usuário → ConflictException 409', async () => {
      const user = buildUser();
      prisma.user.findUnique
        .mockResolvedValueOnce(user)
        .mockResolvedValueOnce(buildUser({ email: 'ocupado@guia.test' }));

      await expect(
        service.updateMe(user.id, { email: 'ocupado@guia.test' }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('corrida na troca de email (P2002 no update) → ConflictException 409', async () => {
      const user = buildUser();
      prisma.user.findUnique.mockResolvedValueOnce(user).mockResolvedValueOnce(null);
      prisma.user.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.updateMe(user.id, { email: 'corrida@guia.test' }),
      ).rejects.toThrow(ConflictException);
    });

    it('manter o próprio email não dispara checagem de conflito', async () => {
      const user = buildUser();
      prisma.user.findUnique.mockResolvedValueOnce(user);
      prisma.user.update.mockResolvedValue(user);

      await service.updateMe(user.id, { email: user.email });
      // Apenas a busca por id; nenhuma busca por email
      expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    });
  });

  describe('changePassword', () => {
    it('senha atual errada → 422 com details[].field = "senhaAtual"', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ senhaHash: senhaAtualHash }));

      let caught: unknown;
      try {
        await service.changePassword(randomUUID(), {
          senhaAtual: 'errada-999',
          senhaNova: 'nova-senha-123',
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(UnprocessableEntityException);
      const body = (caught as UnprocessableEntityException).getResponse() as {
        details: Array<{ field: string }>;
      };
      expect(body.details[0].field).toBe('senhaAtual');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('usuário sem senha definida (hash nulo) → 422', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ senhaHash: null }));
      await expect(
        service.changePassword(randomUUID(), {
          senhaAtual: 'qualquer',
          senhaNova: 'nova-senha-123',
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('senha atual correta → grava novo hash verificável', async () => {
      const user = buildUser({ senhaHash: senhaAtualHash });
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.user.update.mockResolvedValue(user);

      await service.changePassword(user.id, {
        senhaAtual: SENHA_ATUAL,
        senhaNova: 'nova-senha-123',
      });

      const updateArgs = prisma.user.update.mock.calls[0][0];
      expect(updateArgs.where).toEqual({ id: user.id });
      await expect(verifyPassword(updateArgs.data.senhaHash, 'nova-senha-123')).resolves.toBe(
        true,
      );
    });
  });

  describe('list', () => {
    beforeEach(() => {
      prisma.user.findMany.mockResolvedValue([buildUser()]);
      prisma.user.count.mockResolvedValue(1);
    });

    it('retorna envelope { data, page, pageSize, total } sem senhaHash', async () => {
      prisma.user.count.mockResolvedValue(42);
      const result = await service.list(listQuery({ page: 2, pageSize: 10 }));

      expect(result).toMatchObject({ page: 2, pageSize: 10, total: 42 });
      expect(result.data).toHaveLength(1);
      expect(JSON.stringify(result)).not.toMatch(/senha_?hash/i);

      // Paginação → skip/take corretos
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
    });

    it('aplica filtros role, status e q (nome/email, case-insensitive)', async () => {
      await service.list(listQuery({ role: 'ADMIN', status: 'ATIVO', q: 'maria' }));

      const where = prisma.user.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({
        deletedAt: null,
        role: 'ADMIN',
        status: 'ATIVO',
        OR: [
          { nome: { contains: 'maria', mode: 'insensitive' } },
          { email: { contains: 'maria', mode: 'insensitive' } },
        ],
      });
      // count usa o mesmo where (total coerente com o filtro)
      expect(prisma.user.count).toHaveBeenCalledWith({ where });
    });

    // Desempate estável por createdAt/id (code review): sem ordem total,
    // linhas empatadas no campo ordenado flutuam entre páginas.
    it('sort=-nome → orderBy desc; sort=email → asc', async () => {
      await service.list(listQuery({ sort: '-nome' }));
      expect(prisma.user.findMany.mock.calls[0][0].orderBy).toEqual([
        { nome: 'desc' },
        { createdAt: 'desc' },
        { id: 'asc' },
      ]);

      await service.list(listQuery({ sort: 'email' }));
      expect(prisma.user.findMany.mock.calls[1][0].orderBy).toEqual([
        { email: 'asc' },
        { createdAt: 'desc' },
        { id: 'asc' },
      ]);
    });

    it('sem sort → orderBy default createdAt desc', async () => {
      await service.list(listQuery());
      expect(prisma.user.findMany.mock.calls[0][0].orderBy).toEqual([
        { createdAt: 'desc' },
        { id: 'asc' },
      ]);
    });

    it('sort fora da allowlist → 422 com details[].field = "sort"', async () => {
      let caught: unknown;
      try {
        await service.list(listQuery({ sort: 'senhaHash' }));
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(UnprocessableEntityException);
      const body = (caught as UnprocessableEntityException).getResponse() as {
        details: Array<{ field: string }>;
      };
      expect(body.details[0].field).toBe('sort');
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });
  });

  describe('adminUpdate — regra do último admin', () => {
    it('rebaixar o último ADMIN ATIVO → ConflictException 409', async () => {
      const admin = buildUser({ role: 'ADMIN', status: 'ATIVO' });
      tx.user.findUnique.mockResolvedValue(admin);
      tx.user.count.mockResolvedValue(0); // nenhum outro admin ativo

      await expect(service.adminUpdate(admin.id, { role: 'ALUNO' })).rejects.toThrow(
        ConflictException,
      );
      expect(tx.user.update).not.toHaveBeenCalled();
    });

    it('desativar o último ADMIN ATIVO → ConflictException 409', async () => {
      const admin = buildUser({ role: 'ADMIN', status: 'ATIVO' });
      tx.user.findUnique.mockResolvedValue(admin);
      tx.user.count.mockResolvedValue(0);

      await expect(service.adminUpdate(admin.id, { status: 'INATIVO' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('rebaixar/desativar ADMIN quando existe outro ADMIN ATIVO → permitido', async () => {
      const admin = buildUser({ role: 'ADMIN', status: 'ATIVO' });
      tx.user.findUnique.mockResolvedValue(admin);
      tx.user.count.mockResolvedValue(1); // há outro admin ativo
      tx.user.update.mockResolvedValue({ ...admin, status: 'INATIVO' });

      const result = await service.adminUpdate(admin.id, { status: 'INATIVO' });

      expect(tx.user.count).toHaveBeenCalledWith({
        where: {
          id: { not: admin.id },
          role: 'ADMIN',
          status: 'ATIVO',
          deletedAt: null,
        },
      });
      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: admin.id },
        data: { role: 'ADMIN', status: 'INATIVO' },
      });
      expect(result.status).toBe('INATIVO');
      expect(result).not.toHaveProperty('senhaHash');
    });

    it('promover ALUNO a ADMIN não consulta a contagem de admins', async () => {
      const aluno = buildUser({ role: 'ALUNO', status: 'ATIVO' });
      tx.user.findUnique.mockResolvedValue(aluno);
      tx.user.update.mockResolvedValue({ ...aluno, role: 'ADMIN' });

      const result = await service.adminUpdate(aluno.id, { role: 'ADMIN' });
      expect(tx.user.count).not.toHaveBeenCalled();
      expect(result.role).toBe('ADMIN');
    });

    it('ADMIN ATIVO permanecendo ADMIN ATIVO (no-op) não bloqueia', async () => {
      const admin = buildUser({ role: 'ADMIN', status: 'ATIVO' });
      tx.user.findUnique.mockResolvedValue(admin);
      tx.user.update.mockResolvedValue(admin);

      await expect(service.adminUpdate(admin.id, { role: 'ADMIN' })).resolves.toBeDefined();
      expect(tx.user.count).not.toHaveBeenCalled();
    });

    it('usuário inexistente → NotFoundException 404', async () => {
      tx.user.findUnique.mockResolvedValue(null);
      await expect(service.adminUpdate(randomUUID(), { role: 'ADMIN' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('usuário soft-deletado → NotFoundException 404', async () => {
      tx.user.findUnique.mockResolvedValue(buildUser({ deletedAt: new Date() }));
      await expect(service.adminUpdate(randomUUID(), { status: 'ATIVO' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
