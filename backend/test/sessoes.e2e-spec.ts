import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request, { Response } from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { createGlobalValidationPipe } from '../src/common/pipes/validation.pipe';
import { hashPassword } from '../src/common/security/password';
import { PrismaService } from '../src/prisma/prisma.service';
import { vincularPlanoAAlunos } from './helpers/vincular-plano-aluno';

// Banco DEDICADO de teste (guia_test) — nunca o banco de dev `guia`.
if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('localhost:5432/test')) {
  process.env.DATABASE_URL =
    'postgresql://guia:160402dbbba472cb61848717@localhost:5433/guia_test?schema=public';
}
if (!/guia_test/.test(process.env.DATABASE_URL)) {
  throw new Error(
    `E2E de sessões exige banco guia_test (recebido: ${process.env.DATABASE_URL}). ` +
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
}

/** Ordem respeita FKs: sessões → blocos/cronogramas → progresso → planos → users. */
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

interface SessaoDto {
  id: string;
  alunoId: string;
  disciplinaId: string;
  subtemaId: string | null;
  blocoId: string | null;
  origem: 'CRONOMETRO' | 'MANUAL';
  inicio: string;
  fim: string | null;
  duracaoMin: number;
  estado: 'RUNNING' | 'PAUSED' | 'STOPPED';
}

interface BlocoDto {
  id: string;
  disciplinaId: string;
}

function isoDate(msFromNow: number): string {
  return new Date(Date.now() + msFromNow).toISOString().slice(0, 10);
}

const DIA_MS = 86_400_000;

describe('Cronômetro e Sessões (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: ReturnType<INestApplication['getHttpServer']>;

  const senha = 'senha-sessoes-e2e';
  let professorToken: string;
  let aluno1Token: string;
  let aluno2Token: string;
  let aluno1Id: string;
  let aluno2Id: string;
  let professorId: string;

  let oficialId: string;
  let discPortuguesId: string; // do plano oficial publicado
  let discMatematicaId: string; // do plano oficial publicado
  let subProcliseId: string; // subtema de Português
  let subEncliseId: string; // subtema de Português
  let subConjuntosId: string; // subtema de Matemática
  let discRascunhoId: string; // disciplina de OFICIAL não publicado
  let discPessoalAluno2Id: string; // disciplina de PESSOAL do aluno2

  let blocoPortuguesAluno1Id: string; // bloco do cronograma do aluno1 (Português)
  let blocoMatematicaAluno1Id: string; // bloco do cronograma do aluno1 (Matemática)
  let blocoAluno2Id: string; // bloco do cronograma do aluno2

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function contarAtivas(alunoId: string): Promise<number> {
    return prisma.sessaoEstudo.count({
      where: { alunoId, origem: 'CRONOMETRO', fim: null, deletedAt: null },
    });
  }

  /** Garante que o aluno não tem cronômetro pendurado entre blocos de teste. */
  async function descartarAtivaSeHouver(token: string): Promise<void> {
    const res = await request(server).delete('/api/v1/sessoes/ativa').set(auth(token));
    expect([204, 404]).toContain(res.status);
  }

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    server = app.getHttpServer();
    await cleanDatabase(prisma);

    const senhaHash = await hashPassword(senha);
    const professor = await prisma.user.create({
      data: {
        nome: 'Professor Sessões',
        email: 'professor.sessoes@guia.test',
        senhaHash,
        role: 'PROFESSOR',
        status: 'ATIVO',
        origem: 'PROPRIO',
      },
    });
    professorId = professor.id;
    const aluno1 = await prisma.user.create({
      data: {
        nome: 'Aluno Um',
        email: 'aluno1.sessoes@guia.test',
        senhaHash,
        role: 'ALUNO',
        status: 'ATIVO',
        origem: 'PROPRIO',
      },
    });
    aluno1Id = aluno1.id;
    const aluno2 = await prisma.user.create({
      data: {
        nome: 'Aluno Dois',
        email: 'aluno2.sessoes@guia.test',
        senhaHash,
        role: 'ALUNO',
        status: 'ATIVO',
        origem: 'PROPRIO',
      },
    });
    aluno2Id = aluno2.id;

    const login = async (email: string): Promise<string> => {
      const res = await request(server)
        .post('/api/v1/auth/login')
        .send({ email, senha })
        .expect(200);
      return res.body.accessToken as string;
    };
    professorToken = await login('professor.sessoes@guia.test');
    aluno1Token = await login('aluno1.sessoes@guia.test');
    aluno2Token = await login('aluno2.sessoes@guia.test');
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  // -------------------------------------------------------------------------
  // Setup dos planos/disciplinas/cronogramas usados nos casos
  // -------------------------------------------------------------------------

  it('setup: plano oficial publicado (60/40), rascunho, pessoal do aluno2 e cronogramas', async () => {
    // Plano OFICIAL publicado com Português (tema + 2 subtemas) e Matemática
    const plano = await request(server)
      .post('/api/v1/planos')
      .set(auth(professorToken))
      .send({ titulo: 'Analista Sessões', tipo: 'OFICIAL' })
      .expect(201);
    oficialId = plano.body.plano.id;

    const criarDisciplina = async (planoId: string, token: string, nome: string, ordem: number) => {
      const res = await request(server)
        .post(`/api/v1/planos/${planoId}/disciplinas`)
        .set(auth(token))
        .send({ nome, ordem })
        .expect(201);
      return res.body.disciplina.id as string;
    };
    discPortuguesId = await criarDisciplina(oficialId, professorToken, 'Português', 1);
    discMatematicaId = await criarDisciplina(oficialId, professorToken, 'Matemática', 2);

    const criarTema = async (disciplinaId: string, nome: string) => {
      const res = await request(server)
        .post(`/api/v1/disciplinas/${disciplinaId}/temas`)
        .set(auth(professorToken))
        .send({ nome, ordem: 1 })
        .expect(201);
      return res.body.tema.id as string;
    };
    const temaColocacaoId = await criarTema(discPortuguesId, 'Colocação pronominal');
    const temaConjuntosId = await criarTema(discMatematicaId, 'Conjuntos');

    const criarSubtema = async (temaId: string, nome: string, ordem: number) => {
      const res = await request(server)
        .post(`/api/v1/temas/${temaId}/subtemas`)
        .set(auth(professorToken))
        .send({ nome, ordem })
        .expect(201);
      return res.body.subtema.id as string;
    };
    subProcliseId = await criarSubtema(temaColocacaoId, 'Próclise', 1);
    subEncliseId = await criarSubtema(temaColocacaoId, 'Ênclise', 2);
    subConjuntosId = await criarSubtema(temaConjuntosId, 'Operações com conjuntos', 1);

    await request(server)
      .put(`/api/v1/planos/${oficialId}/pesos`)
      .set(auth(professorToken))
      .send({
        pesos: [
          { disciplinaId: discPortuguesId, pesoPercentual: 60 },
          { disciplinaId: discMatematicaId, pesoPercentual: 40 },
        ],
      })
      .expect(200);
    await request(server)
      .post(`/api/v1/planos/${oficialId}/publicar`)
      .set(auth(professorToken))
      .expect(200);

    // Regra de matrícula: os dois alunos leem o OFICIAL via turma + matrícula
    await vincularPlanoAAlunos(prisma, {
      planoId: oficialId,
      professorId,
      alunoIds: [aluno1Id, aluno2Id],
    });

    // OFICIAL não publicado com disciplina (RN-4: não legível pelo aluno)
    const rascunho = await request(server)
      .post('/api/v1/planos')
      .set(auth(professorToken))
      .send({ titulo: 'Rascunho Sessões', tipo: 'OFICIAL' })
      .expect(201);
    discRascunhoId = await criarDisciplina(rascunho.body.plano.id, professorToken, 'Oculta', 1);

    // PESSOAL do aluno2 com disciplina (não legível pelo aluno1)
    const pessoal = await request(server)
      .post('/api/v1/planos')
      .set(auth(aluno2Token))
      .send({ titulo: 'Plano do Dois', tipo: 'PESSOAL' })
      .expect(201);
    discPessoalAluno2Id = await criarDisciplina(pessoal.body.plano.id, aluno2Token, 'Minha', 1);

    // Cronogramas (fonte de blocos): aluno1 e aluno2 geram do plano oficial
    const gerarCronograma = async (token: string): Promise<BlocoDto[]> => {
      const dias = [1, 3, 5];
      const res = await request(server)
        .post('/api/v1/cronogramas')
        .set(auth(token))
        .send({
          planoId: oficialId,
          diasSemana: dias,
          janelas: dias.map((dia) => ({ dia, inicio: '08:00', fim: '10:00' })),
          granularidadeMin: 60,
          timezone: 'America/Sao_Paulo',
        })
        .expect(201);
      return res.body.cronograma.blocos as BlocoDto[];
    };
    const blocosAluno1 = await gerarCronograma(aluno1Token);
    blocoPortuguesAluno1Id = blocosAluno1.find((b) => b.disciplinaId === discPortuguesId)!.id;
    blocoMatematicaAluno1Id = blocosAluno1.find((b) => b.disciplinaId === discMatematicaId)!.id;
    const blocosAluno2 = await gerarCronograma(aluno2Token);
    blocoAluno2Id = blocosAluno2.find((b) => b.disciplinaId === discPortuguesId)!.id;

    expect(blocoPortuguesAluno1Id).toBeDefined();
    expect(blocoMatematicaAluno1Id).toBeDefined();
    expect(blocoAluno2Id).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Autenticação e roles
  // -------------------------------------------------------------------------

  it('sem token → 401 UNAUTHENTICATED nas rotas de sessão', async () => {
    const get = await request(server).get('/api/v1/sessoes').expect(401);
    expectErrorEnvelope(get, 'UNAUTHENTICATED');

    const post = await request(server)
      .post('/api/v1/sessoes/cronometro/start')
      .send({ disciplinaId: discPortuguesId })
      .expect(401);
    expectErrorEnvelope(post, 'UNAUTHENTICATED');
  });

  it('professor (não-aluno) → 403 FORBIDDEN', async () => {
    const res = await request(server)
      .post('/api/v1/sessoes/cronometro/start')
      .set(auth(professorToken))
      .send({ disciplinaId: discPortuguesId })
      .expect(403);
    expectErrorEnvelope(res, 'FORBIDDEN');

    const list = await request(server).get('/api/v1/sessoes').set(auth(professorToken)).expect(403);
    expectErrorEnvelope(list, 'FORBIDDEN');
  });

  // -------------------------------------------------------------------------
  // CB-1: operações sobre /ativa sem cronômetro em andamento
  // -------------------------------------------------------------------------

  it('sem cronômetro em andamento: GET/pause/resume/stop/discard de /ativa → 404 NOT_FOUND (CB-1)', async () => {
    const get = await request(server).get('/api/v1/sessoes/ativa').set(auth(aluno1Token)).expect(404);
    expectErrorEnvelope(get, 'NOT_FOUND');

    for (const rota of ['pause', 'resume', 'stop']) {
      const res = await request(server)
        .post(`/api/v1/sessoes/ativa/${rota}`)
        .set(auth(aluno1Token))
        .send({})
        .expect(404);
      expectErrorEnvelope(res, 'NOT_FOUND');
    }

    const discard = await request(server)
      .delete('/api/v1/sessoes/ativa')
      .set(auth(aluno1Token))
      .expect(404);
    expectErrorEnvelope(discard, 'NOT_FOUND');
  });

  // -------------------------------------------------------------------------
  // Start: validações de referência (CA-8, CA-9, CB-6, RN-4)
  // -------------------------------------------------------------------------

  it('start com referências inválidas → 422 com details e nada criado', async () => {
    const casos: Array<{ body: Record<string, unknown>; field: string }> = [
      { body: { disciplinaId: randomUUID() }, field: 'disciplinaId' }, // inexistente
      { body: { disciplinaId: discRascunhoId }, field: 'disciplinaId' }, // OFICIAL não publicado
      { body: { disciplinaId: discPessoalAluno2Id }, field: 'disciplinaId' }, // PESSOAL alheio
      { body: { disciplinaId: discPortuguesId, subtemaId: randomUUID() }, field: 'subtemaId' }, // inexistente
      { body: { disciplinaId: discPortuguesId, subtemaId: subConjuntosId }, field: 'subtemaId' }, // outra disciplina
      { body: { disciplinaId: discPortuguesId, blocoId: randomUUID() }, field: 'blocoId' }, // inexistente
      { body: { disciplinaId: discPortuguesId, blocoId: blocoAluno2Id }, field: 'blocoId' }, // de outro aluno
      { body: { disciplinaId: discPortuguesId, blocoId: blocoMatematicaAluno1Id }, field: 'blocoId' }, // disciplina divergente
    ];

    for (const caso of casos) {
      const res = await request(server)
        .post('/api/v1/sessoes/cronometro/start')
        .set(auth(aluno1Token))
        .send(caso.body)
        .expect(422);
      expectErrorEnvelope(res, 'VALIDATION_ERROR');
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: caso.field })]),
      );
    }

    expect(await prisma.sessaoEstudo.count({ where: { alunoId: aluno1Id } })).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Fluxo do cronômetro: start → estados → stop
  // -------------------------------------------------------------------------

  let cronometroId: string;

  it('POST start com disciplina+subtema+bloco válidos → 201 RUNNING (CA-1, US-7)', async () => {
    const res = await request(server)
      .post('/api/v1/sessoes/cronometro/start')
      .set(auth(aluno1Token))
      .send({
        disciplinaId: discPortuguesId,
        subtemaId: subProcliseId,
        blocoId: blocoPortuguesAluno1Id,
      })
      .expect(201);

    const sessao = res.body.sessao as SessaoDto;
    expect(sessao).toMatchObject({
      id: expect.any(String),
      alunoId: aluno1Id,
      disciplinaId: discPortuguesId,
      subtemaId: subProcliseId,
      blocoId: blocoPortuguesAluno1Id,
      origem: 'CRONOMETRO',
      fim: null,
      duracaoMin: 0,
      estado: 'RUNNING',
    });
    expect(new Date(sessao.inicio).getTime()).toBeLessThanOrEqual(Date.now());
    cronometroId = sessao.id;
  });

  it('GET /sessoes/ativa reidrata o cronômetro em andamento (CB-3)', async () => {
    const res = await request(server).get('/api/v1/sessoes/ativa').set(auth(aluno1Token)).expect(200);
    expect(res.body.sessao).toMatchObject({ id: cronometroId, estado: 'RUNNING', fim: null });
  });

  it('segundo start com cronômetro rodando → 409 CONFLICT e nada criado (RN-1, CA-2)', async () => {
    const res = await request(server)
      .post('/api/v1/sessoes/cronometro/start')
      .set(auth(aluno1Token))
      .send({ disciplinaId: discMatematicaId })
      .expect(409);
    expectErrorEnvelope(res, 'CONFLICT');
    expect(await contarAtivas(aluno1Id)).toBe(1);
  });

  it('cronômetro do aluno1 não bloqueia o aluno2 (RN-1 é por aluno)', async () => {
    await request(server)
      .post('/api/v1/sessoes/cronometro/start')
      .set(auth(aluno2Token))
      .send({ disciplinaId: discPortuguesId })
      .expect(201);
    await request(server).delete('/api/v1/sessoes/ativa').set(auth(aluno2Token)).expect(204);
  });

  it('máquina de estados: pause→PAUSED, pause de novo→409, resume→RUNNING, resume de novo→409 (CA-4)', async () => {
    const pause = await request(server)
      .post('/api/v1/sessoes/ativa/pause')
      .set(auth(aluno1Token))
      .expect(200);
    expect(pause.body.sessao).toMatchObject({ id: cronometroId, estado: 'PAUSED' });

    const pause2 = await request(server)
      .post('/api/v1/sessoes/ativa/pause')
      .set(auth(aluno1Token))
      .expect(409);
    expectErrorEnvelope(pause2, 'CONFLICT');

    const ativa = await request(server)
      .get('/api/v1/sessoes/ativa')
      .set(auth(aluno1Token))
      .expect(200);
    expect(ativa.body.sessao.estado).toBe('PAUSED');

    const resume = await request(server)
      .post('/api/v1/sessoes/ativa/resume')
      .set(auth(aluno1Token))
      .expect(200);
    expect(resume.body.sessao).toMatchObject({ id: cronometroId, estado: 'RUNNING' });

    const resume2 = await request(server)
      .post('/api/v1/sessoes/ativa/resume')
      .set(auth(aluno1Token))
      .expect(409);
    expectErrorEnvelope(resume2, 'CONFLICT');
  });

  it('PATCH em sessão EM ANDAMENTO → 409 (RN-7)', async () => {
    const res = await request(server)
      .patch(`/api/v1/sessoes/${cronometroId}`)
      .set(auth(aluno1Token))
      .send({ duracaoMin: 10 })
      .expect(409);
    expectErrorEnvelope(res, 'CONFLICT');
  });

  it('stop com pausaMin inválido (negativo/decimal) → 422 e o cronômetro segue ativo', async () => {
    for (const pausaMin of [-1, 1.5]) {
      const res = await request(server)
        .post('/api/v1/sessoes/ativa/stop')
        .set(auth(aluno1Token))
        .send({ pausaMin })
        .expect(422);
      expectErrorEnvelope(res, 'VALIDATION_ERROR');
    }
    expect(await contarAtivas(aluno1Id)).toBe(1);
  });

  it('stop → 200 STOPPED com fim preenchido e piso duracaoMin=1 (CA-3, D-4)', async () => {
    const res = await request(server)
      .post('/api/v1/sessoes/ativa/stop')
      .set(auth(aluno1Token))
      .send({ pausaMin: 0 })
      .expect(200);

    const sessao = res.body.sessao as SessaoDto;
    // Poucos segundos decorridos: round daria 0, o piso garante 1 (houve tempo > 0)
    expect(sessao).toMatchObject({ id: cronometroId, estado: 'STOPPED', duracaoMin: 1 });
    expect(sessao.fim).not.toBeNull();

    const ativa = await request(server)
      .get('/api/v1/sessoes/ativa')
      .set(auth(aluno1Token))
      .expect(404);
    expectErrorEnvelope(ativa, 'NOT_FOUND');

    const noBanco = await prisma.sessaoEstudo.findUnique({ where: { id: cronometroId } });
    expect(noBanco?.fim).not.toBeNull();
    expect(noBanco?.duracaoMin).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Discard (CA-5) — hard delete
  // -------------------------------------------------------------------------

  it('DELETE /sessoes/ativa descarta com 204 e a linha SOME do banco (hard delete)', async () => {
    const start = await request(server)
      .post('/api/v1/sessoes/cronometro/start')
      .set(auth(aluno1Token))
      .send({ disciplinaId: discMatematicaId })
      .expect(201);
    const descartadaId = start.body.sessao.id as string;

    await request(server).delete('/api/v1/sessoes/ativa').set(auth(aluno1Token)).expect(204);

    const linha = await prisma.sessaoEstudo.findUnique({ where: { id: descartadaId } });
    expect(linha).toBeNull();

    // O slot do índice parcial foi liberado: novo start funciona
    await request(server)
      .post('/api/v1/sessoes/cronometro/start')
      .set(auth(aluno1Token))
      .send({ disciplinaId: discPortuguesId })
      .expect(201);
    await request(server).delete('/api/v1/sessoes/ativa').set(auth(aluno1Token)).expect(204);
  });

  // -------------------------------------------------------------------------
  // CB-5: corrida de dois starts simultâneos
  // -------------------------------------------------------------------------

  it('dois starts CONCORRENTES → exatamente um 201 e um 409, uma única linha no banco (CB-5)', async () => {
    expect(await contarAtivas(aluno1Id)).toBe(0);

    const fazerStart = () =>
      request(server)
        .post('/api/v1/sessoes/cronometro/start')
        .set(auth(aluno1Token))
        .send({ disciplinaId: discPortuguesId });

    const [r1, r2] = await Promise.all([fazerStart(), fazerStart()]);
    const statuses = [r1.status, r2.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);

    const conflito = r1.status === 409 ? r1 : r2;
    expectErrorEnvelope(conflito, 'CONFLICT');

    expect(await contarAtivas(aluno1Id)).toBe(1);
    await request(server).delete('/api/v1/sessoes/ativa').set(auth(aluno1Token)).expect(204);
  });

  it('REGRESSÃO review: rajada de 6 starts simultâneos → um 201, cinco 409, nenhum 500 (validações no tx)', async () => {
    expect(await contarAtivas(aluno1Id)).toBe(0);

    // Antes da correção, as validações dentro do $transaction usavam
    // this.prisma (pool) — sob rajada, risco de exaustão de conexões e 500.
    const resultados = await Promise.all(
      Array.from({ length: 6 }, () =>
        request(server)
          .post('/api/v1/sessoes/cronometro/start')
          .set(auth(aluno1Token))
          .send({
            disciplinaId: discPortuguesId,
            subtemaId: subProcliseId,
            blocoId: blocoPortuguesAluno1Id,
          }),
      ),
    );

    const statuses = resultados.map((r) => r.status).sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409, 409, 409, 409, 409]);
    for (const r of resultados.filter((res) => res.status === 409)) {
      expectErrorEnvelope(r, 'CONFLICT');
    }

    expect(await contarAtivas(aluno1Id)).toBe(1);
    await request(server).delete('/api/v1/sessoes/ativa').set(auth(aluno1Token)).expect(204);
  });

  // -------------------------------------------------------------------------
  // Registro manual (CA-6, CA-7, CB-4)
  // -------------------------------------------------------------------------

  let manualId: string;

  it('POST /sessoes/manual → 201 MANUAL com inicio=data@00:00Z e fim=inicio+duracaoMin (CA-6)', async () => {
    const ontem = isoDate(-DIA_MS);
    const res = await request(server)
      .post('/api/v1/sessoes/manual')
      .set(auth(aluno1Token))
      .send({ disciplinaId: discPortuguesId, subtemaId: subProcliseId, data: ontem, duracaoMin: 45 })
      .expect(201);

    const sessao = res.body.sessao as SessaoDto;
    expect(sessao).toMatchObject({
      alunoId: aluno1Id,
      disciplinaId: discPortuguesId,
      subtemaId: subProcliseId,
      origem: 'MANUAL',
      inicio: `${ontem}T00:00:00.000Z`,
      fim: `${ontem}T00:45:00.000Z`,
      duracaoMin: 45,
      estado: 'STOPPED',
    });
    manualId = sessao.id;
  });

  it('manual com data = hoje é aceito; com blocoId válido vincula o bloco (CA-9 feliz)', async () => {
    const hoje = isoDate(0);
    const res = await request(server)
      .post('/api/v1/sessoes/manual')
      .set(auth(aluno1Token))
      .send({ disciplinaId: discPortuguesId, blocoId: blocoPortuguesAluno1Id, data: hoje, duracaoMin: 30 })
      .expect(201);
    expect(res.body.sessao).toMatchObject({ blocoId: blocoPortuguesAluno1Id, duracaoMin: 30 });
  });

  it('manual inválido → 422: data futura, data impossível, duracaoMin 0/negativo/ausente/decimal (CA-7, CB-4)', async () => {
    const casos: Array<Record<string, unknown>> = [
      { disciplinaId: discPortuguesId, data: isoDate(2 * DIA_MS), duracaoMin: 30 }, // futuro real (além da folga UTC+14)
      { disciplinaId: discPortuguesId, data: '2026-02-30', duracaoMin: 30 }, // data de calendário inválida
      { disciplinaId: discPortuguesId, data: isoDate(0), duracaoMin: 0 },
      { disciplinaId: discPortuguesId, data: isoDate(0), duracaoMin: -10 },
      { disciplinaId: discPortuguesId, data: isoDate(0) }, // duracaoMin ausente
      { disciplinaId: discPortuguesId, data: isoDate(0), duracaoMin: 1.5 },
      { disciplinaId: discPortuguesId, data: isoDate(0), duracaoMin: 1441 }, // acima do teto de 24h (review)
      { disciplinaId: discPortuguesId, data: '06/07/2026', duracaoMin: 30 }, // formato errado
    ];
    const antes = await prisma.sessaoEstudo.count({ where: { alunoId: aluno1Id } });

    for (const body of casos) {
      const res = await request(server)
        .post('/api/v1/sessoes/manual')
        .set(auth(aluno1Token))
        .send(body)
        .expect(422);
      expectErrorEnvelope(res, 'VALIDATION_ERROR');
    }

    expect(await prisma.sessaoEstudo.count({ where: { alunoId: aluno1Id } })).toBe(antes);
  });

  it('REGRESSÃO review: teto de 24h no manual — duracaoMin=1440 → 201; 1441 → 422', async () => {
    const ontem = isoDate(-DIA_MS);
    const noTeto = await request(server)
      .post('/api/v1/sessoes/manual')
      .set(auth(aluno1Token))
      .send({ disciplinaId: discPortuguesId, data: ontem, duracaoMin: 1440 })
      .expect(201);
    expect(noTeto.body.sessao).toMatchObject({
      duracaoMin: 1440,
      inicio: `${ontem}T00:00:00.000Z`,
    });

    const acima = await request(server)
      .post('/api/v1/sessoes/manual')
      .set(auth(aluno1Token))
      .send({ disciplinaId: discPortuguesId, data: ontem, duracaoMin: 1441 })
      .expect(422);
    expectErrorEnvelope(acima, 'VALIDATION_ERROR');
    expect(acima.body.error.details).toEqual([
      expect.objectContaining({ field: 'duracaoMin', issue: expect.stringContaining('1440') }),
    ]);
  });

  it('manual com subtema de outra disciplina / bloco de outro aluno → 422 (CA-8, CA-9)', async () => {
    const hoje = isoDate(0);
    const subtemaErrado = await request(server)
      .post('/api/v1/sessoes/manual')
      .set(auth(aluno1Token))
      .send({ disciplinaId: discPortuguesId, subtemaId: subConjuntosId, data: hoje, duracaoMin: 30 })
      .expect(422);
    expect(subtemaErrado.body.error.details).toEqual([
      expect.objectContaining({ field: 'subtemaId' }),
    ]);

    const blocoAlheio = await request(server)
      .post('/api/v1/sessoes/manual')
      .set(auth(aluno1Token))
      .send({ disciplinaId: discPortuguesId, blocoId: blocoAluno2Id, data: hoje, duracaoMin: 30 })
      .expect(422);
    expect(blocoAlheio.body.error.details).toEqual([
      expect.objectContaining({ field: 'blocoId' }),
    ]);
  });

  // -------------------------------------------------------------------------
  // Escopo por dono (CA-10, RN-3) e PATCH pós-registro (RN-7)
  // -------------------------------------------------------------------------

  it('aluno2 não acessa sessão do aluno1: GET/PATCH/DELETE → 403; inexistente → 404; id malformado → 422', async () => {
    const get = await request(server)
      .get(`/api/v1/sessoes/${manualId}`)
      .set(auth(aluno2Token))
      .expect(403);
    expectErrorEnvelope(get, 'FORBIDDEN');

    const patch = await request(server)
      .patch(`/api/v1/sessoes/${manualId}`)
      .set(auth(aluno2Token))
      .send({ duracaoMin: 5 })
      .expect(403);
    expectErrorEnvelope(patch, 'FORBIDDEN');

    const del = await request(server)
      .delete(`/api/v1/sessoes/${manualId}`)
      .set(auth(aluno2Token))
      .expect(403);
    expectErrorEnvelope(del, 'FORBIDDEN');

    // Nada mudou na sessão do aluno1
    const intacta = await prisma.sessaoEstudo.findUnique({ where: { id: manualId } });
    expect(intacta).toMatchObject({ duracaoMin: 45, deletedAt: null });

    const inexistente = await request(server)
      .get(`/api/v1/sessoes/${randomUUID()}`)
      .set(auth(aluno1Token))
      .expect(404);
    expectErrorEnvelope(inexistente, 'NOT_FOUND');

    const malformado = await request(server)
      .get('/api/v1/sessoes/nao-e-uuid')
      .set(auth(aluno1Token))
      .expect(422);
    expectErrorEnvelope(malformado, 'VALIDATION_ERROR');
  });

  it('dono lê a própria sessão: GET /sessoes/{id} → 200', async () => {
    const res = await request(server)
      .get(`/api/v1/sessoes/${manualId}`)
      .set(auth(aluno1Token))
      .expect(200);
    expect(res.body.sessao).toMatchObject({ id: manualId, duracaoMin: 45, estado: 'STOPPED' });
  });

  it('PATCH corrige duracaoMin e subtemaId de sessão finalizada (RN-7); subtema divergente → 422', async () => {
    const ok = await request(server)
      .patch(`/api/v1/sessoes/${manualId}`)
      .set(auth(aluno1Token))
      .send({ duracaoMin: 50, subtemaId: subEncliseId })
      .expect(200);
    expect(ok.body.sessao).toMatchObject({ id: manualId, duracaoMin: 50, subtemaId: subEncliseId });

    const noBanco = await prisma.sessaoEstudo.findUnique({ where: { id: manualId } });
    expect(noBanco).toMatchObject({ duracaoMin: 50, subtemaId: subEncliseId });

    const divergente = await request(server)
      .patch(`/api/v1/sessoes/${manualId}`)
      .set(auth(aluno1Token))
      .send({ subtemaId: subConjuntosId })
      .expect(422);
    expectErrorEnvelope(divergente, 'VALIDATION_ERROR');

    const invalido = await request(server)
      .patch(`/api/v1/sessoes/${manualId}`)
      .set(auth(aluno1Token))
      .send({ duracaoMin: 0 })
      .expect(422);
    expectErrorEnvelope(invalido, 'VALIDATION_ERROR');
  });

  it('REGRESSÃO review: teto de 24h no PATCH — duracaoMin=1441 → 422; 1440 → 200', async () => {
    const acima = await request(server)
      .patch(`/api/v1/sessoes/${manualId}`)
      .set(auth(aluno1Token))
      .send({ duracaoMin: 1441 })
      .expect(422);
    expectErrorEnvelope(acima, 'VALIDATION_ERROR');
    expect(acima.body.error.details).toEqual([
      expect.objectContaining({ field: 'duracaoMin', issue: expect.stringContaining('1440') }),
    ]);
    // O 422 não alterou nada
    const intacta = await prisma.sessaoEstudo.findUnique({ where: { id: manualId } });
    expect(intacta?.duracaoMin).toBe(50);

    const noTeto = await request(server)
      .patch(`/api/v1/sessoes/${manualId}`)
      .set(auth(aluno1Token))
      .send({ duracaoMin: 1440 })
      .expect(200);
    expect(noTeto.body.sessao.duracaoMin).toBe(1440);
  });

  // -------------------------------------------------------------------------
  // Listagem (CA-11): filtros, paginação, ordenação, escopo
  // -------------------------------------------------------------------------

  describe('GET /sessoes — listagem (CA-11)', () => {
    // Conjunto controlado: zera as sessões e cria 3 do aluno1 + 1 do aluno2
    let s1: string; // Português, 2026-06-01, 30 min
    let s2: string; // Matemática, 2026-06-02, 45 min
    let s3: string; // Português, 2026-06-03, 60 min

    beforeAll(async () => {
      await descartarAtivaSeHouver(aluno1Token);
      await descartarAtivaSeHouver(aluno2Token);
      await prisma.sessaoEstudo.deleteMany({});

      const manual = async (
        token: string,
        disciplinaId: string,
        data: string,
        duracaoMin: number,
      ): Promise<string> => {
        const res = await request(server)
          .post('/api/v1/sessoes/manual')
          .set(auth(token))
          .send({ disciplinaId, data, duracaoMin })
          .expect(201);
        return res.body.sessao.id as string;
      };
      s1 = await manual(aluno1Token, discPortuguesId, '2026-06-01', 30);
      s2 = await manual(aluno1Token, discMatematicaId, '2026-06-02', 45);
      s3 = await manual(aluno1Token, discPortuguesId, '2026-06-03', 60);
      await manual(aluno2Token, discPortuguesId, '2026-06-02', 20);
    });

    it('retorna só as sessões do aluno autenticado, ordenadas por -inicio (default)', async () => {
      const res = await request(server).get('/api/v1/sessoes').set(auth(aluno1Token)).expect(200);

      expect(res.body).toMatchObject({ page: 1, pageSize: 20, total: 3 });
      const data = res.body.data as SessaoDto[];
      expect(data.map((s) => s.id)).toEqual([s3, s2, s1]);
      expect(data.every((s) => s.alunoId === aluno1Id)).toBe(true);

      const doDois = await request(server).get('/api/v1/sessoes').set(auth(aluno2Token)).expect(200);
      expect(doDois.body.total).toBe(1);
      expect((doDois.body.data as SessaoDto[])[0].alunoId).toBe(aluno2Id);
    });

    it('filtra por disciplinaId', async () => {
      const res = await request(server)
        .get(`/api/v1/sessoes?disciplinaId=${discPortuguesId}`)
        .set(auth(aluno1Token))
        .expect(200);
      expect(res.body.total).toBe(2);
      expect((res.body.data as SessaoDto[]).map((s) => s.id)).toEqual([s3, s1]);
    });

    it('filtra por from/to com `to` EXCLUSIVO: sessão começando exatamente em `to` não vem', async () => {
      // s3 começa exatamente em 2026-06-03T00:00:00Z (fronteira)
      const res = await request(server)
        .get('/api/v1/sessoes?from=2026-06-01T00:00:00Z&to=2026-06-03T00:00:00Z')
        .set(auth(aluno1Token))
        .expect(200);
      expect(res.body.total).toBe(2);
      expect((res.body.data as SessaoDto[]).map((s) => s.id)).toEqual([s2, s1]);

      const inclusivo = await request(server)
        .get('/api/v1/sessoes?from=2026-06-03T00:00:00Z')
        .set(auth(aluno1Token))
        .expect(200);
      expect((inclusivo.body.data as SessaoDto[]).map((s) => s.id)).toEqual([s3]); // from é inclusivo
    });

    it('pagina: pageSize=2 → página 1 com 2 itens, página 2 com 1, total 3', async () => {
      const p1 = await request(server)
        .get('/api/v1/sessoes?pageSize=2&page=1')
        .set(auth(aluno1Token))
        .expect(200);
      expect(p1.body).toMatchObject({ page: 1, pageSize: 2, total: 3 });
      expect((p1.body.data as SessaoDto[]).map((s) => s.id)).toEqual([s3, s2]);

      const p2 = await request(server)
        .get('/api/v1/sessoes?pageSize=2&page=2')
        .set(auth(aluno1Token))
        .expect(200);
      expect((p2.body.data as SessaoDto[]).map((s) => s.id)).toEqual([s1]);
    });

    it('ordena pela allowlist (duracaoMin asc/-duracaoMin desc); sort inválido → 422', async () => {
      const asc = await request(server)
        .get('/api/v1/sessoes?sort=duracaoMin')
        .set(auth(aluno1Token))
        .expect(200);
      expect((asc.body.data as SessaoDto[]).map((s) => s.duracaoMin)).toEqual([30, 45, 60]);

      const desc = await request(server)
        .get('/api/v1/sessoes?sort=-duracaoMin')
        .set(auth(aluno1Token))
        .expect(200);
      expect((desc.body.data as SessaoDto[]).map((s) => s.duracaoMin)).toEqual([60, 45, 30]);

      const invalido = await request(server)
        .get('/api/v1/sessoes?sort=alunoId')
        .set(auth(aluno1Token))
        .expect(422);
      expectErrorEnvelope(invalido, 'VALIDATION_ERROR');
    });

    it('DELETE /sessoes/{id} é SOFT delete: 204, deleted_at preenchido, some da listagem e GET → 404', async () => {
      await request(server).delete(`/api/v1/sessoes/${s1}`).set(auth(aluno1Token)).expect(204);

      const noBanco = await prisma.sessaoEstudo.findUnique({ where: { id: s1 } });
      expect(noBanco).not.toBeNull(); // linha continua no banco (≠ discard)
      expect(noBanco?.deletedAt).not.toBeNull();

      const lista = await request(server).get('/api/v1/sessoes').set(auth(aluno1Token)).expect(200);
      expect(lista.body.total).toBe(2);
      expect((lista.body.data as SessaoDto[]).map((s) => s.id)).toEqual([s3, s2]);

      const get = await request(server)
        .get(`/api/v1/sessoes/${s1}`)
        .set(auth(aluno1Token))
        .expect(404);
      expectErrorEnvelope(get, 'NOT_FOUND');
    });
  });

  // -------------------------------------------------------------------------
  // REGRESSÃO review: DELETE /sessoes/{id} em cronômetro RODANDO → 409
  // (antes soft-deletava, criando linha zumbi fim=null/duracaoMin=0)
  // -------------------------------------------------------------------------

  it('REGRESSÃO review: DELETE /sessoes/{id} de cronômetro EM ANDAMENTO → 409, sem deleted_at; descarte só via /ativa', async () => {
    const start = await request(server)
      .post('/api/v1/sessoes/cronometro/start')
      .set(auth(aluno1Token))
      .send({ disciplinaId: discPortuguesId })
      .expect(201);
    const rodandoId = start.body.sessao.id as string;

    const res = await request(server)
      .delete(`/api/v1/sessoes/${rodandoId}`)
      .set(auth(aluno1Token))
      .expect(409);
    expectErrorEnvelope(res, 'CONFLICT');

    // Nada mudou: a linha NÃO ganhou deleted_at e o cronômetro segue ativo
    const noBanco = await prisma.sessaoEstudo.findUnique({ where: { id: rodandoId } });
    expect(noBanco).toMatchObject({ fim: null, deletedAt: null });
    const ativa = await request(server)
      .get('/api/v1/sessoes/ativa')
      .set(auth(aluno1Token))
      .expect(200);
    expect(ativa.body.sessao.id).toBe(rodandoId);

    // O caminho legítimo de descarte é o DELETE /sessoes/ativa (hard delete)
    await request(server).delete('/api/v1/sessoes/ativa').set(auth(aluno1Token)).expect(204);
    expect(await prisma.sessaoEstudo.findUnique({ where: { id: rodandoId } })).toBeNull();
  });

  it('o índice único parcial existe no banco e rejeita 2ª ativa direto no INSERT', async () => {
    const indices = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'sessoes_estudo'
    `;
    expect(indices.map((i) => i.indexname)).toContain(
      'sessoes_estudo_aluno_id_cronometro_ativo_unique',
    );

    await request(server)
      .post('/api/v1/sessoes/cronometro/start')
      .set(auth(aluno1Token))
      .send({ disciplinaId: discPortuguesId })
      .expect(201);

    // Violação DIRETA no banco (fora da API) → P2002
    await expect(
      prisma.sessaoEstudo.create({
        data: {
          alunoId: aluno1Id,
          disciplinaId: discPortuguesId,
          origem: 'CRONOMETRO',
          inicio: new Date(),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    expect(await contarAtivas(aluno1Id)).toBe(1);
    await request(server).delete('/api/v1/sessoes/ativa').set(auth(aluno1Token)).expect(204);
  });

  // -------------------------------------------------------------------------
  // Fluxo feliz completo: start → pause → resume → stop → listagem
  // -------------------------------------------------------------------------

  it('fluxo completo: start → pause → resume → stop com pausaMin → aparece na listagem (US-1..3, US-6)', async () => {
    const start = await request(server)
      .post('/api/v1/sessoes/cronometro/start')
      .set(auth(aluno1Token))
      .send({ disciplinaId: discMatematicaId, subtemaId: subConjuntosId })
      .expect(201);
    const id = start.body.sessao.id as string;

    await request(server).post('/api/v1/sessoes/ativa/pause').set(auth(aluno1Token)).expect(200);
    await request(server).post('/api/v1/sessoes/ativa/resume').set(auth(aluno1Token)).expect(200);

    const stop = await request(server)
      .post('/api/v1/sessoes/ativa/stop')
      .set(auth(aluno1Token))
      .send({ pausaMin: 0 })
      .expect(200);
    // Poucos segundos reais decorridos → piso 1 (D-4)
    expect(stop.body.sessao).toMatchObject({ id, estado: 'STOPPED', duracaoMin: 1 });

    const lista = await request(server)
      .get(`/api/v1/sessoes?disciplinaId=${discMatematicaId}&sort=-createdAt`)
      .set(auth(aluno1Token))
      .expect(200);
    const encontrada = (lista.body.data as SessaoDto[]).find((s) => s.id === id);
    expect(encontrada).toMatchObject({
      origem: 'CRONOMETRO',
      subtemaId: subConjuntosId,
      duracaoMin: 1,
      estado: 'STOPPED',
    });
    expect(encontrada?.fim).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // REGRESSÕES review: null explícito nos DTOs de sessão
  // -------------------------------------------------------------------------

  it('REGRESSÃO review: POST /sessoes/manual com "subtemaId": null e "blocoId": null explícitos → 201 sem vínculos (equivale a ausente)', async () => {
    const ontem = isoDate(-DIA_MS);
    const res = await request(server)
      .post('/api/v1/sessoes/manual')
      .set(auth(aluno1Token))
      .send({
        disciplinaId: discPortuguesId,
        subtemaId: null,
        blocoId: null,
        data: ontem,
        duracaoMin: 30,
      })
      .expect(201);

    const sessao = res.body.sessao as SessaoDto;
    expect(sessao).toMatchObject({
      origem: 'MANUAL',
      subtemaId: null,
      blocoId: null,
      duracaoMin: 30,
      estado: 'STOPPED',
    });
    const linha = await prisma.sessaoEstudo.findUnique({ where: { id: sessao.id } });
    expect(linha).toMatchObject({ subtemaId: null, blocoId: null });
  });

  it('REGRESSÃO review: PATCH /sessoes/:id com "duracaoMin": null → 422 (antes 500), nada gravado; "subtemaId": null desvincula', async () => {
    const criada = await request(server)
      .post('/api/v1/sessoes/manual')
      .set(auth(aluno1Token))
      .send({
        disciplinaId: discPortuguesId,
        subtemaId: subProcliseId,
        data: isoDate(-DIA_MS),
        duracaoMin: 45,
      })
      .expect(201);
    const id = criada.body.sessao.id as string;

    const nulo = await request(server)
      .patch(`/api/v1/sessoes/${id}`)
      .set(auth(aluno1Token))
      .send({ duracaoMin: null })
      .expect(422);
    expectErrorEnvelope(nulo, 'VALIDATION_ERROR');
    // O 422 não alterou nada
    const intacta = await prisma.sessaoEstudo.findUnique({ where: { id } });
    expect(intacta).toMatchObject({ duracaoMin: 45, subtemaId: subProcliseId });

    // null explícito em subtemaId é comando legítimo: desvincula
    const desvinculada = await request(server)
      .patch(`/api/v1/sessoes/${id}`)
      .set(auth(aluno1Token))
      .send({ subtemaId: null })
      .expect(200);
    expect(desvinculada.body.sessao).toMatchObject({ id, subtemaId: null, duracaoMin: 45 });
    const noBanco = await prisma.sessaoEstudo.findUnique({ where: { id } });
    expect(noBanco!.subtemaId).toBeNull();
  });
});
