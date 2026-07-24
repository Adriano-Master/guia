import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from './auth.guard';
import { RequestWithUser } from './authenticated-user';
import { TokenService } from '../../modules/auth/token.service';

const ACCESS_SECRET = 'unit-access-secret';

function fakeConfig(): ConfigService {
  const values: Record<string, string> = {
    JWT_ACCESS_SECRET: ACCESS_SECRET,
    JWT_REFRESH_SECRET: 'unit-refresh-secret',
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

function createContext(request: Partial<RequestWithUser>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => (): void => undefined,
    getClass: () => class TestController {},
  } as unknown as ExecutionContext;
}

describe('AuthGuard (unit) — modo somente leitura da impersonação', () => {
  let jwt: JwtService;
  let tokenService: TokenService;
  let guard: AuthGuard;
  const adminId = randomUUID();
  const alunoId = randomUUID();

  beforeEach(() => {
    jwt = new JwtService({});
    tokenService = new TokenService(jwt, fakeConfig());
    guard = new AuthGuard(new Reflector(), tokenService);
  });

  async function impersonationToken(): Promise<string> {
    return tokenService.signImpersonationToken(
      { id: alunoId, role: 'ALUNO', origem: 'PROPRIO' },
      adminId,
    );
  }

  it.each(['POST', 'PATCH', 'PUT', 'DELETE'])(
    'token impersonado + %s → ForbiddenException com a mensagem exata',
    async (method) => {
      const token = await impersonationToken();
      const context = createContext({
        method,
        headers: { authorization: `Bearer ${token}` },
      } as Partial<RequestWithUser>);

      let caught: unknown;
      try {
        await guard.canActivate(context);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ForbiddenException);
      expect((caught as ForbiddenException).message).toBe(
        'Modo de visualização é somente leitura.',
      );
    },
  );

  it('método em caixa baixa ("post") não burla o bloqueio', async () => {
    const token = await impersonationToken();
    const context = createContext({
      method: 'post',
      headers: { authorization: `Bearer ${token}` },
    } as Partial<RequestWithUser>);
    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])(
    'token impersonado + %s → passa e injeta impersonatedBy em req.user',
    async (method) => {
      const token = await impersonationToken();
      const request = {
        method,
        headers: { authorization: `Bearer ${token}` },
      } as RequestWithUser;

      await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
      expect(request.user).toEqual({
        sub: alunoId,
        role: 'ALUNO',
        origem: 'PROPRIO',
        impersonatedBy: adminId,
      });
    },
  );

  it('token normal (signAccessToken) + POST → passa e req.user NÃO tem impersonatedBy', async () => {
    const token = await tokenService.signAccessToken({
      id: alunoId,
      role: 'ALUNO',
      origem: 'PROPRIO',
    });
    const request = {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    } as RequestWithUser;

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(request.user).toEqual({ sub: alunoId, role: 'ALUNO', origem: 'PROPRIO' });
    expect(request.user).not.toHaveProperty('impersonatedBy');
  });

  it('claim impersonatedBy forjada com secret errado → 401 (assinatura vence)', async () => {
    const forged = await jwt.signAsync(
      { role: 'ALUNO', origem: 'PROPRIO', impersonatedBy: adminId },
      { secret: 'secret-do-atacante', subject: alunoId, expiresIn: '15m' },
    );
    const context = createContext({
      method: 'GET',
      headers: { authorization: `Bearer ${forged}` },
    } as Partial<RequestWithUser>);
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('token impersonado com a claim removida do payload (assinatura antiga) → 401, não escrita liberada', async () => {
    const token = await impersonationToken();
    const [header, payload, signature] = token.split('.');
    const body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    delete body.impersonatedBy;
    const tampered = `${header}.${Buffer.from(JSON.stringify(body)).toString('base64url')}.${signature}`;

    const context = createContext({
      method: 'POST',
      headers: { authorization: `Bearer ${tampered}` },
    } as Partial<RequestWithUser>);
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('token impersonado expirado → 401 mesmo em GET', async () => {
    const expired = await jwt.signAsync(
      { role: 'ALUNO', origem: 'PROPRIO', impersonatedBy: adminId },
      { secret: ACCESS_SECRET, subject: alunoId, expiresIn: '-10s' },
    );
    const context = createContext({
      method: 'GET',
      headers: { authorization: `Bearer ${expired}` },
    } as Partial<RequestWithUser>);
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });
});
