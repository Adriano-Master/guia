import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
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
    `E2E de turmas exige banco guia_test (recebido: ${process.env.DATABASE_URL}). ` +
      'Nunca rode contra o banco de dev.',
  );
}

async function createApp(): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    // POST /matriculas tem rate limit (10/min por IP, contra enumeração de
    // códigos); esta suíte faz 15+ matrículas em segundos do mesmo IP e NÃO
    // testa o throttling em si, então o guard é neutralizado aqui — mesmo
    // espírito do override de EMAIL_SERVICE no e2e de auth. Cobertura do 429
    // exige suíte própria com app dedicado (padrão do e2e de auth).
    .overrideGuard(ThrottlerGuard)
    .useValue({ canActivate: () => true })
    .compile();
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
}

/** Ordem respeita FKs: sessões → cronogramas → progresso → turma_planos → matrículas → turmas → planos → users. */
async function cleanDatabase(prisma: PrismaService): Promise<void> {
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

// Alfabeto da decisão de design: ABCDEFGHJKMNPQRSTUVWXYZ23456789 (sem 0/O/1/I/L)
const CODIGO_REGEX = /^[A-HJ-KM-NP-Z2-9]{8}$/;

interface TurmaDto {
  id: string;
  nome: string;
  descricao: string | null;
  professorId: string;
  ativa: boolean;
  createdAt: string;
  updatedAt: string;
  codigoConvite?: string;
}

interface MatriculaDto {
  id: string;
  turmaId: string;
  alunoId: string;
  status: 'ATIVA' | 'INATIVA';
  aluno?: { id: string; nome: string; email: string };
  turma?: { id: string; nome: string; descricao: string | null; ativa: boolean };
}

interface TurmaPlanoDto {
  id: string;
  turmaId: string;
  planoId: string;
  plano?: { id: string; titulo: string; tipo: string; publicado: boolean };
}

interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

describe('Turmas (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: ReturnType<INestApplication['getHttpServer']>;

  const senha = 'senha-turmas-e2e';
  let prof1Token: string;
  let prof2Token: string;
  let adminToken: string;
  let moderadorToken: string;
  let aluno1Token: string;
  let aluno2Token: string;
  let aluno3Token: string;
  let aluno1Id: string;
  let aluno2Id: string;

  // Planos para vínculo
  let oficialAId: string; // OFICIAL publicado
  let oficialBId: string; // OFICIAL publicado (ciclo delete/re-vínculo)
  let rascunhoId: string; // OFICIAL não publicado
  let pessoalId: string; // PESSOAL do aluno1

  // Turmas
  let turmaAId: string;
  let codigoA: string;
  let turmaBId: string; // do prof2
  let turmaInativaId: string;
  let codigoInativa: string;
  let turmaDeleteId: string;
  let codigoDelete: string;

  let matriculaAluno1Id: string;
  let matriculaAluno2Id: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const matricular = (token: string, codigoConvite: string) =>
    request(server).post('/api/v1/matriculas').set(auth(token)).send({ codigoConvite });

  const contarMatriculas = (turmaId: string, alunoId: string) =>
    prisma.matricula.count({ where: { turmaId, alunoId } });

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    server = app.getHttpServer();
    await cleanDatabase(prisma);

    const senhaHash = await hashPassword(senha);
    // 7 usuários > limite de 5 logins/min do throttler de /auth/login: o login
    // real já é coberto pelo e2e de auth; aqui os access tokens são emitidos
    // pelo próprio TokenService da aplicação.
    const tokenService = app.get(TokenService);
    const criarUserComToken = async (
      nome: string,
      email: string,
      role: 'ADMIN' | 'MODERADOR' | 'PROFESSOR' | 'ALUNO',
    ): Promise<{ id: string; token: string }> => {
      const user = await prisma.user.create({
        data: { nome, email, senhaHash, role, status: 'ATIVO', origem: 'PROPRIO' },
      });
      return { id: user.id, token: await tokenService.signAccessToken(user) };
    };
    prof1Token = (await criarUserComToken('Professor Um', 'prof1.turmas@guia.test', 'PROFESSOR'))
      .token;
    prof2Token = (await criarUserComToken('Professor Dois', 'prof2.turmas@guia.test', 'PROFESSOR'))
      .token;
    adminToken = (await criarUserComToken('Admin Turmas', 'admin.turmas@guia.test', 'ADMIN')).token;
    moderadorToken = (
      await criarUserComToken('Moderador Turmas', 'moderador.turmas@guia.test', 'MODERADOR')
    ).token;
    const aluno1 = await criarUserComToken('Aluno Um', 'aluno1.turmas@guia.test', 'ALUNO');
    const aluno2 = await criarUserComToken('Aluno Dois', 'aluno2.turmas@guia.test', 'ALUNO');
    const aluno3 = await criarUserComToken('Aluno Três', 'aluno3.turmas@guia.test', 'ALUNO');
    aluno1Token = aluno1.token;
    aluno2Token = aluno2.token;
    aluno3Token = aluno3.token;
    aluno1Id = aluno1.id;
    aluno2Id = aluno2.id;
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  // -------------------------------------------------------------------------
  // Setup dos planos (OFICIAL publicado ×2, rascunho, PESSOAL)
  // -------------------------------------------------------------------------

  it('setup: planos OFICIAIS publicados, rascunho e PESSOAL', async () => {
    const criarPlanoPublicado = async (titulo: string): Promise<string> => {
      const plano = await request(server)
        .post('/api/v1/planos')
        .set(auth(prof1Token))
        .send({ titulo, tipo: 'OFICIAL' })
        .expect(201);
      const planoId = plano.body.plano.id as string;

      const disciplina = await request(server)
        .post(`/api/v1/planos/${planoId}/disciplinas`)
        .set(auth(prof1Token))
        .send({ nome: 'Português', ordem: 1 })
        .expect(201);
      const disciplinaId = disciplina.body.disciplina.id as string;
      const tema = await request(server)
        .post(`/api/v1/disciplinas/${disciplinaId}/temas`)
        .set(auth(prof1Token))
        .send({ nome: 'Crase', ordem: 1 })
        .expect(201);
      await request(server)
        .post(`/api/v1/temas/${tema.body.tema.id as string}/subtemas`)
        .set(auth(prof1Token))
        .send({ nome: 'Regra geral', ordem: 1 })
        .expect(201);
      await request(server)
        .put(`/api/v1/planos/${planoId}/pesos`)
        .set(auth(prof1Token))
        .send({ pesos: [{ disciplinaId, pesoPercentual: 100 }] })
        .expect(200);
      await request(server)
        .post(`/api/v1/planos/${planoId}/publicar`)
        .set(auth(prof1Token))
        .expect(200);
      return planoId;
    };

    oficialAId = await criarPlanoPublicado('Oficial A Turmas');
    oficialBId = await criarPlanoPublicado('Oficial B Turmas');

    const rascunho = await request(server)
      .post('/api/v1/planos')
      .set(auth(prof1Token))
      .send({ titulo: 'Rascunho Turmas', tipo: 'OFICIAL' })
      .expect(201);
    rascunhoId = rascunho.body.plano.id as string;

    const pessoal = await request(server)
      .post('/api/v1/planos')
      .set(auth(aluno1Token))
      .send({ titulo: 'Pessoal do Aluno1', tipo: 'PESSOAL' })
      .expect(201);
    pessoalId = pessoal.body.plano.id as string;
  });

  // -------------------------------------------------------------------------
  // POST /turmas — criação, roles e código de convite
  // -------------------------------------------------------------------------

  it('ALUNO em POST /turmas → 403 FORBIDDEN; sem token → 401', async () => {
    const forbidden = await request(server)
      .post('/api/v1/turmas')
      .set(auth(aluno1Token))
      .send({ nome: 'Turma do aluno' })
      .expect(403);
    expectErrorEnvelope(forbidden, 'FORBIDDEN');

    const unauth = await request(server)
      .post('/api/v1/turmas')
      .send({ nome: 'Sem token' })
      .expect(401);
    expectErrorEnvelope(unauth, 'UNAUTHENTICATED');
    expect(await prisma.turma.count()).toBe(0);
  });

  it('professor cria turma → 201 com codigoConvite no formato do alfabeto e ativa=true', async () => {
    const res = await request(server)
      .post('/api/v1/turmas')
      .set(auth(prof1Token))
      .send({ nome: 'Turma A', descricao: 'Turma principal' })
      .expect(201);

    const turma = res.body.turma as TurmaDto;
    expect(turma).toMatchObject({
      nome: 'Turma A',
      descricao: 'Turma principal',
      ativa: true,
    });
    expect(turma.codigoConvite).toMatch(CODIGO_REGEX);
    expect(turma.codigoConvite).not.toMatch(/[0O1IL]/);
    turmaAId = turma.id;
    codigoA = turma.codigoConvite!;

    // Demais turmas do cenário
    const b = await request(server)
      .post('/api/v1/turmas')
      .set(auth(prof2Token))
      .send({ nome: 'Turma B do Prof2' })
      .expect(201);
    turmaBId = b.body.turma.id as string;

    const inativa = await request(server)
      .post('/api/v1/turmas')
      .set(auth(prof1Token))
      .send({ nome: 'Turma Inativa' })
      .expect(201);
    turmaInativaId = inativa.body.turma.id as string;
    codigoInativa = inativa.body.turma.codigoConvite as string;

    const del = await request(server)
      .post('/api/v1/turmas')
      .set(auth(prof1Token))
      .send({ nome: 'Turma Delete' })
      .expect(201);
    turmaDeleteId = del.body.turma.id as string;
    codigoDelete = del.body.turma.codigoConvite as string;
  });

  it('PATCH /turmas/:id: dono desativa (ativa=false); professor não-dono → 403; body inválido → 422', async () => {
    const res = await request(server)
      .patch(`/api/v1/turmas/${turmaInativaId}`)
      .set(auth(prof1Token))
      .send({ ativa: false })
      .expect(200);
    expect(res.body.turma.ativa).toBe(false);

    const cruzado = await request(server)
      .patch(`/api/v1/turmas/${turmaAId}`)
      .set(auth(prof2Token))
      .send({ nome: 'Invasão' })
      .expect(403);
    expectErrorEnvelope(cruzado, 'FORBIDDEN');

    const invalido = await request(server)
      .patch(`/api/v1/turmas/${turmaAId}`)
      .set(auth(prof1Token))
      .send({ ativa: 'talvez' })
      .expect(422);
    expectErrorEnvelope(invalido, 'VALIDATION_ERROR');
  });

  // -------------------------------------------------------------------------
  // GET /turmas — escopo e filtro ?ativa=
  // -------------------------------------------------------------------------

  it('GET /turmas: PROFESSOR vê só as suas; ADMIN/MODERADOR todas; ALUNO → 403; envelope paginado', async () => {
    const prof1 = await request(server).get('/api/v1/turmas').set(auth(prof1Token)).expect(200);
    const body1 = prof1.body as Paginated<TurmaDto>;
    expect(body1).toMatchObject({ page: 1, pageSize: 20, total: 3 });
    expect(body1.data.map((t) => t.nome).sort()).toEqual([
      'Turma A',
      'Turma Delete',
      'Turma Inativa',
    ]);
    for (const t of body1.data) {
      expect(t.codigoConvite).toMatch(CODIGO_REGEX); // rota interna: dono vê o código
    }

    const prof2 = await request(server).get('/api/v1/turmas').set(auth(prof2Token)).expect(200);
    expect((prof2.body as Paginated<TurmaDto>).total).toBe(1);
    expect((prof2.body as Paginated<TurmaDto>).data[0].nome).toBe('Turma B do Prof2');

    for (const token of [adminToken, moderadorToken]) {
      const res = await request(server).get('/api/v1/turmas').set(auth(token)).expect(200);
      expect((res.body as Paginated<TurmaDto>).total).toBe(4);
    }

    const aluno = await request(server).get('/api/v1/turmas').set(auth(aluno1Token)).expect(403);
    expectErrorEnvelope(aluno, 'FORBIDDEN');
  });

  it('REGRESSÃO coerção: ?ativa=false lista SÓ inativas; ?ativa=true só ativas; ?ativa=xyz → 422', async () => {
    const inativas = await request(server)
      .get('/api/v1/turmas?ativa=false')
      .set(auth(prof1Token))
      .expect(200);
    expect((inativas.body as Paginated<TurmaDto>).data.map((t) => t.nome)).toEqual([
      'Turma Inativa',
    ]);
    expect((inativas.body as Paginated<TurmaDto>).total).toBe(1);

    const ativas = await request(server)
      .get('/api/v1/turmas?ativa=true')
      .set(auth(prof1Token))
      .expect(200);
    expect((ativas.body as Paginated<TurmaDto>).data.map((t) => t.nome).sort()).toEqual([
      'Turma A',
      'Turma Delete',
    ]);

    const invalido = await request(server)
      .get('/api/v1/turmas?ativa=xyz')
      .set(auth(prof1Token))
      .expect(422);
    expectErrorEnvelope(invalido, 'VALIDATION_ERROR');
  });

  it('GET /turmas/:id: não-dono → 403; ADMIN/MODERADOR → 200 com código; inexistente → 404; malformado → 422', async () => {
    const cruzado = await request(server)
      .get(`/api/v1/turmas/${turmaAId}`)
      .set(auth(prof2Token))
      .expect(403);
    expectErrorEnvelope(cruzado, 'FORBIDDEN');

    for (const token of [adminToken, moderadorToken]) {
      const res = await request(server)
        .get(`/api/v1/turmas/${turmaAId}`)
        .set(auth(token))
        .expect(200);
      expect((res.body.turma as TurmaDto).codigoConvite).toBe(codigoA);
    }

    const semMatricula = await request(server)
      .get(`/api/v1/turmas/${turmaAId}`)
      .set(auth(aluno1Token))
      .expect(403);
    expectErrorEnvelope(semMatricula, 'FORBIDDEN');

    const inexistente = await request(server)
      .get(`/api/v1/turmas/${randomUUID()}`)
      .set(auth(prof1Token))
      .expect(404);
    expectErrorEnvelope(inexistente, 'NOT_FOUND');

    const malformado = await request(server)
      .get('/api/v1/turmas/nao-e-uuid')
      .set(auth(prof1Token))
      .expect(422);
    expectErrorEnvelope(malformado, 'VALIDATION_ERROR');
  });

  // -------------------------------------------------------------------------
  // POST /matriculas — roles, normalização, duplicidade e corrida
  // -------------------------------------------------------------------------

  it('usuário interno em POST /matriculas → 403 (RN-04)', async () => {
    for (const token of [prof1Token, adminToken, moderadorToken]) {
      const res = await matricular(token, codigoA).expect(403);
      expectErrorEnvelope(res, 'FORBIDDEN');
    }
    expect(await prisma.matricula.count()).toBe(0);
  });

  it('aluno matricula com código em minúsculas e espaços → 201 ATIVA (normalização do DTO)', async () => {
    const res = await matricular(aluno1Token, `  ${codigoA.toLowerCase()}  `).expect(201);

    const matricula = res.body.matricula as MatriculaDto;
    expect(matricula).toMatchObject({
      turmaId: turmaAId,
      alunoId: aluno1Id,
      status: 'ATIVA',
      turma: { id: turmaAId, nome: 'Turma A', ativa: true },
    });
    matriculaAluno1Id = matricula.id;
    expect(await contarMatriculas(turmaAId, aluno1Id)).toBe(1);
  });

  it('matricular de novo já ATIVA → 409 CONFLICT, continua 1 linha', async () => {
    const res = await matricular(aluno1Token, codigoA).expect(409);
    expectErrorEnvelope(res, 'CONFLICT');
    expect(await contarMatriculas(turmaAId, aluno1Id)).toBe(1);
  });

  it('corrida: 2 POSTs simultâneos do mesmo aluno → um 201 e um 409, UMA linha (unique)', async () => {
    const [a, b] = await Promise.all([
      matricular(aluno2Token, codigoA),
      matricular(aluno2Token, codigoA),
    ]);

    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const vencedora = a.status === 201 ? a : b;
    matriculaAluno2Id = (vencedora.body.matricula as MatriculaDto).id;
    expect(await contarMatriculas(turmaAId, aluno2Id)).toBe(1);
  });

  it('código inválido → 404; turma ativa=false → 409; codigoConvite vazio → 422', async () => {
    const naoExiste = await matricular(aluno3Token, 'ZZZZZZZ9').expect(404);
    expectErrorEnvelope(naoExiste, 'NOT_FOUND');

    const inativa = await matricular(aluno3Token, codigoInativa).expect(409);
    expectErrorEnvelope(inativa, 'CONFLICT');

    const vazio = await matricular(aluno3Token, '   ').expect(422);
    expectErrorEnvelope(vazio, 'VALIDATION_ERROR');

    expect(await prisma.matricula.count({ where: { turmaId: turmaInativaId } })).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Leitura da turma pelo aluno matriculado (sem codigoConvite)
  // -------------------------------------------------------------------------

  it('aluno matriculado ATIVO lê a turma SEM a chave codigoConvite no JSON', async () => {
    const res = await request(server)
      .get(`/api/v1/turmas/${turmaAId}`)
      .set(auth(aluno1Token))
      .expect(200);

    const turma = res.body.turma as TurmaDto;
    expect(turma).toMatchObject({ id: turmaAId, nome: 'Turma A', ativa: true });
    expect(turma).not.toHaveProperty('codigoConvite'); // chave AUSENTE

    const semMatricula = await request(server)
      .get(`/api/v1/turmas/${turmaAId}`)
      .set(auth(aluno3Token))
      .expect(403);
    expectErrorEnvelope(semMatricula, 'FORBIDDEN');
  });

  // -------------------------------------------------------------------------
  // GET /turmas/:id/matriculas e GET /matriculas/me
  // -------------------------------------------------------------------------

  it('GET /turmas/:id/matriculas: dono vê alunos com {id,nome,email}; não-dono → 403; ALUNO → 403', async () => {
    const cruzado = await request(server)
      .get(`/api/v1/turmas/${turmaAId}/matriculas`)
      .set(auth(prof2Token))
      .expect(403);
    expectErrorEnvelope(cruzado, 'FORBIDDEN');

    const aluno = await request(server)
      .get(`/api/v1/turmas/${turmaAId}/matriculas`)
      .set(auth(aluno1Token))
      .expect(403);
    expectErrorEnvelope(aluno, 'FORBIDDEN');

    const res = await request(server)
      .get(`/api/v1/turmas/${turmaAId}/matriculas`)
      .set(auth(prof1Token))
      .expect(200);
    const body = res.body as Paginated<MatriculaDto>;
    expect(body).toMatchObject({ page: 1, pageSize: 20, total: 2 });
    const doAluno1 = body.data.find((m) => m.alunoId === aluno1Id)!;
    expect(doAluno1.aluno).toEqual({
      id: aluno1Id,
      nome: 'Aluno Um',
      email: 'aluno1.turmas@guia.test',
    });

    for (const token of [adminToken, moderadorToken]) {
      await request(server)
        .get(`/api/v1/turmas/${turmaAId}/matriculas`)
        .set(auth(token))
        .expect(200);
    }
  });

  it('GET /matriculas/me: aluno vê suas matrículas com resumo da turma; interno → 403', async () => {
    const res = await request(server)
      .get('/api/v1/matriculas/me')
      .set(auth(aluno1Token))
      .expect(200);
    const body = res.body as Paginated<MatriculaDto>;
    expect(body).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    expect(body.data[0]).toMatchObject({
      alunoId: aluno1Id,
      status: 'ATIVA',
      turma: { id: turmaAId, nome: 'Turma A', ativa: true },
    });

    const interno = await request(server)
      .get('/api/v1/matriculas/me')
      .set(auth(prof1Token))
      .expect(403);
    expectErrorEnvelope(interno, 'FORBIDDEN');
  });

  // -------------------------------------------------------------------------
  // PATCH /matriculas/:id — escopos e efeito no acesso do aluno
  // -------------------------------------------------------------------------

  it('PATCH /matriculas/:id: OUTRO aluno → 403; professor de outra turma → 403', async () => {
    const outroAluno = await request(server)
      .patch(`/api/v1/matriculas/${matriculaAluno1Id}`)
      .set(auth(aluno2Token))
      .send({ status: 'INATIVA' })
      .expect(403);
    expectErrorEnvelope(outroAluno, 'FORBIDDEN');

    const outroProf = await request(server)
      .patch(`/api/v1/matriculas/${matriculaAluno1Id}`)
      .set(auth(prof2Token))
      .send({ status: 'INATIVA' })
      .expect(403);
    expectErrorEnvelope(outroProf, 'FORBIDDEN');

    const inexistente = await request(server)
      .patch(`/api/v1/matriculas/${randomUUID()}`)
      .set(auth(aluno1Token))
      .send({ status: 'INATIVA' })
      .expect(404);
    expectErrorEnvelope(inexistente, 'NOT_FOUND');
  });

  it('o PRÓPRIO aluno se inativa → 200; matrícula INATIVA NÃO basta para ler a turma/planos (403)', async () => {
    const res = await request(server)
      .patch(`/api/v1/matriculas/${matriculaAluno1Id}`)
      .set(auth(aluno1Token))
      .send({ status: 'INATIVA' })
      .expect(200);
    expect(res.body.matricula.status).toBe('INATIVA');

    const turma = await request(server)
      .get(`/api/v1/turmas/${turmaAId}`)
      .set(auth(aluno1Token))
      .expect(403);
    expectErrorEnvelope(turma, 'FORBIDDEN');

    const planos = await request(server)
      .get(`/api/v1/turmas/${turmaAId}/planos`)
      .set(auth(aluno1Token))
      .expect(403);
    expectErrorEnvelope(planos, 'FORBIDDEN');
  });

  it('filtro ?status= nas matrículas da turma e em /matriculas/me', async () => {
    const inativas = await request(server)
      .get(`/api/v1/turmas/${turmaAId}/matriculas?status=INATIVA`)
      .set(auth(prof1Token))
      .expect(200);
    expect((inativas.body as Paginated<MatriculaDto>).data.map((m) => m.alunoId)).toEqual([
      aluno1Id,
    ]);

    const ativas = await request(server)
      .get(`/api/v1/turmas/${turmaAId}/matriculas?status=ATIVA`)
      .set(auth(prof1Token))
      .expect(200);
    expect((ativas.body as Paginated<MatriculaDto>).data.map((m) => m.alunoId)).toEqual([
      aluno2Id,
    ]);

    const me = await request(server)
      .get('/api/v1/matriculas/me?status=INATIVA')
      .set(auth(aluno1Token))
      .expect(200);
    expect((me.body as Paginated<MatriculaDto>).total).toBe(1);
    expect((me.body as Paginated<MatriculaDto>).data[0].status).toBe('INATIVA');

    const invalido = await request(server)
      .get(`/api/v1/turmas/${turmaAId}/matriculas?status=QUALQUER`)
      .set(auth(prof1Token))
      .expect(422);
    expectErrorEnvelope(invalido, 'VALIDATION_ERROR');
  });

  it('REGRESSÃO review: aluno NÃO se readmite via PATCH {ATIVA} → 403 orientando POST /matriculas; matrícula segue INATIVA', async () => {
    // PATCH {ATIVA} pelo próprio aluno contornaria regenerar código e turma
    // inativa (RN-02/RN-05); a rematrícula legítima é só via código.
    const res = await request(server)
      .patch(`/api/v1/matriculas/${matriculaAluno1Id}`)
      .set(auth(aluno1Token))
      .send({ status: 'ATIVA' })
      .expect(403);
    expectErrorEnvelope(res, 'FORBIDDEN');
    expect(res.body.error.message).toContain('POST /matriculas');

    // Nada mudou no banco: continua INATIVA
    const linha = await prisma.matricula.findUnique({ where: { id: matriculaAluno1Id } });
    expect(linha).toMatchObject({ status: 'INATIVA', deletedAt: null });

    // O caminho CORRETO de readmissão pelo aluno funciona: POST com o código
    // vigente → 200 (reativação da MESMA linha)
    const rematricula = await matricular(aluno1Token, codigoA).expect(200);
    expect(rematricula.body.matricula).toMatchObject({
      id: matriculaAluno1Id,
      status: 'ATIVA',
    });
    expect(await contarMatriculas(turmaAId, aluno1Id)).toBe(1);

    // Volta a INATIVA para o teste seguinte exercer a readmissão pelo dono
    await request(server)
      .patch(`/api/v1/matriculas/${matriculaAluno1Id}`)
      .set(auth(aluno1Token))
      .send({ status: 'INATIVA' })
      .expect(200);
  });

  it('professor dono READMITE o aluno (ATIVA) → 200 e o acesso do aluno volta', async () => {
    const res = await request(server)
      .patch(`/api/v1/matriculas/${matriculaAluno1Id}`)
      .set(auth(prof1Token))
      .send({ status: 'ATIVA' })
      .expect(200);
    expect(res.body.matricula.status).toBe('ATIVA');

    await request(server).get(`/api/v1/turmas/${turmaAId}`).set(auth(aluno1Token)).expect(200);
  });

  // -------------------------------------------------------------------------
  // Reativação por código — INATIVA e soft-deleted → 200 (não 201)
  // -------------------------------------------------------------------------

  it('reenviar código com matrícula INATIVA → 200 (reativação, não duplicação) com status ATIVA', async () => {
    await request(server)
      .patch(`/api/v1/matriculas/${matriculaAluno1Id}`)
      .set(auth(aluno1Token))
      .send({ status: 'INATIVA' })
      .expect(200);

    const res = await matricular(aluno1Token, codigoA).expect(200); // 200, NÃO 201
    const matricula = res.body.matricula as MatriculaDto;
    expect(matricula).toMatchObject({ id: matriculaAluno1Id, status: 'ATIVA' });
    expect(await contarMatriculas(turmaAId, aluno1Id)).toBe(1);
  });

  it('matrícula SOFT-DELETED é reativada → 200 ATIVA com deletedAt=null, mesma linha', async () => {
    await prisma.matricula.update({
      where: { id: matriculaAluno1Id },
      data: { deletedAt: new Date(), status: 'INATIVA' },
    });

    const res = await matricular(aluno1Token, codigoA).expect(200);
    expect(res.body.matricula).toMatchObject({ id: matriculaAluno1Id, status: 'ATIVA' });

    expect(await contarMatriculas(turmaAId, aluno1Id)).toBe(1);
    const linha = await prisma.matricula.findUnique({ where: { id: matriculaAluno1Id } });
    expect(linha).toMatchObject({ status: 'ATIVA', deletedAt: null });
  });

  // -------------------------------------------------------------------------
  // Regenerar código — RN-02
  // -------------------------------------------------------------------------

  it('regenerar código: não-dono → 403; dono → 200 com código NOVO; antigo passa a dar 404; matrículas intactas', async () => {
    const cruzado = await request(server)
      .post(`/api/v1/turmas/${turmaAId}/regenerar-codigo`)
      .set(auth(prof2Token))
      .expect(403);
    expectErrorEnvelope(cruzado, 'FORBIDDEN');

    const res = await request(server)
      .post(`/api/v1/turmas/${turmaAId}/regenerar-codigo`)
      .set(auth(prof1Token))
      .expect(200);
    const novoCodigo = res.body.codigoConvite as string;
    expect(novoCodigo).toMatch(CODIGO_REGEX);
    expect(novoCodigo).not.toBe(codigoA);

    // Código antigo morreu (RN-02)
    const antigo = await matricular(aluno3Token, codigoA).expect(404);
    expectErrorEnvelope(antigo, 'NOT_FOUND');

    // Código novo funciona
    await matricular(aluno3Token, novoCodigo).expect(201);

    // Matrículas existentes permanecem: aluno1 continua lendo a turma
    await request(server).get(`/api/v1/turmas/${turmaAId}`).set(auth(aluno1Token)).expect(200);

    codigoA = novoCodigo;

    // ADMIN ignora checagem de dono e regenera turma de outro professor
    const daModeracao = await request(server)
      .post(`/api/v1/turmas/${turmaBId}/regenerar-codigo`)
      .set(auth(adminToken))
      .expect(200);
    expect(daModeracao.body.codigoConvite).toMatch(CODIGO_REGEX);
  });

  // -------------------------------------------------------------------------
  // TurmaPlano — vincular (RN-06), listar (RN-07), desvincular (hard delete)
  // -------------------------------------------------------------------------

  it('vincular: não-dono → 403; ALUNO → 403; PESSOAL → 422; OFICIAL não publicado → 422 com details', async () => {
    const cruzado = await request(server)
      .post(`/api/v1/turmas/${turmaAId}/planos`)
      .set(auth(prof2Token))
      .send({ planoId: oficialAId })
      .expect(403);
    expectErrorEnvelope(cruzado, 'FORBIDDEN');

    const aluno = await request(server)
      .post(`/api/v1/turmas/${turmaAId}/planos`)
      .set(auth(aluno1Token))
      .send({ planoId: oficialAId })
      .expect(403);
    expectErrorEnvelope(aluno, 'FORBIDDEN');

    const pessoal = await request(server)
      .post(`/api/v1/turmas/${turmaAId}/planos`)
      .set(auth(prof1Token))
      .send({ planoId: pessoalId })
      .expect(422);
    expectErrorEnvelope(pessoal, 'VALIDATION_ERROR');
    expect(pessoal.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'planoId', issue: expect.stringContaining('OFICIAL') }),
      ]),
    );

    const rascunho = await request(server)
      .post(`/api/v1/turmas/${turmaAId}/planos`)
      .set(auth(prof1Token))
      .send({ planoId: rascunhoId })
      .expect(422);
    expectErrorEnvelope(rascunho, 'VALIDATION_ERROR');
    expect(rascunho.body.error.details).toEqual([
      expect.objectContaining({ field: 'planoId', issue: expect.stringContaining('publicado') }),
    ]);

    const inexistente = await request(server)
      .post(`/api/v1/turmas/${turmaAId}/planos`)
      .set(auth(prof1Token))
      .send({ planoId: randomUUID() })
      .expect(404);
    expectErrorEnvelope(inexistente, 'NOT_FOUND');

    const malformado = await request(server)
      .post(`/api/v1/turmas/${turmaAId}/planos`)
      .set(auth(prof1Token))
      .send({ planoId: 'nao-e-uuid' })
      .expect(422);
    expectErrorEnvelope(malformado, 'VALIDATION_ERROR');

    expect(await prisma.turmaPlano.count()).toBe(0);
  });

  it('vincular OFICIAL publicado → 201 com plano {id,titulo,tipo,publicado}; duplicado → 409', async () => {
    const res = await request(server)
      .post(`/api/v1/turmas/${turmaAId}/planos`)
      .set(auth(prof1Token))
      .send({ planoId: oficialAId })
      .expect(201);

    expect(res.body.turmaPlano as TurmaPlanoDto).toMatchObject({
      turmaId: turmaAId,
      planoId: oficialAId,
      plano: { id: oficialAId, titulo: 'Oficial A Turmas', tipo: 'OFICIAL', publicado: true },
    });

    const duplicado = await request(server)
      .post(`/api/v1/turmas/${turmaAId}/planos`)
      .set(auth(prof1Token))
      .send({ planoId: oficialAId })
      .expect(409);
    expectErrorEnvelope(duplicado, 'CONFLICT');
    expect(await prisma.turmaPlano.count({ where: { turmaId: turmaAId } })).toBe(1);
  });

  it('GET /turmas/:id/planos: dono e aluno ATIVO listam; aluno INATIVO → 403; envelope paginado', async () => {
    const doDono = await request(server)
      .get(`/api/v1/turmas/${turmaAId}/planos`)
      .set(auth(prof1Token))
      .expect(200);
    const body = doDono.body as Paginated<TurmaPlanoDto>;
    expect(body).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    expect(body.data[0].plano).toMatchObject({ titulo: 'Oficial A Turmas', publicado: true });

    const doAluno = await request(server)
      .get(`/api/v1/turmas/${turmaAId}/planos`)
      .set(auth(aluno1Token))
      .expect(200);
    expect((doAluno.body as Paginated<TurmaPlanoDto>).total).toBe(1);

    // aluno3 sai da turma; matrícula INATIVA não basta (RN-07)
    const me = await request(server)
      .get('/api/v1/matriculas/me')
      .set(auth(aluno3Token))
      .expect(200);
    const matriculaAluno3Id = (me.body as Paginated<MatriculaDto>).data[0].id;
    await request(server)
      .patch(`/api/v1/matriculas/${matriculaAluno3Id}`)
      .set(auth(aluno3Token))
      .send({ status: 'INATIVA' })
      .expect(200);

    const inativo = await request(server)
      .get(`/api/v1/turmas/${turmaAId}/planos`)
      .set(auth(aluno3Token))
      .expect(403);
    expectErrorEnvelope(inativo, 'FORBIDDEN');

    const naoDonoInterno = await request(server)
      .get(`/api/v1/turmas/${turmaAId}/planos`)
      .set(auth(prof2Token))
      .expect(403);
    expectErrorEnvelope(naoDonoInterno, 'FORBIDDEN');
  });

  it('plano SOFT-DELETED após o vínculo sai da listagem (e volta ao restaurar)', async () => {
    await request(server)
      .post(`/api/v1/turmas/${turmaAId}/planos`)
      .set(auth(prof1Token))
      .send({ planoId: oficialBId })
      .expect(201);

    await prisma.plano.update({ where: { id: oficialBId }, data: { deletedAt: new Date() } });
    try {
      const res = await request(server)
        .get(`/api/v1/turmas/${turmaAId}/planos`)
        .set(auth(prof1Token))
        .expect(200);
      const body = res.body as Paginated<TurmaPlanoDto>;
      expect(body.total).toBe(1);
      expect(body.data.map((tp) => tp.planoId)).toEqual([oficialAId]);
    } finally {
      await prisma.plano.update({ where: { id: oficialBId }, data: { deletedAt: null } });
    }

    const restaurado = await request(server)
      .get(`/api/v1/turmas/${turmaAId}/planos`)
      .set(auth(prof1Token))
      .expect(200);
    expect((restaurado.body as Paginated<TurmaPlanoDto>).total).toBe(2);
  });

  it('DELETE plano: não-dono → 403; dono → 204 (hard delete); repetido → 404; re-vínculo → 201', async () => {
    const cruzado = await request(server)
      .delete(`/api/v1/turmas/${turmaAId}/planos/${oficialBId}`)
      .set(auth(prof2Token))
      .expect(403);
    expectErrorEnvelope(cruzado, 'FORBIDDEN');

    await request(server)
      .delete(`/api/v1/turmas/${turmaAId}/planos/${oficialBId}`)
      .set(auth(prof1Token))
      .expect(204);
    // Hard delete: linha some do banco (não soft delete)
    expect(
      await prisma.turmaPlano.count({ where: { turmaId: turmaAId, planoId: oficialBId } }),
    ).toBe(0);

    const repetido = await request(server)
      .delete(`/api/v1/turmas/${turmaAId}/planos/${oficialBId}`)
      .set(auth(prof1Token))
      .expect(404);
    expectErrorEnvelope(repetido, 'NOT_FOUND');

    // Re-vínculo funciona: o hard delete liberou o unique (turma_id, plano_id)
    await request(server)
      .post(`/api/v1/turmas/${turmaAId}/planos`)
      .set(auth(prof1Token))
      .send({ planoId: oficialBId })
      .expect(201);
    await request(server)
      .delete(`/api/v1/turmas/${turmaAId}/planos/${oficialBId}`)
      .set(auth(prof1Token))
      .expect(204);
  });

  it('REGRESSÃO review: plano DESPUBLICADO após o vínculo some para o aluno; gestor segue vendo; republicado volta', async () => {
    // Estado: só oficialA vinculado à turma A; aluno1 com matrícula ATIVA
    await prisma.plano.update({ where: { id: oficialAId }, data: { publicado: false } });
    try {
      // Aluno não vê o plano despublicado (o GET do plano daria 403)
      const doAluno = await request(server)
        .get(`/api/v1/turmas/${turmaAId}/planos`)
        .set(auth(aluno1Token))
        .expect(200);
      expect((doAluno.body as Paginated<TurmaPlanoDto>).total).toBe(0);
      expect((doAluno.body as Paginated<TurmaPlanoDto>).data).toEqual([]);

      // Dono e moderação seguem vendo (para poder desvincular)
      for (const token of [prof1Token, adminToken]) {
        const doGestor = await request(server)
          .get(`/api/v1/turmas/${turmaAId}/planos`)
          .set(auth(token))
          .expect(200);
        const body = doGestor.body as Paginated<TurmaPlanoDto>;
        expect(body.total).toBe(1);
        expect(body.data[0].plano).toMatchObject({ id: oficialAId, publicado: false });
      }
    } finally {
      await prisma.plano.update({ where: { id: oficialAId }, data: { publicado: true } });
    }

    // Republicado: aluno volta a ver
    const republicado = await request(server)
      .get(`/api/v1/turmas/${turmaAId}/planos`)
      .set(auth(aluno1Token))
      .expect(200);
    expect((republicado.body as Paginated<TurmaPlanoDto>).total).toBe(1);
    expect((republicado.body as Paginated<TurmaPlanoDto>).data[0].planoId).toBe(oficialAId);
  });

  // -------------------------------------------------------------------------
  // Fluxo completo da tasks.md
  // -------------------------------------------------------------------------

  it('fluxo completo: professor cria turma → aluno matricula por código → professor lista alunos → vincula plano → aluno lista planos', async () => {
    const criada = await request(server)
      .post('/api/v1/turmas')
      .set(auth(prof1Token))
      .send({ nome: 'Turma Fluxo' })
      .expect(201);
    const turmaId = criada.body.turma.id as string;
    const codigo = criada.body.turma.codigoConvite as string;

    const matriculado = await matricular(aluno2Token, codigo).expect(201);
    expect(matriculado.body.matricula.status).toBe('ATIVA');

    const alunos = await request(server)
      .get(`/api/v1/turmas/${turmaId}/matriculas`)
      .set(auth(prof1Token))
      .expect(200);
    expect((alunos.body as Paginated<MatriculaDto>).data.map((m) => m.aluno?.email)).toEqual([
      'aluno2.turmas@guia.test',
    ]);

    await request(server)
      .post(`/api/v1/turmas/${turmaId}/planos`)
      .set(auth(prof1Token))
      .send({ planoId: oficialAId })
      .expect(201);

    const planos = await request(server)
      .get(`/api/v1/turmas/${turmaId}/planos`)
      .set(auth(aluno2Token))
      .expect(200);
    expect((planos.body as Paginated<TurmaPlanoDto>).data.map((tp) => tp.plano?.titulo)).toEqual([
      'Oficial A Turmas',
    ]);
  });

  // -------------------------------------------------------------------------
  // Soft delete de turma — RN-08
  // -------------------------------------------------------------------------

  it('soft delete: não-dono → 403; dono → 204; GET → 404; matrícula pelo código → 404; some da listagem', async () => {
    // aluno2 se matricula ANTES do delete (para testar PATCH pós-delete)
    const matriculaPreDelete = await matricular(aluno2Token, codigoDelete).expect(201);
    const matriculaDeleteId = (matriculaPreDelete.body.matricula as MatriculaDto).id;

    const cruzado = await request(server)
      .delete(`/api/v1/turmas/${turmaDeleteId}`)
      .set(auth(prof2Token))
      .expect(403);
    expectErrorEnvelope(cruzado, 'FORBIDDEN');

    await request(server)
      .delete(`/api/v1/turmas/${turmaDeleteId}`)
      .set(auth(prof1Token))
      .expect(204);

    // Soft delete de verdade: linha continua no banco com deletedAt
    const linha = await prisma.turma.findUnique({ where: { id: turmaDeleteId } });
    expect(linha!.deletedAt).not.toBeNull();

    const get = await request(server)
      .get(`/api/v1/turmas/${turmaDeleteId}`)
      .set(auth(prof1Token))
      .expect(404);
    expectErrorEnvelope(get, 'NOT_FOUND');

    const codigoMorto = await matricular(aluno3Token, codigoDelete).expect(404);
    expectErrorEnvelope(codigoMorto, 'NOT_FOUND');

    const lista = await request(server).get('/api/v1/turmas').set(auth(prof1Token)).expect(200);
    expect((lista.body as Paginated<TurmaDto>).data.map((t) => t.id)).not.toContain(
      turmaDeleteId,
    );

    const matriculasNested = await request(server)
      .get(`/api/v1/turmas/${turmaDeleteId}/matriculas`)
      .set(auth(prof1Token))
      .expect(404);
    expectErrorEnvelope(matriculasNested, 'NOT_FOUND');

    const planosNested = await request(server)
      .get(`/api/v1/turmas/${turmaDeleteId}/planos`)
      .set(auth(prof1Token))
      .expect(404);
    expectErrorEnvelope(planosNested, 'NOT_FOUND');

    // PATCH em matrícula de turma soft-deleted → 404, mesmo para o dono/aluno
    for (const token of [prof1Token, aluno2Token]) {
      const patch = await request(server)
        .patch(`/api/v1/matriculas/${matriculaDeleteId}`)
        .set(auth(token))
        .send({ status: 'INATIVA' })
        .expect(404);
      expectErrorEnvelope(patch, 'NOT_FOUND');
    }

    // /matriculas/me não lista matrícula de turma soft-deleted
    const me = await request(server)
      .get('/api/v1/matriculas/me')
      .set(auth(aluno2Token))
      .expect(200);
    const turmasDoAluno2 = (me.body as Paginated<MatriculaDto>).data.map((m) => m.turma?.id);
    expect(turmasDoAluno2).not.toContain(turmaDeleteId);
  });
});
