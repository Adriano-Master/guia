import { randomUUID } from 'node:crypto';
import { Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import * as passwordModule from '../../common/security/password';
import { AuthService } from './auth.service';
import { EmailService } from './email.service';
import { InMemoryTokenDenylistService } from './token-denylist.service';
import { TokenService } from './token.service';

/**
 * Testes de REGRESSÃO das correções de code review em auth-e-usuarios:
 *  - login com timing equalizado (verificação argon2 SEMPRE executa, mesmo
 *    para email inexistente / conta sem senha, via DUMMY_PASSWORD_HASH);
 *  - forgot-password resiliente a falha do EmailService (mantém 204 e loga).
 * Não duplicam os cenários já cobertos em auth.service.spec.ts.
 */

const ACCESS_SECRET = 'unit-access-secret';
const REFRESH_SECRET = 'unit-refresh-secret';

function fakeConfig(): ConfigService {
  const values: Record<string, string> = {
    JWT_ACCESS_SECRET: ACCESS_SECRET,
    JWT_REFRESH_SECRET: REFRESH_SECRET,
    APP_BASE_URL: 'http://localhost:8080',
  };
  return {
    get: (key: string, def?: unknown) => values[key] ?? def,
    getOrThrow: (key: string) => {
      const value = values[key];
      if (value === undefined) throw new Error(`missing config ${key}`);
      return value;
    },
  } as unknown as ConfigService;
}

function buildUser(overrides: Partial<User> = {}): User {
  const now = new Date('2026-07-06T12:00:00Z');
  return {
    id: randomUUID(),
    nome: 'Aluno Teste',
    email: 'aluno@guia.test',
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

describe('AuthService (unit) — regressões de code review', () => {
  let prisma: { user: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock } };
  let tokenService: TokenService;
  let denylist: InMemoryTokenDenylistService;
  let emailService: { sendPasswordReset: jest.Mock };
  let service: AuthService;

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    };
    const config = fakeConfig();
    tokenService = new TokenService(new JwtService({}), config);
    denylist = new InMemoryTokenDenylistService();
    emailService = { sendPasswordReset: jest.fn().mockResolvedValue(undefined) };
    service = new AuthService(
      prisma as unknown as PrismaService,
      tokenService,
      config,
      denylist,
      emailService as unknown as EmailService,
    );
  });

  afterEach(() => {
    denylist.onModuleDestroy();
    jest.restoreAllMocks();
  });

  describe('login — timing equalizado (mitigação de enumeração por timing)', () => {
    it('email inexistente: verifyPassword EXECUTA contra um hash argon2 dummy e o 401 fica genérico', async () => {
      const verifySpy = jest.spyOn(passwordModule, 'verifyPassword');
      prisma.user.findUnique.mockResolvedValue(null);

      let caught: unknown;
      try {
        await service.login({ email: 'nao.existe@guia.test', senha: 'senha-qualquer-1' });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(UnauthorizedException);
      expect((caught as UnauthorizedException).message).toBe('Credenciais inválidas.');

      // A verificação argon2 rodou mesmo sem usuário — contra o dummy hash.
      expect(verifySpy).toHaveBeenCalledTimes(1);
      const [hashArg, senhaArg] = verifySpy.mock.calls[0];
      expect(hashArg).toMatch(/^\$argon2/);
      expect(senhaArg).toBe('senha-qualquer-1');
    });

    it('conta sem senha (Hotmart PENDENTE): verifyPassword também executa contra o dummy', async () => {
      const verifySpy = jest.spyOn(passwordModule, 'verifyPassword');
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ senhaHash: null, origem: 'HOTMART', status: 'PENDENTE' }),
      );

      await expect(
        service.login({ email: 'pendente@guia.test', senha: 'senha-qualquer-1' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(verifySpy).toHaveBeenCalledTimes(1);
      expect(verifySpy.mock.calls[0][0]).toMatch(/^\$argon2/);
    });

    it('o dummy hash é estável (gerado uma única vez no load do módulo)', async () => {
      const verifySpy = jest.spyOn(passwordModule, 'verifyPassword');
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'a@guia.test', senha: 'senha-qualquer-1' }),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.login({ email: 'b@guia.test', senha: 'senha-qualquer-1' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(verifySpy).toHaveBeenCalledTimes(2);
      expect(verifySpy.mock.calls[0][0]).toBe(verifySpy.mock.calls[1][0]);
    });
  });

  describe('forgotPassword — resiliente a falha do EmailService', () => {
    it('EmailService lança → método NÃO propaga (controller mantém 204) e loga o erro sem o token', async () => {
      const user = buildUser();
      prisma.user.findUnique.mockResolvedValue(user);
      emailService.sendPasswordReset.mockRejectedValue(new Error('SMTP indisponível'));
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await expect(service.forgotPassword({ email: user.email })).resolves.toBeUndefined();

      expect(emailService.sendPasswordReset).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const loggedMessage = String(errorSpy.mock.calls[0][0]);
      expect(loggedMessage).toContain(user.email);
      // O link/token de reset não pode vazar para o log.
      expect(loggedMessage).not.toContain('token=');
      expect(loggedMessage).not.toContain('reset-password?');
    });

    it('rejeição não-Error (string) também é absorvida e logada', async () => {
      const user = buildUser();
      prisma.user.findUnique.mockResolvedValue(user);
      emailService.sendPasswordReset.mockRejectedValue('falha bruta');
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await expect(service.forgotPassword({ email: user.email })).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });
  });
});
