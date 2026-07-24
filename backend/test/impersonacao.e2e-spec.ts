import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request, { Response } from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { createGlobalValidationPipe } from '../src/common/pipes/validation.pipe';
import { hashPassword } from '../src/common/security/password';
import { TokenService } from '../src/modules/auth/token.service';
import { PrismaService } from '../src/prisma/prisma.service';

// Banco DEDICADO de teste (guia_test) — nunca o banco de dev `guia`.
if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('localhost:5432/test')) {
  process.env.DATABASE_URL =
    'postgresql://guia:160402dbbba472cb61848717@localhost:5433/guia_test?schema=public';
}
if (!/guia_test/.test(process.env.DATABASE_URL)) {
  throw new Error(
    `E2E de impersonação exige banco guia_test (recebido: ${process.env.DATABASE_URL}). ` +
      'Nunca rode contra o banco de dev.',
  );
}

async function createApp(): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleFixture.createNestApplication();
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.useGlobalPipes(createGlobalValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}

function expectErrorEnvelope(res: Response, code: string): void {
  expect(res.body.error).toMatchObject({
    code,
    message: expect.any(String),
    traceId: expect.any(String),
  });
  expect(res.headers['x-trace-id']).toBe(res.body.error.traceId);
  expect(res.text ?? '').not.toMatch(/senha_?hash/i);
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split('.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
}

/** Adultera o payload mantendo a assinatura original (que fica inválida). */
function tamperJwtPayload(
  token: string,
  mutate: (payload: Record<string, unknown>) => void,
): string {
  const [header, payload, signature] = token.split('.');
  const body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
  mutate(body);
  return `${header}.${Buffer.from(JSON.stringify(body)).toString('base64url')}.${signature}`;
}

/** Ordem respeita FKs (mesma dos demais e2e). */
async function cleanDatabase(prisma: PrismaService): Promise<void> {
  await prisma.pontuacaoAluno.deleteMany({});
  await prisma.registroQuestoes.deleteMany({});
  await prisma.sessaoEstudo.deleteMany({});
  await prisma.blocoCronograma.deleteMany({});
  await prisma.cronograma.deleteMany({});
  await prisma.progressoSubtema.deleteMany({});
  await prisma.turmaPlano.deleteMany({});
  await prisma.matricula.deleteMany({});
  await prisma.turma.deleteMany({});
  await prisma.plano.deleteMany({});
  await prisma.user.deleteMany({});
}

describe('Impersonação — visualização como aluno (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokenService: TokenService;
  let server: ReturnType<INestApplication['getHttpServer']>;

  let adminId: string;
  let moderadorId: string;
  let professorId: string;
  let alunoAtivoId: string;
  let alunoInativoId: string;
  let alunoDeletadoId: string;

  let adminToken: string;
  let moderadorToken: string;
  let professorToken: string;
  let alunoToken: string;

  /** Token de impersonação emitido no caminho feliz e reusado nos adversariais. */
  let impToken: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    tokenService = app.get(TokenService);
    server = app.getHttpServer();
    await cleanDatabase(prisma);

    const senhaHash = await hashPassword('senha-impersonacao-1');
    const criar = async (
      nome: string,
      email: string,
      role: 'ADMIN' | 'MODERADOR' | 'PROFESSOR' | 'ALUNO',
      status: 'ATIVO' | 'INATIVO' = 'ATIVO',
      deletedAt: Date | null = null,
    ): Promise<string> => {
      const user = await prisma.user.create({
        data: { nome, email, senhaHash, role, status, origem: 'PROPRIO', deletedAt },
      });
      return user.id;
    };

    adminId = await criar('Admin Imp', 'admin.imp@guia.test', 'ADMIN');
    moderadorId = await criar('Moderador Imp', 'mod.imp@guia.test', 'MODERADOR');
    professorId = await criar('Professor Imp', 'prof.imp@guia.test', 'PROFESSOR');
    alunoAtivoId = await criar('Aluno Ativo Imp', 'aluno.ativo.imp@guia.test', 'ALUNO');
    alunoInativoId = await criar(
      'Aluno Inativo Imp',
      'aluno.inativo.imp@guia.test',
      'ALUNO',
      'INATIVO',
    );
    alunoDeletadoId = await criar(
      'Aluno Deletado Imp',
      'aluno.deletado.imp@guia.test',
      'ALUNO',
      'ATIVO',
      new Date(),
    );

    // Tokens direto pelo TokenService (evita o throttler de /auth/login).
    const sign = (id: string, role: 'ADMIN' | 'MODERADOR' | 'PROFESSOR' | 'ALUNO') =>
      tokenService.signAccessToken({ id, role, origem: 'PROPRIO' });
    adminToken = await sign(adminId, 'ADMIN');
    moderadorToken = await sign(moderadorId, 'MODERADOR');
    professorToken = await sign(professorId, 'PROFESSOR');
    alunoToken = await sign(alunoAtivoId, 'ALUNO');
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  // -------------------------------------------------------------------------
  // Caminho feliz
  // -------------------------------------------------------------------------

  it('ADMIN impersona ALUNO ATIVO → 200 { accessToken, user } SEM refreshToken; claims corretas', async () => {
    const res = await request(server)
      .post(`/api/v1/users/${alunoAtivoId}/impersonate`)
      .set(auth(adminToken))
      .expect(200);

    expect(res.body).toMatchObject({
      accessToken: expect.any(String),
      user: {
        id: alunoAtivoId,
        nome: 'Aluno Ativo Imp',
        email: 'aluno.ativo.imp@guia.test',
        role: 'ALUNO',
      },
    });
    // Contrato de segurança: impersonação NUNCA emite refresh token
    expect(res.body).not.toHaveProperty('refreshToken');
    expect(Object.keys(res.body).sort()).toEqual(['accessToken', 'user']);
    expect(res.text).not.toMatch(/senha_?hash/i);

    impToken = res.body.accessToken as string;
    const payload = decodeJwtPayload(impToken);
    expect(payload.sub).toBe(alunoAtivoId);
    expect(payload.role).toBe('ALUNO');
    expect(payload.impersonatedBy).toBe(adminId);

    // TTL do token impersonado = TTL do access token normal (expiração curta)
    const normal = decodeJwtPayload(adminToken);
    const ttlNormal = (normal.exp as number) - (normal.iat as number);
    const ttlImp = (payload.exp as number) - (payload.iat as number);
    expect(ttlImp).toBe(ttlNormal);
    expect(ttlImp).toBeLessThanOrEqual(60 * 60);
  });

  it('ADMIN impersona ALUNO INATIVO → 200 (inspeção de conta permitida)', async () => {
    const res = await request(server)
      .post(`/api/v1/users/${alunoInativoId}/impersonate`)
      .set(auth(adminToken))
      .expect(200);

    expect(res.body.user).toMatchObject({ id: alunoInativoId, role: 'ALUNO' });
    expect(res.body).not.toHaveProperty('refreshToken');
    const payload = decodeJwtPayload(res.body.accessToken as string);
    expect(payload.sub).toBe(alunoInativoId);
    expect(payload.impersonatedBy).toBe(adminId);
  });

  it('token impersonado lê como o aluno: GET /users/me → dados do ALUNO, não do admin', async () => {
    const res = await request(server).get('/api/v1/users/me').set(auth(impToken)).expect(200);
    expect(res.body.user).toMatchObject({
      id: alunoAtivoId,
      email: 'aluno.ativo.imp@guia.test',
      role: 'ALUNO',
    });
  });

  it('token impersonado acessa as leituras do aluno: estatísticas, ranking, sessões e questões → 200', async () => {
    const resumo = await request(server)
      .get('/api/v1/estatisticas/resumo')
      .set(auth(impToken))
      .expect(200);
    expect(resumo.body).toBeDefined();

    const ranking = await request(server)
      .get('/api/v1/ranking/me')
      .set(auth(impToken))
      .expect(200);
    expect(ranking.body).toHaveProperty('pontos');

    const sessoes = await request(server)
      .get('/api/v1/sessoes')
      .set(auth(impToken))
      .expect(200);
    expect(sessoes.body).toMatchObject({ total: 0 });

    await request(server).get('/api/v1/questoes').set(auth(impToken)).expect(200);
  });

  // -------------------------------------------------------------------------
  // Escalada / abuso da rota de impersonação
  // -------------------------------------------------------------------------

  it('MODERADOR, PROFESSOR e ALUNO não impersonam → 403 FORBIDDEN', async () => {
    for (const token of [moderadorToken, professorToken, alunoToken]) {
      const res = await request(server)
        .post(`/api/v1/users/${alunoAtivoId}/impersonate`)
        .set(auth(token))
        .expect(403);
      expectErrorEnvelope(res, 'FORBIDDEN');
    }
  });

  it('sem token → 401 UNAUTHENTICATED', async () => {
    const res = await request(server)
      .post(`/api/v1/users/${alunoAtivoId}/impersonate`)
      .expect(401);
    expectErrorEnvelope(res, 'UNAUTHENTICATED');
  });

  it('alvo ADMIN (a si mesmo), MODERADOR ou PROFESSOR → 422 com details[].field = "id"', async () => {
    for (const alvoId of [adminId, moderadorId, professorId]) {
      const res = await request(server)
        .post(`/api/v1/users/${alvoId}/impersonate`)
        .set(auth(adminToken))
        .expect(422);
      expectErrorEnvelope(res, 'VALIDATION_ERROR');
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'id' })]),
      );
    }
  });

  it('alvo inexistente e soft-deletado → 404; id não-UUID → 422', async () => {
    const inexistente = await request(server)
      .post(`/api/v1/users/${randomUUID()}/impersonate`)
      .set(auth(adminToken))
      .expect(404);
    expectErrorEnvelope(inexistente, 'NOT_FOUND');

    const deletado = await request(server)
      .post(`/api/v1/users/${alunoDeletadoId}/impersonate`)
      .set(auth(adminToken))
      .expect(404);
    expectErrorEnvelope(deletado, 'NOT_FOUND');

    const naoUuid = await request(server)
      .post('/api/v1/users/nao-e-uuid/impersonate')
      .set(auth(adminToken))
      .expect(422);
    expectErrorEnvelope(naoUuid, 'VALIDATION_ERROR');
  });

  it('encadear impersonação (token impersonado tentando impersonar) → 403 read-only', async () => {
    const res = await request(server)
      .post(`/api/v1/users/${alunoInativoId}/impersonate`)
      .set(auth(impToken))
      .expect(403);
    expectErrorEnvelope(res, 'FORBIDDEN');
    // Bloqueado pelo modo somente-leitura ANTES de qualquer checagem de role
    expect(res.body.error.message).toBe('Modo de visualização é somente leitura.');
  });

  it('token impersonado NÃO herda privilégios do admin: GET /users (rota ADMIN) → 403', async () => {
    const res = await request(server).get('/api/v1/users').set(auth(impToken)).expect(403);
    expectErrorEnvelope(res, 'FORBIDDEN');
  });

  // -------------------------------------------------------------------------
  // Read-only de verdade: toda escrita bloqueada com a mensagem exata
  // -------------------------------------------------------------------------

  it('toda rota de escrita com token impersonado → 403 FORBIDDEN "Modo de visualização é somente leitura."', async () => {
    const subtemaFake = randomUUID();
    const escritas: Array<[method: 'post' | 'put' | 'patch' | 'delete', url: string, body?: object]> = [
      ['post', '/api/v1/sessoes/cronometro/start', { disciplinaId: randomUUID() }],
      ['post', '/api/v1/sessoes/manual', {}],
      ['post', '/api/v1/sessoes/ativa/stop', {}],
      ['delete', '/api/v1/sessoes/ativa'],
      ['put', `/api/v1/progresso/subtemas/${subtemaFake}`, { concluido: true }],
      ['post', '/api/v1/questoes', {}],
      ['patch', `/api/v1/questoes/${randomUUID()}`, { acertos: 10 }],
      ['patch', '/api/v1/users/me', { nome: 'Hacker Via Impersonação' }],
      ['post', '/api/v1/users/me/password', { senhaAtual: 'x', senhaNova: 'yyyyyyyy' }],
      ['post', '/api/v1/auth/logout', { refreshToken: 'qualquer' }],
      ['post', '/api/v1/cronogramas', {}],
      ['patch', `/api/v1/blocos/${randomUUID()}`, {}],
      ['post', '/api/v1/planos', { titulo: 'Plano do atacante', tipo: 'PESSOAL' }],
      ['post', '/api/v1/matriculas', { codigoConvite: 'ABC123' }],
    ];

    for (const [method, url, body] of escritas) {
      const res = await request(server)[method](url).set(auth(impToken)).send(body);
      expect({ url, method, status: res.status }).toEqual({ url, method, status: 403 });
      expectErrorEnvelope(res, 'FORBIDDEN');
      expect(res.body.error.message).toBe('Modo de visualização é somente leitura.');
    }
  });

  it('nenhuma escrita vazou: nome do aluno intacto e zero sessões/questões/planos no banco', async () => {
    const me = await request(server).get('/api/v1/users/me').set(auth(impToken)).expect(200);
    expect(me.body.user.nome).toBe('Aluno Ativo Imp');

    await expect(prisma.sessaoEstudo.count()).resolves.toBe(0);
    await expect(prisma.registroQuestoes.count()).resolves.toBe(0);
    await expect(prisma.plano.count()).resolves.toBe(0);
    await expect(prisma.matricula.count()).resolves.toBe(0);
  });

  // -------------------------------------------------------------------------
  // Forja de token
  // -------------------------------------------------------------------------

  it('token normal do MESMO aluno (sem claim) segue escrevendo: PATCH /users/me → 200', async () => {
    const res = await request(server)
      .patch('/api/v1/users/me')
      .set(auth(alunoToken))
      .send({ nome: 'Aluno Renomeado Por Ele Mesmo' })
      .expect(200);
    expect(res.body.user.nome).toBe('Aluno Renomeado Por Ele Mesmo');
  });

  it('remover a claim impersonatedBy do payload (assinatura antiga) → 401, escrita continua negada', async () => {
    const tampered = tamperJwtPayload(impToken, (payload) => {
      delete payload.impersonatedBy;
    });

    const escrita = await request(server)
      .post('/api/v1/questoes')
      .set(auth(tampered))
      .send({})
      .expect(401);
    expectErrorEnvelope(escrita, 'UNAUTHENTICATED');

    const leitura = await request(server)
      .get('/api/v1/users/me')
      .set(auth(tampered))
      .expect(401);
    expectErrorEnvelope(leitura, 'UNAUTHENTICATED');

    await expect(prisma.registroQuestoes.count()).resolves.toBe(0);
  });

  it('trocar o impersonatedBy por outro admin (assinatura inválida) → 401', async () => {
    const tampered = tamperJwtPayload(impToken, (payload) => {
      payload.impersonatedBy = randomUUID();
    });
    const res = await request(server).get('/api/v1/users/me').set(auth(tampered)).expect(401);
    expectErrorEnvelope(res, 'UNAUTHENTICATED');
  });

  // -------------------------------------------------------------------------
  // Sem renovação: impersonação morre quando o access token expira
  // -------------------------------------------------------------------------

  it('POST /auth/refresh com o accessToken impersonado → 401 (não há como renovar)', async () => {
    const res = await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: impToken })
      .expect(401);
    expectErrorEnvelope(res, 'UNAUTHENTICATED');
  });
});
