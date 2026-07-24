import { randomUUID } from 'node:crypto';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Role, User, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TokenService } from '../auth/token.service';
import { UsersService } from './users.service';

function buildUser(overrides: Partial<User> = {}): User {
  const now = new Date('2026-07-20T12:00:00Z');
  return {
    id: randomUUID(),
    nome: 'Aluno Impersonado',
    email: 'aluno.impersonado@guia.test',
    senhaHash: 'hash-que-nunca-pode-vazar',
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

describe('UsersService.impersonate (unit) — visualização como aluno', () => {
  let prisma: { user: { findUnique: jest.Mock } };
  let tokenService: { signImpersonationToken: jest.Mock };
  let service: UsersService;
  const adminId = randomUUID();

  beforeEach(() => {
    prisma = { user: { findUnique: jest.fn() } };
    tokenService = {
      signImpersonationToken: jest.fn().mockResolvedValue('impersonation-token'),
    };
    service = new UsersService(
      prisma as unknown as PrismaService,
      tokenService as unknown as TokenService,
    );
  });

  it('ALUNO ATIVO → retorna accessToken + user (id/nome/email/role) e nada mais', async () => {
    const aluno = buildUser();
    prisma.user.findUnique.mockResolvedValue(aluno);

    const result = await service.impersonate(adminId, aluno.id);

    expect(tokenService.signImpersonationToken).toHaveBeenCalledWith(aluno, adminId);
    expect(result).toEqual({
      accessToken: 'impersonation-token',
      user: { id: aluno.id, nome: aluno.nome, email: aluno.email, role: 'ALUNO' },
    });
    // Contrato: SEM refreshToken e sem vazamento de campos sensíveis
    expect(Object.keys(result).sort()).toEqual(['accessToken', 'user']);
    expect(result).not.toHaveProperty('refreshToken');
    expect(JSON.stringify(result)).not.toMatch(/senha_?hash/i);
  });

  it('ALUNO INATIVO → permitido de propósito (admin inspeciona a conta)', async () => {
    const aluno = buildUser({ status: UserStatus.INATIVO });
    prisma.user.findUnique.mockResolvedValue(aluno);

    const result = await service.impersonate(adminId, aluno.id);
    expect(result.accessToken).toBe('impersonation-token');
    expect(tokenService.signImpersonationToken).toHaveBeenCalledWith(aluno, adminId);
  });

  it.each([Role.ADMIN, Role.MODERADOR, Role.PROFESSOR] as Role[])(
    'alvo com role %s → 422 com details[].field = "id" e NENHUM token emitido',
    async (role) => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ role }));

      let caught: unknown;
      try {
        await service.impersonate(adminId, randomUUID());
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(UnprocessableEntityException);
      const body = (caught as UnprocessableEntityException).getResponse() as {
        details: Array<{ field: string }>;
      };
      expect(body.details[0].field).toBe('id');
      expect(tokenService.signImpersonationToken).not.toHaveBeenCalled();
    },
  );

  it('alvo inexistente → NotFoundException 404 e nenhum token emitido', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.impersonate(adminId, randomUUID())).rejects.toThrow(
      NotFoundException,
    );
    expect(tokenService.signImpersonationToken).not.toHaveBeenCalled();
  });

  it('alvo soft-deletado → NotFoundException 404 mesmo sendo ALUNO', async () => {
    prisma.user.findUnique.mockResolvedValue(buildUser({ deletedAt: new Date() }));
    await expect(service.impersonate(adminId, randomUUID())).rejects.toThrow(
      NotFoundException,
    );
    expect(tokenService.signImpersonationToken).not.toHaveBeenCalled();
  });
});
