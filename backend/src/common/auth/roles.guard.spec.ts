import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { AuthenticatedUser, RequestWithUser } from './authenticated-user';
import { ROLES_KEY } from './roles.decorator';
import { RolesGuard } from './roles.guard';

function createContext(
  user: AuthenticatedUser | undefined,
  requiredRoles?: Role[],
): ExecutionContext {
  const handler = (): void => undefined;
  if (requiredRoles) {
    Reflect.defineMetadata(ROLES_KEY, requiredRoles, handler);
  }
  const request = { user } as Partial<RequestWithUser>;
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => class TestController {},
  } as unknown as ExecutionContext;
}

function buildUser(role: Role): AuthenticatedUser {
  return { sub: randomUUID(), role, origem: 'PROPRIO' };
}

describe('RolesGuard (unit)', () => {
  let guard: RolesGuard;

  beforeEach(() => {
    guard = new RolesGuard(new Reflector());
  });

  it('rota sem @Roles() → passa para qualquer usuário', () => {
    expect(guard.canActivate(createContext(buildUser('ALUNO')))).toBe(true);
  });

  it('rota sem @Roles() → passa mesmo sem usuário (ex.: rota pública)', () => {
    expect(guard.canActivate(createContext(undefined))).toBe(true);
  });

  it('@Roles(ADMIN) com usuário ALUNO → ForbiddenException (403 FORBIDDEN)', () => {
    expect(() => guard.canActivate(createContext(buildUser('ALUNO'), ['ADMIN']))).toThrow(
      ForbiddenException,
    );
  });

  it('@Roles(ADMIN) com usuário PROFESSOR → 403 (interno não-admin também é barrado)', () => {
    expect(() => guard.canActivate(createContext(buildUser('PROFESSOR'), ['ADMIN']))).toThrow(
      ForbiddenException,
    );
  });

  it('@Roles(ADMIN) com usuário ADMIN → passa', () => {
    expect(guard.canActivate(createContext(buildUser('ADMIN'), ['ADMIN']))).toBe(true);
  });

  it('múltiplos roles permitidos: MODERADOR passa em @Roles(ADMIN, MODERADOR)', () => {
    expect(guard.canActivate(createContext(buildUser('MODERADOR'), ['ADMIN', 'MODERADOR']))).toBe(
      true,
    );
  });

  it('@Roles(...) sem req.user (AuthGuard não populou) → UnauthorizedException 401', () => {
    expect(() => guard.canActivate(createContext(undefined, ['ADMIN']))).toThrow(
      UnauthorizedException,
    );
  });
});
