import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from './auth.guard';
import { RequestWithUser } from './authenticated-user';
import { IS_PUBLIC_KEY } from './public.decorator';
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

function createContext(
  request: Partial<RequestWithUser>,
  handler: () => void = () => undefined,
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => class TestController {},
  } as unknown as ExecutionContext;
}

describe('AuthGuard (unit)', () => {
  let jwt: JwtService;
  let tokenService: TokenService;
  let guard: AuthGuard;

  beforeEach(() => {
    jwt = new JwtService({});
    tokenService = new TokenService(jwt, fakeConfig());
    guard = new AuthGuard(new Reflector(), tokenService);
  });

  it('rota @Public() passa sem token', async () => {
    const handler = (): void => undefined;
    Reflect.defineMetadata(IS_PUBLIC_KEY, true, handler);

    const context = createContext({ headers: {} } as Partial<RequestWithUser>, handler);
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('sem header Authorization → UnauthorizedException (401 UNAUTHENTICATED)', async () => {
    const context = createContext({ headers: {} } as Partial<RequestWithUser>);
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('scheme diferente de Bearer → 401', async () => {
    const context = createContext({
      headers: { authorization: 'Basic abc123' },
    } as Partial<RequestWithUser>);
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('Bearer sem token → 401', async () => {
    const context = createContext({
      headers: { authorization: 'Bearer ' },
    } as Partial<RequestWithUser>);
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('token com assinatura inválida → 401', async () => {
    const forged = await jwt.signAsync(
      { role: 'ADMIN', origem: 'PROPRIO' },
      { secret: 'outro-secret', subject: randomUUID(), expiresIn: '15m' },
    );
    const context = createContext({
      headers: { authorization: `Bearer ${forged}` },
    } as Partial<RequestWithUser>);
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('token expirado → 401', async () => {
    const expired = await jwt.signAsync(
      { role: 'ALUNO', origem: 'PROPRIO' },
      { secret: ACCESS_SECRET, subject: randomUUID(), expiresIn: '-10s' },
    );
    const context = createContext({
      headers: { authorization: `Bearer ${expired}` },
    } as Partial<RequestWithUser>);
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('token válido → true e injeta req.user com sub/role/origem', async () => {
    const userId = randomUUID();
    const token = await tokenService.signAccessToken({
      id: userId,
      role: 'PROFESSOR',
      origem: 'PROPRIO',
    });

    const request = { headers: { authorization: `Bearer ${token}` } } as RequestWithUser;
    const context = createContext(request);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ sub: userId, role: 'PROFESSOR', origem: 'PROPRIO' });
  });

  it('refresh token não é aceito como access token → 401', async () => {
    const { token: refresh } = await tokenService.signRefreshToken(randomUUID());
    const context = createContext({
      headers: { authorization: `Bearer ${refresh}` },
    } as Partial<RequestWithUser>);
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });
});
