import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { TokenService } from './token.service';

function fakeConfig(overrides: Record<string, string> = {}): ConfigService {
  const values: Record<string, string> = {
    JWT_ACCESS_SECRET: 'unit-access-secret',
    JWT_REFRESH_SECRET: 'unit-refresh-secret',
    ...overrides,
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

function decodePayload(token: string): Record<string, unknown> {
  const [, payload] = token.split('.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
}

describe('TokenService.signImpersonationToken (unit)', () => {
  const aluno = { id: randomUUID(), role: 'ALUNO' as const, origem: 'PROPRIO' as const };
  const adminId = randomUUID();
  let service: TokenService;

  beforeEach(() => {
    service = new TokenService(new JwtService({}), fakeConfig());
  });

  it('claims assinadas: sub=aluno, role/origem do aluno, impersonatedBy=admin', async () => {
    const token = await service.signImpersonationToken(aluno, adminId);
    const payload = await service.verifyAccessToken(token);

    expect(payload.sub).toBe(aluno.id);
    expect(payload.role).toBe('ALUNO');
    expect(payload.origem).toBe('PROPRIO');
    expect(payload.impersonatedBy).toBe(adminId);
  });

  it('TTL idêntico ao do access token normal (mesma expiração curta)', async () => {
    const normal = decodePayload(await service.signAccessToken(aluno));
    const imp = decodePayload(await service.signImpersonationToken(aluno, adminId));

    const ttlNormal = (normal.exp as number) - (normal.iat as number);
    const ttlImp = (imp.exp as number) - (imp.iat as number);
    expect(ttlImp).toBe(ttlNormal);
    // Sanidade: expiração curta (default 15m), nunca um token de longa duração
    expect(ttlImp).toBeGreaterThan(0);
    expect(ttlImp).toBeLessThanOrEqual(60 * 60);
  });

  it('respeita JWT_ACCESS_EXPIRES_IN configurado', async () => {
    const custom = new TokenService(
      new JwtService({}),
      fakeConfig({ JWT_ACCESS_EXPIRES_IN: '5m' }),
    );
    const payload = decodePayload(await custom.signImpersonationToken(aluno, adminId));
    expect((payload.exp as number) - (payload.iat as number)).toBe(300);
  });

  it('access token normal NÃO carrega a claim impersonatedBy', async () => {
    const payload = decodePayload(await service.signAccessToken(aluno));
    expect(payload).not.toHaveProperty('impersonatedBy');
  });

  it('token de impersonação não é aceito como refresh token (secrets distintos)', async () => {
    const token = await service.signImpersonationToken(aluno, adminId);
    await expect(service.verifyRefreshToken(token)).rejects.toBeDefined();
  });
});
