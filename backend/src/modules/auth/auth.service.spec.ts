import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { hashPassword, verifyPassword } from '../../common/security/password';
import { AuthService } from './auth.service';
import { EmailService } from './email.service';
import { InMemoryTokenDenylistService } from './token-denylist.service';
import { TokenService } from './token.service';

const ACCESS_SECRET = 'unit-access-secret';
const REFRESH_SECRET = 'unit-refresh-secret';
const RESET_SECRET = `${REFRESH_SECRET}.password-reset`;
const SENHA_CORRETA = 'senha-correta-123';

type PrismaUserMock = {
  user: {
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
};

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

describe('AuthService (unit)', () => {
  let prisma: PrismaUserMock;
  let jwt: JwtService;
  let tokenService: TokenService;
  let denylist: InMemoryTokenDenylistService;
  let emailService: { sendPasswordReset: jest.Mock };
  let service: AuthService;
  let senhaCorretaHash: string;

  beforeAll(async () => {
    senhaCorretaHash = await hashPassword(SENHA_CORRETA);
  });

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    jwt = new JwtService({});
    const config = fakeConfig();
    tokenService = new TokenService(jwt, config);
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
  });

  describe('register', () => {
    const dto = { nome: 'Aluno Teste', email: 'aluno@guia.test', senha: SENHA_CORRETA };

    it('cria usuário ALUNO/PROPRIO/ATIVO com hash argon2 e não expõe senhaHash', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(buildUser(data as Partial<User>)),
      );

      const result = await service.register(dto);

      const createArgs = prisma.user.create.mock.calls[0][0];
      expect(createArgs.data).toMatchObject({
        nome: dto.nome,
        email: dto.email,
        role: 'ALUNO',
        origem: 'PROPRIO',
        status: 'ATIVO',
      });
      // Hash gerado de fato (não senha em claro) e verificável.
      expect(createArgs.data.senhaHash).not.toEqual(dto.senha);
      await expect(verifyPassword(createArgs.data.senhaHash, dto.senha)).resolves.toBe(true);

      expect(result).not.toHaveProperty('senhaHash');
      expect(JSON.stringify(result)).not.toMatch(/senha_?hash/i);
      expect(result.email).toBe(dto.email);
    });

    it('email já cadastrado (pré-checagem) → ConflictException 409', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());

      await expect(service.register(dto)).rejects.toThrow(ConflictException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('corrida entre checagem e insert (P2002) → ConflictException 409', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(service.register(dto)).rejects.toThrow(ConflictException);
    });

    it('erro desconhecido do banco não vira 409 (propaga)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockRejectedValue(new Error('conexão caiu'));

      await expect(service.register(dto)).rejects.toThrow('conexão caiu');
    });
  });

  describe('login', () => {
    const dto = { email: 'aluno@guia.test', senha: SENHA_CORRETA };

    async function expectGenericUnauthorized(): Promise<UnauthorizedException> {
      let caught: unknown;
      try {
        await service.login(dto);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(UnauthorizedException);
      return caught as UnauthorizedException;
    }

    it('email inexistente → 401 genérico', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const error = await expectGenericUnauthorized();
      expect(error.message).toBe('Credenciais inválidas.');
    });

    it('senha_hash nulo (usuário Hotmart sem senha) → 401 genérico', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ senhaHash: null, origem: 'HOTMART', status: 'ATIVO' }),
      );
      await expectGenericUnauthorized();
    });

    it('senha errada → 401 genérico', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ senhaHash: senhaCorretaHash }));
      let caught: unknown;
      try {
        await service.login({ email: dto.email, senha: 'senha-errada-999' });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(UnauthorizedException);
      expect((caught as UnauthorizedException).message).toBe('Credenciais inválidas.');
    });

    it('status INATIVO → 401 genérico (mesma mensagem dos demais casos)', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ senhaHash: senhaCorretaHash, status: 'INATIVO' }),
      );
      const error = await expectGenericUnauthorized();
      expect(error.message).toBe('Credenciais inválidas.');
    });

    it('status PENDENTE → 401 genérico', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ senhaHash: senhaCorretaHash, status: 'PENDENTE' }),
      );
      await expectGenericUnauthorized();
    });

    it('usuário soft-deletado → 401 genérico', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ senhaHash: senhaCorretaHash, deletedAt: new Date() }),
      );
      await expectGenericUnauthorized();
    });

    it('login ok → atualiza ultimoLoginAt e emite par de tokens com claims corretas', async () => {
      const user = buildUser({ senhaHash: senhaCorretaHash });
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.user.update.mockImplementation(({ data }: { data: { ultimoLoginAt: Date } }) =>
        Promise.resolve({ ...user, ultimoLoginAt: data.ultimoLoginAt }),
      );

      const result = await service.login(dto);

      // ultimo_login_at atualizado
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: user.id },
        data: { ultimoLoginAt: expect.any(Date) },
      });

      // access token com sub/role/origem, assinado com o secret de access
      const accessPayload = await tokenService.verifyAccessToken(result.accessToken);
      expect(accessPayload).toMatchObject({ sub: user.id, role: 'ALUNO', origem: 'PROPRIO' });

      // refresh token válido, com jti
      const refreshPayload = await tokenService.verifyRefreshToken(result.refreshToken);
      expect(refreshPayload.sub).toBe(user.id);
      expect(refreshPayload.jti).toEqual(expect.any(String));

      // user serializado sem senhaHash e com ultimoLoginAt preenchido
      expect(result.user).not.toHaveProperty('senhaHash');
      expect(JSON.stringify(result)).not.toMatch(/senha_?hash/i);
      expect(result.user.ultimoLoginAt).toEqual(expect.any(String));
    });
  });

  describe('refresh', () => {
    it('refresh válido → novo par de tokens e rotação (antigo invalidado)', async () => {
      const user = buildUser();
      prisma.user.findUnique.mockResolvedValue(user);
      const { token: oldRefresh } = await tokenService.signRefreshToken(user.id);

      const rotated = await service.refresh(oldRefresh);
      expect(rotated.accessToken).toEqual(expect.any(String));
      expect(rotated.refreshToken).toEqual(expect.any(String));
      expect(rotated.refreshToken).not.toBe(oldRefresh);

      // Antigo foi negado pela rotação
      await expect(service.refresh(oldRefresh)).rejects.toThrow(UnauthorizedException);

      // Novo continua funcionando
      await expect(service.refresh(rotated.refreshToken)).resolves.toMatchObject({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
      });
    });

    it('token com assinatura inválida → 401', async () => {
      const forged = await jwt.signAsync(
        {},
        { secret: 'outro-secret', subject: randomUUID(), jwtid: randomUUID(), expiresIn: '7d' },
      );
      await expect(service.refresh(forged)).rejects.toThrow(UnauthorizedException);
    });

    it('token expirado → 401', async () => {
      const expired = await jwt.signAsync(
        {},
        { secret: REFRESH_SECRET, subject: randomUUID(), jwtid: randomUUID(), expiresIn: '-10s' },
      );
      await expect(service.refresh(expired)).rejects.toThrow(UnauthorizedException);
    });

    it('string aleatória → 401', async () => {
      await expect(service.refresh('nao-e-um-jwt')).rejects.toThrow(UnauthorizedException);
    });

    it('usuário que ficou INATIVO após emissão → 401', async () => {
      const user = buildUser({ status: 'INATIVO' });
      prisma.user.findUnique.mockResolvedValue(user);
      const { token } = await tokenService.signRefreshToken(user.id);
      await expect(service.refresh(token)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('nega o refresh corrente: refresh após logout → 401', async () => {
      const user = buildUser();
      prisma.user.findUnique.mockResolvedValue(user);
      const { token } = await tokenService.signRefreshToken(user.id);

      await expect(service.logout(token)).resolves.toBeUndefined();
      await expect(service.refresh(token)).rejects.toThrow(UnauthorizedException);
    });

    it('é idempotente: token inválido/expirado não lança (controller responde 204)', async () => {
      await expect(service.logout('token-invalido')).resolves.toBeUndefined();
      const expired = await jwt.signAsync(
        {},
        { secret: REFRESH_SECRET, subject: randomUUID(), jwtid: randomUUID(), expiresIn: '-10s' },
      );
      await expect(service.logout(expired)).resolves.toBeUndefined();
    });
  });

  describe('forgotPassword', () => {
    it('email inexistente → silencioso (não envia email, não lança)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.forgotPassword({ email: 'nao@existe.test' })).resolves.toBeUndefined();
      expect(emailService.sendPasswordReset).not.toHaveBeenCalled();
    });

    it('usuário INATIVO → silencioso, sem email', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ status: 'INATIVO' }));
      await expect(service.forgotPassword({ email: 'aluno@guia.test' })).resolves.toBeUndefined();
      expect(emailService.sendPasswordReset).not.toHaveBeenCalled();
    });

    it('usuário elegível → envia link contendo token de reset válido', async () => {
      const user = buildUser();
      prisma.user.findUnique.mockResolvedValue(user);

      await service.forgotPassword({ email: user.email });

      expect(emailService.sendPasswordReset).toHaveBeenCalledTimes(1);
      const [to, resetUrl] = emailService.sendPasswordReset.mock.calls[0];
      expect(to).toBe(user.email);
      expect(resetUrl).toContain('http://localhost:8080/reset-password?token=');

      const token = decodeURIComponent(String(resetUrl).split('token=')[1]);
      const payload = await tokenService.verifyResetToken(token);
      expect(payload).toMatchObject({ sub: user.id, purpose: 'password_reset' });
    });
  });

  describe('resetPassword', () => {
    it('token válido define nova senha e o invalida (uso único) → 2ª chamada 422', async () => {
      const user = buildUser();
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.user.update.mockResolvedValue(user);
      const { token } = await tokenService.signResetToken(user.id);

      await service.resetPassword({ token, senhaNova: 'nova-senha-123' });

      const updateArgs = prisma.user.update.mock.calls[0][0];
      expect(updateArgs.where).toEqual({ id: user.id });
      await expect(verifyPassword(updateArgs.data.senhaHash, 'nova-senha-123')).resolves.toBe(true);
      // Usuário já ATIVO não muda de status
      expect(updateArgs.data.status).toBeUndefined();

      // Uso único: mesmo token de novo → 422
      await expect(service.resetPassword({ token, senhaNova: 'outra-senha-123' })).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(prisma.user.update).toHaveBeenCalledTimes(1);
    });

    it('token expirado → 422', async () => {
      const user = buildUser();
      const expired = await jwt.signAsync(
        { purpose: 'password_reset' },
        { secret: RESET_SECRET, subject: user.id, jwtid: randomUUID(), expiresIn: '-10s' },
      );
      await expect(
        service.resetPassword({ token: expired, senhaNova: 'nova-senha-123' }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('token com propósito errado → 422 (refresh token não serve como reset)', async () => {
      const user = buildUser();
      prisma.user.findUnique.mockResolvedValue(user);

      // Assinado com o secret de reset, mas purpose diferente
      const wrongPurpose = await jwt.signAsync(
        { purpose: 'email_confirmation' },
        { secret: RESET_SECRET, subject: user.id, jwtid: randomUUID(), expiresIn: '30m' },
      );
      await expect(
        service.resetPassword({ token: wrongPurpose, senhaNova: 'nova-senha-123' }),
      ).rejects.toThrow(UnprocessableEntityException);

      // Refresh token genuíno também é rejeitado (secret dedicado)
      const { token: refreshToken } = await tokenService.signRefreshToken(user.id);
      await expect(
        service.resetPassword({ token: refreshToken, senhaNova: 'nova-senha-123' }),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('erro 422 traz details com field=token', async () => {
      let caught: unknown;
      try {
        await service.resetPassword({ token: 'invalido', senhaNova: 'nova-senha-123' });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(UnprocessableEntityException);
      const body = (caught as UnprocessableEntityException).getResponse() as {
        details: Array<{ field: string }>;
      };
      expect(body.details[0].field).toBe('token');
    });

    it('usuário PENDENTE (Hotmart sem senha) que define senha vira ATIVO', async () => {
      const user = buildUser({
        senhaHash: null,
        origem: 'HOTMART',
        status: 'PENDENTE',
      });
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.user.update.mockResolvedValue({ ...user, status: 'ATIVO' });
      const { token } = await tokenService.signResetToken(user.id);

      await service.resetPassword({ token, senhaNova: 'primeira-senha-123' });

      const updateArgs = prisma.user.update.mock.calls[0][0];
      expect(updateArgs.data.status).toBe('ATIVO');
      await expect(verifyPassword(updateArgs.data.senhaHash, 'primeira-senha-123')).resolves.toBe(
        true,
      );
    });

    it('usuário INATIVO com token válido → 422 (não redefine)', async () => {
      const user = buildUser({ status: 'INATIVO' });
      prisma.user.findUnique.mockResolvedValue(user);
      const { token } = await tokenService.signResetToken(user.id);

      await expect(service.resetPassword({ token, senhaNova: 'nova-senha-123' })).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
