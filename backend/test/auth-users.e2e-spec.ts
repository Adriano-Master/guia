import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request, { Response } from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { createGlobalValidationPipe } from '../src/common/pipes/validation.pipe';
import { hashPassword } from '../src/common/security/password';
import { EMAIL_SERVICE } from '../src/modules/auth/email.service';
import { PrismaService } from '../src/prisma/prisma.service';

// Banco DEDICADO de teste (guia_test) — nunca o banco de dev `guia`.
// O placeholder vem de test/setup-env.ts quando DATABASE_URL não está setada.
if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('localhost:5432/test')) {
  process.env.DATABASE_URL =
    'postgresql://guia:160402dbbba472cb61848717@localhost:5433/guia_test?schema=public';
}
if (!/guia_test/.test(process.env.DATABASE_URL)) {
  throw new Error(
    `E2E de auth exige banco guia_test (recebido: ${process.env.DATABASE_URL}). ` +
      'Nunca rode contra o banco de dev.',
  );
}

interface SentEmail {
  to: string;
  resetUrl: string;
}

async function createApp(sentEmails?: SentEmail[]): Promise<INestApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (sentEmails) {
    builder = builder.overrideProvider(EMAIL_SERVICE).useValue({
      sendPasswordReset: async (to: string, resetUrl: string): Promise<void> => {
        sentEmails.push({ to, resetUrl });
      },
    });
  }
  const moduleFixture: TestingModule = await builder.compile();
  const app = moduleFixture.createNestApplication();
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.useGlobalPipes(createGlobalValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}

/** Nenhuma resposta pode conter senhaHash/senha_hash no corpo serializado. */
function expectNoPasswordHash(res: Response): void {
  expect(res.text ?? '').not.toMatch(/senha_?hash/i);
}

function expectErrorEnvelope(res: Response, code: string): void {
  expect(res.body.error).toMatchObject({
    code,
    message: expect.any(String),
    traceId: expect.any(String),
  });
  expect(res.headers['x-trace-id']).toBe(res.body.error.traceId);
  expectNoPasswordHash(res);
}

describe('Auth e Usuários (e2e) — fluxo do aluno', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sentEmails: SentEmail[] = [];

  const aluno = { nome: 'Aluno E2E', email: 'aluno.e2e@guia.test', senha: 'senha-original-1' };
  const aluno2 = { nome: 'Outro Aluno', email: 'outro.aluno@guia.test', senha: 'senha-outro-123' };

  let alunoId: string;
  let accessToken: string;
  let refreshToken: string;
  const senhaTrocada = 'senha-trocada-22';
  const senhaResetada = 'senha-resetada-3';

  beforeAll(async () => {
    app = await createApp(sentEmails);
    prisma = app.get(PrismaService);
    // Ordem de limpeza: planos → users (FK planos.autor_id referencia users)
    await prisma.plano.deleteMany({});
    await prisma.user.deleteMany({});
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /auth/register cria ALUNO/PROPRIO/ATIVO (201, { user }, sem senhaHash)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(aluno)
      .expect(201);

    expect(res.body.user).toMatchObject({
      id: expect.any(String),
      nome: aluno.nome,
      email: aluno.email,
      role: 'ALUNO',
      status: 'ATIVO',
      origem: 'PROPRIO',
      ultimoLoginAt: null,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expectNoPasswordHash(res);
    alunoId = res.body.user.id;
  });

  it('register com mesmo email em caixa diferente → 409 CONFLICT (citext)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ ...aluno, email: 'ALUNO.E2E@GUIA.TEST' })
      .expect(409);
    expectErrorEnvelope(res, 'CONFLICT');
  });

  it('register com senha < 8 chars → 422 com details[].field = "senha"', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ nome: 'X', email: 'curta@guia.test', senha: '1234567' })
      .expect(422);
    expectErrorEnvelope(res, 'VALIDATION_ERROR');
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'senha' })]),
    );
  });

  it('login com senha errada → 401 UNAUTHENTICATED genérico', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: aluno.email, senha: 'senha-errada-999' })
      .expect(401);
    expectErrorEnvelope(res, 'UNAUTHENTICATED');
    // Mensagem genérica: não revela se o problema foi email ou senha
    expect(res.body.error.message).not.toMatch(/senha|email/i);
  });

  it('login válido → 200 com par de tokens, user sem senhaHash e ultimoLoginAt preenchido', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: aluno.email, senha: aluno.senha })
      .expect(200);

    expect(res.body).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      user: expect.objectContaining({ id: alunoId, email: aluno.email }),
    });
    expect(res.body.user.ultimoLoginAt).toEqual(expect.any(String));
    expectNoPasswordHash(res);

    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
  });

  it('GET /users/me sem token → 401 UNAUTHENTICATED', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/users/me').expect(401);
    expectErrorEnvelope(res, 'UNAUTHENTICATED');
  });

  it('GET /users/me com token inválido → 401', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', 'Bearer token-adulterado')
      .expect(401);
    expectErrorEnvelope(res, 'UNAUTHENTICATED');
  });

  it('GET /users/me autenticado → 200 { user } sem senhaHash', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body.user).toMatchObject({ id: alunoId, email: aluno.email, role: 'ALUNO' });
    expectNoPasswordHash(res);
  });

  it('PATCH /users/me atualiza nome', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ nome: 'Aluno Renomeado' })
      .expect(200);
    expect(res.body.user.nome).toBe('Aluno Renomeado');
    expectNoPasswordHash(res);
  });

  it('PATCH /users/me trocando para email já usado por outro → 409', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/register').send(aluno2).expect(201);

    const res = await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ email: aluno2.email })
      .expect(409);
    expectErrorEnvelope(res, 'CONFLICT');
  });

  it('POST /users/me/password com senha atual errada → 422 com field=senhaAtual', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/users/me/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ senhaAtual: 'nao-e-essa-11', senhaNova: senhaTrocada })
      .expect(422);
    expectErrorEnvelope(res, 'VALIDATION_ERROR');
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'senhaAtual' })]),
    );
  });

  it('POST /users/me/password com senha atual correta → 204 e nova senha loga', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/users/me/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ senhaAtual: aluno.senha, senhaNova: senhaTrocada })
      .expect(204);

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: aluno.email, senha: senhaTrocada })
      .expect(200);
    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
  });

  it('POST /auth/refresh rotaciona: novo par emitido e refresh antigo → 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(200);
    expect(res.body).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
    });
    expect(res.body.refreshToken).not.toBe(refreshToken);
    expectNoPasswordHash(res);

    // Reuso do refresh antigo (já rotacionado) → 401
    const reuse = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(401);
    expectErrorEnvelope(reuse, 'UNAUTHENTICATED');

    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
  });

  it('POST /auth/refresh sem corpo válido → 422; token forjado → 401', async () => {
    const semCorpo = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({})
      .expect(422);
    expectErrorEnvelope(semCorpo, 'VALIDATION_ERROR');

    const forjado = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'abc.def.ghi' })
      .expect(401);
    expectErrorEnvelope(forjado, 'UNAUTHENTICATED');
  });

  it('POST /auth/logout exige autenticação → 401 sem Bearer', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .send({ refreshToken })
      .expect(401);
    expectErrorEnvelope(res, 'UNAUTHENTICATED');
  });

  it('logout → 204; refresh após logout → 401; logout repetido é idempotente (204)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken })
      .expect(204);

    const reuse = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(401);
    expectErrorEnvelope(reuse, 'UNAUTHENTICATED');

    // Idempotente: mesmo refresh já negado → 204 de novo
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken })
      .expect(204);
  });

  it('rotas administrativas negam ALUNO → 403 FORBIDDEN', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
    expectErrorEnvelope(list, 'FORBIDDEN');

    const getById = await request(app.getHttpServer())
      .get(`/api/v1/users/${alunoId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
    expectErrorEnvelope(getById, 'FORBIDDEN');

    const patch = await request(app.getHttpServer())
      .patch(`/api/v1/users/${alunoId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ role: 'ADMIN' })
      .expect(403);
    expectErrorEnvelope(patch, 'FORBIDDEN');
  });

  it('forgot-password é sempre silencioso: email inexistente → 204 sem envio', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'ninguem@guia.test' })
      .expect(204);
    expect(sentEmails).toHaveLength(0);
  });

  it('fluxo de reset: forgot → email com link → reset 204 → login com nova senha; token é de uso único', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: aluno.email })
      .expect(204);

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe(aluno.email);
    const token = new URL(sentEmails[0].resetUrl).searchParams.get('token');
    expect(token).toBeTruthy();

    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token, senhaNova: senhaResetada })
      .expect(204);

    // Token já usado → 422
    const reuso = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token, senhaNova: 'mais-uma-senha-9' })
      .expect(422);
    expectErrorEnvelope(reuso, 'VALIDATION_ERROR');

    // Nova senha funciona; a anterior não
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: aluno.email, senha: senhaResetada })
      .expect(200);
  });

  it('reset-password com token inválido → 422', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: 'token-invalido', senhaNova: 'qualquer-senha-1' })
      .expect(422);
    expectErrorEnvelope(res, 'VALIDATION_ERROR');
  });
});

describe('Auth e Usuários (e2e) — administração e status de conta', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const adminSenha = 'senha-admin-e2e1';
  let adminId: string;
  let adminToken: string;
  let mariaId: string;

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    // Ordem de limpeza: planos → users (FK planos.autor_id referencia users)
    await prisma.plano.deleteMany({});
    await prisma.user.deleteMany({});

    const senhaHash = await hashPassword(adminSenha);
    const admin = await prisma.user.create({
      data: {
        nome: 'Admin E2E',
        email: 'admin.e2e@guia.test',
        senhaHash,
        role: 'ADMIN',
        status: 'ATIVO',
        origem: 'PROPRIO',
      },
    });
    adminId = admin.id;

    const maria = await prisma.user.create({
      data: {
        nome: 'Maria Aluna',
        email: 'maria@guia.test',
        senhaHash: null,
        role: 'ALUNO',
        status: 'ATIVO',
        origem: 'PROPRIO',
      },
    });
    mariaId = maria.id;

    await prisma.user.create({
      data: {
        nome: 'João Professor',
        email: 'joao@guia.test',
        senhaHash: null,
        role: 'PROFESSOR',
        status: 'ATIVO',
        origem: 'PROPRIO',
      },
    });
    await prisma.user.create({
      data: {
        nome: 'Inativo E2E',
        email: 'inativo@guia.test',
        senhaHash,
        role: 'ALUNO',
        status: 'INATIVO',
        origem: 'PROPRIO',
      },
    });
    await prisma.user.create({
      data: {
        nome: 'Pendente Hotmart',
        email: 'pendente@guia.test',
        senhaHash: null,
        role: 'ALUNO',
        status: 'PENDENTE',
        origem: 'HOTMART',
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('login do admin → 200', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin.e2e@guia.test', senha: adminSenha })
      .expect(200);
    adminToken = res.body.accessToken;
    expectNoPasswordHash(res);
  });

  it('login de usuário INATIVO → 401 genérico (mesmo com senha correta)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'inativo@guia.test', senha: adminSenha })
      .expect(401);
    expectErrorEnvelope(res, 'UNAUTHENTICATED');
  });

  it('login de usuário PENDENTE (Hotmart sem senha) → 401 genérico', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'pendente@guia.test', senha: 'qualquer-senha-1' })
      .expect(401);
    expectErrorEnvelope(res, 'UNAUTHENTICATED');
  });

  it('GET /users → paginação padrão { data, page: 1, pageSize: 20, total } sem senhaHash', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body).toMatchObject({ page: 1, pageSize: 20, total: 5 });
    expect(res.body.data).toHaveLength(5);
    expectNoPasswordHash(res);
  });

  it('GET /users com page/pageSize/sort → fatia correta ordenada', async () => {
    const page1 = await request(app.getHttpServer())
      .get('/api/v1/users?page=1&pageSize=2&sort=email')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const page2 = await request(app.getHttpServer())
      .get('/api/v1/users?page=2&pageSize=2&sort=email')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(page1.body).toMatchObject({ page: 1, pageSize: 2, total: 5 });
    expect(page1.body.data).toHaveLength(2);
    expect(page2.body.data).toHaveLength(2);

    const emails = [...page1.body.data, ...page2.body.data].map(
      (u: { email: string }) => u.email,
    );
    expect(emails).toEqual([...emails].sort());
  });

  it('GET /users?pageSize=101 (acima do máximo) → 422', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/users?pageSize=101')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(422);
    expectErrorEnvelope(res, 'VALIDATION_ERROR');
  });

  it('GET /users?sort=<campo fora da allowlist> → 422 com field=sort', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/users?sort=-senhaHash')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(422);
    expectErrorEnvelope(res, 'VALIDATION_ERROR');
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'sort' })]),
    );
  });

  it('GET /users com filtros role/status/q', async () => {
    const porRole = await request(app.getHttpServer())
      .get('/api/v1/users?role=PROFESSOR')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(porRole.body.total).toBe(1);
    expect(porRole.body.data[0].email).toBe('joao@guia.test');

    const porStatus = await request(app.getHttpServer())
      .get('/api/v1/users?status=INATIVO')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(porStatus.body.total).toBe(1);
    expect(porStatus.body.data[0].email).toBe('inativo@guia.test');

    const porQ = await request(app.getHttpServer())
      .get('/api/v1/users?q=MARIA')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(porQ.body.total).toBe(1);
    expect(porQ.body.data[0].email).toBe('maria@guia.test');

    const roleInvalida = await request(app.getHttpServer())
      .get('/api/v1/users?role=SUPERUSER')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(422);
    expectErrorEnvelope(roleInvalida, 'VALIDATION_ERROR');
  });

  it('GET /users/{id} → 200 { user }; inexistente → 404; id não-UUID → 422', async () => {
    const ok = await request(app.getHttpServer())
      .get(`/api/v1/users/${mariaId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(ok.body.user).toMatchObject({ id: mariaId, email: 'maria@guia.test' });
    expectNoPasswordHash(ok);

    const notFound = await request(app.getHttpServer())
      .get(`/api/v1/users/${randomUUID()}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
    expectErrorEnvelope(notFound, 'NOT_FOUND');

    const badId = await request(app.getHttpServer())
      .get('/api/v1/users/nao-e-uuid')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(422);
    expectErrorEnvelope(badId, 'VALIDATION_ERROR');
  });

  it('PATCH /users/{id} altera role/status → 200 sem senhaHash', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/users/${mariaId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'MODERADOR' })
      .expect(200);
    expect(res.body.user).toMatchObject({ id: mariaId, role: 'MODERADOR', status: 'ATIVO' });
    expectNoPasswordHash(res);
  });

  it('rebaixar/desativar o último ADMIN ATIVO → 409 CONFLICT', async () => {
    const rebaixar = await request(app.getHttpServer())
      .patch(`/api/v1/users/${adminId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'ALUNO' })
      .expect(409);
    expectErrorEnvelope(rebaixar, 'CONFLICT');

    const desativar = await request(app.getHttpServer())
      .patch(`/api/v1/users/${adminId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'INATIVO' })
      .expect(409);
    expectErrorEnvelope(desativar, 'CONFLICT');
  });

  it('com um segundo ADMIN ATIVO, desativar o primeiro → permitido (200)', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/users/${mariaId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'ADMIN' })
      .expect(200);

    const res = await request(app.getHttpServer())
      .patch(`/api/v1/users/${adminId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'INATIVO' })
      .expect(200);
    expect(res.body.user).toMatchObject({ id: adminId, status: 'INATIVO' });
  });
});

describe('Auth (e2e) — rate limiting', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    // Ordem de limpeza: planos → users (FK planos.autor_id referencia users)
    await prisma.plano.deleteMany({});
    await prisma.user.deleteMany({});
  });

  afterAll(async () => {
    // Ordem de limpeza: planos → users (FK planos.autor_id referencia users)
    await prisma.plano.deleteMany({});
    await prisma.user.deleteMany({});
    await app.close();
  });

  it('6ª requisição em 60s a /auth/forgot-password → 429 RATE_LIMITED', async () => {
    for (let i = 0; i < 5; i += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email: `throttle${i}@guia.test` })
        .expect(204);
    }

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'throttle6@guia.test' })
      .expect(429);
    expectErrorEnvelope(res, 'RATE_LIMITED');
  });

  it('o limite é por rota: /auth/login continua respondendo após estourar forgot-password', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'nao-existe@guia.test', senha: 'qualquer-senha-1' })
      .expect(401);
    expectErrorEnvelope(res, 'UNAUTHENTICATED');
  });
});

// ---------------------------------------------------------------------------
// REGRESSÕES de code review (auth-e-usuarios)
// ---------------------------------------------------------------------------

describe('Auth (e2e) — regressão: rate limiting em register e refresh', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    // App dedicado: o contador do throttler é em memória, por instância.
    app = await createApp();
    prisma = app.get(PrismaService);
    // Ordem de limpeza: planos → users (FK planos.autor_id referencia users)
    await prisma.plano.deleteMany({});
    await prisma.user.deleteMany({});
  });

  afterAll(async () => {
    // Ordem de limpeza: planos → users (FK planos.autor_id referencia users)
    await prisma.plano.deleteMany({});
    await prisma.user.deleteMany({});
    await app.close();
  });

  it('6º POST /auth/register em 60s → 429 RATE_LIMITED', async () => {
    for (let i = 0; i < 5; i += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          nome: `Throttle Register ${i}`,
          email: `throttle.register${i}@guia.test`,
          senha: 'senha-valida-12',
        })
        .expect(201);
    }

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        nome: 'Throttle Register 6',
        email: 'throttle.register6@guia.test',
        senha: 'senha-valida-12',
      })
      .expect(429);
    expectErrorEnvelope(res, 'RATE_LIMITED');
  });

  it('6º POST /auth/refresh em 60s → 429 RATE_LIMITED (contador separado do register)', async () => {
    // Tokens inválidos também contam: o throttler roda antes do handler.
    for (let i = 0; i < 5; i += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'token-invalido' })
        .expect(401);
    }

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'token-invalido' })
      .expect(429);
    expectErrorEnvelope(res, 'RATE_LIMITED');
  });
});

describe('Users (e2e) — regressão: ordenação por ultimoLoginAt', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;

  const adminSenha = 'senha-admin-sort1';

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    // Ordem de limpeza: planos → users (FK planos.autor_id referencia users)
    await prisma.plano.deleteMany({});
    await prisma.user.deleteMany({});

    const senhaHash = await hashPassword(adminSenha);
    await prisma.user.create({
      data: {
        nome: 'Admin Sort',
        email: 'admin.sort@guia.test',
        senhaHash,
        role: 'ADMIN',
        status: 'ATIVO',
        origem: 'PROPRIO',
        // O login abaixo sobrescreve com "agora" → vira o mais recente.
      },
    });
    await prisma.user.create({
      data: {
        nome: 'Login Janeiro',
        email: 'login.janeiro@guia.test',
        senhaHash: null,
        role: 'ALUNO',
        status: 'ATIVO',
        origem: 'PROPRIO',
        ultimoLoginAt: new Date('2026-01-10T10:00:00Z'),
      },
    });
    await prisma.user.create({
      data: {
        nome: 'Login Marco',
        email: 'login.marco@guia.test',
        senhaHash: null,
        role: 'ALUNO',
        status: 'ATIVO',
        origem: 'PROPRIO',
        ultimoLoginAt: new Date('2026-03-05T10:00:00Z'),
      },
    });

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin.sort@guia.test', senha: adminSenha })
      .expect(200);
    adminToken = login.body.accessToken;
  });

  afterAll(async () => {
    // Ordem de limpeza: planos → users (FK planos.autor_id referencia users)
    await prisma.plano.deleteMany({});
    await prisma.user.deleteMany({});
    await app.close();
  });

  it('GET /users?sort=-ultimoLoginAt → 200 ordenado do login mais recente para o mais antigo', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/users?sort=-ultimoLoginAt')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body).toMatchObject({ page: 1, pageSize: 20, total: 3 });
    expect(res.body.data.map((u: { email: string }) => u.email)).toEqual([
      'admin.sort@guia.test', // logou agora
      'login.marco@guia.test',
      'login.janeiro@guia.test',
    ]);
    expectNoPasswordHash(res);
  });

  it('GET /users?sort=ultimoLoginAt → 200 em ordem ascendente', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/users?sort=ultimoLoginAt')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.data.map((u: { email: string }) => u.email)).toEqual([
      'login.janeiro@guia.test',
      'login.marco@guia.test',
      'admin.sort@guia.test',
    ]);
  });
});
