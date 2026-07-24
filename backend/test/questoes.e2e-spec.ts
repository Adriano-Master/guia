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
import { vincularPlanoAAlunos } from './helpers/vincular-plano-aluno';

// Banco DEDICADO de teste (guia_test) — nunca o banco de dev `guia`.
if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('localhost:5432/test')) {
  process.env.DATABASE_URL =
    'postgresql://guia:160402dbbba472cb61848717@localhost:5433/guia_test?schema=public';
}
if (!/guia_test/.test(process.env.DATABASE_URL)) {
  throw new Error(
    `E2E de questões exige banco guia_test (recebido: ${process.env.DATABASE_URL}). ` +
      'Nunca rode contra o banco de dev.',
  );
}

const MS_POR_DIA = 24 * 60 * 60_000;
/** Mesma folga do service: "hoje" da janela default é avaliado em UTC+14. */
const FOLGA_TZ_MS = 14 * 60 * 60_000;

function isoDia(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Dia de calendário `n` dias atrás (UTC) — fixtures sempre no passado. */
function diasAtras(n: number): string {
  return isoDia(new Date(Date.now() - n * MS_POR_DIA));
}

function shiftDia(dia: string, n: number): string {
  return isoDia(new Date(new Date(`${dia}T00:00:00Z`).getTime() + n * MS_POR_DIA));
}

async function createApp(): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    // Tokens são emitidos direto pelo TokenService (throttler de /auth limita
    // 5/min); o guard é neutralizado por segurança, como no e2e de turmas.
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

/** Ordem respeita FKs: registros/sessões/cronogramas → progresso → turmas → planos → users. */
async function cleanDatabase(prisma: PrismaService): Promise<void> {
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

interface RegistroDto {
  id: string;
  alunoId: string;
  temaId: string;
  temaNome: string;
  subtemaId: string | null;
  subtemaNome: string | null;
  data: string;
  total: number;
  erros: number;
  taxaErro: number;
  createdAt: string;
  updatedAt: string;
}

interface DesempenhoItem {
  temaId: string;
  temaNome: string;
  totalQuestoes: number;
  totalErros: number;
  taxaErro: number;
}

interface DesempenhoBody {
  data: DesempenhoItem[];
  from: string;
  to: string;
}

interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

describe('Questões e desempenho (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: ReturnType<INestApplication['getHttpServer']>;

  const senha = 'senha-questoes-e2e';
  let professorToken: string;
  let aluno1Token: string;
  let aluno2Token: string;
  let aluno3Token: string; // dedicado ao desempenho agregado
  let aluno1Id: string;
  let aluno2Id: string;
  let aluno3Id: string;
  let professorId: string;

  // Plano OFICIAL publicado: temaA (subA1, subA2) e temaB (subB1)
  let temaAId: string;
  let temaBId: string;
  let subA1Id: string;
  let subA2Id: string;
  let subB1Id: string;
  // Tema de plano PESSOAL do aluno2 (ilegível para aluno1)
  let temaPessoalAluno2Id: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const criarRegistro = (token: string, body: Record<string, unknown>) =>
    request(server).post('/api/v1/questoes').set(auth(token)).send(body);

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    server = app.getHttpServer();
    await cleanDatabase(prisma);

    const senhaHash = await hashPassword(senha);
    const tokenService = app.get(TokenService);
    const criarUserComToken = async (
      nome: string,
      email: string,
      role: 'PROFESSOR' | 'ALUNO',
    ): Promise<{ id: string; token: string }> => {
      const user = await prisma.user.create({
        data: { nome, email, senhaHash, role, status: 'ATIVO', origem: 'PROPRIO' },
      });
      return { id: user.id, token: await tokenService.signAccessToken(user) };
    };

    const professor = await criarUserComToken(
      'Professor Questões',
      'prof.questoes@guia.test',
      'PROFESSOR',
    );
    professorToken = professor.token;
    professorId = professor.id;
    const aluno1 = await criarUserComToken('Aluno Um', 'aluno1.questoes@guia.test', 'ALUNO');
    const aluno2 = await criarUserComToken('Aluno Dois', 'aluno2.questoes@guia.test', 'ALUNO');
    const aluno3 = await criarUserComToken('Aluno Três', 'aluno3.questoes@guia.test', 'ALUNO');
    aluno1Token = aluno1.token;
    aluno2Token = aluno2.token;
    aluno3Token = aluno3.token;
    aluno1Id = aluno1.id;
    aluno2Id = aluno2.id;
    aluno3Id = aluno3.id;
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  // -------------------------------------------------------------------------
  // Setup do plano com temas/subtemas
  // -------------------------------------------------------------------------

  it('setup: plano OFICIAL publicado com 2 temas/3 subtemas e PESSOAL do aluno2', async () => {
    const plano = await request(server)
      .post('/api/v1/planos')
      .set(auth(professorToken))
      .send({ titulo: 'Plano Questões', tipo: 'OFICIAL' })
      .expect(201);
    const planoId = plano.body.plano.id as string;

    const disciplina = await request(server)
      .post(`/api/v1/planos/${planoId}/disciplinas`)
      .set(auth(professorToken))
      .send({ nome: 'Português', ordem: 1 })
      .expect(201);
    const disciplinaId = disciplina.body.disciplina.id as string;

    const criarTema = async (nome: string, ordem: number): Promise<string> => {
      const res = await request(server)
        .post(`/api/v1/disciplinas/${disciplinaId}/temas`)
        .set(auth(professorToken))
        .send({ nome, ordem })
        .expect(201);
      return res.body.tema.id as string;
    };
    temaAId = await criarTema('Crase', 1);
    temaBId = await criarTema('Concordância', 2);

    const criarSubtema = async (temaId: string, nome: string, ordem: number): Promise<string> => {
      const res = await request(server)
        .post(`/api/v1/temas/${temaId}/subtemas`)
        .set(auth(professorToken))
        .send({ nome, ordem })
        .expect(201);
      return res.body.subtema.id as string;
    };
    subA1Id = await criarSubtema(temaAId, 'Regra geral', 1);
    subA2Id = await criarSubtema(temaAId, 'Casos especiais', 2);
    subB1Id = await criarSubtema(temaBId, 'Concordância verbal', 1);

    await request(server)
      .put(`/api/v1/planos/${planoId}/pesos`)
      .set(auth(professorToken))
      .send({ pesos: [{ disciplinaId, pesoPercentual: 100 }] })
      .expect(200);
    await request(server)
      .post(`/api/v1/planos/${planoId}/publicar`)
      .set(auth(professorToken))
      .expect(200);

    // Regra de matrícula: os três alunos leem o OFICIAL via turma + matrícula
    await vincularPlanoAAlunos(prisma, {
      planoId,
      professorId,
      alunoIds: [aluno1Id, aluno2Id, aluno3Id],
    });

    // PESSOAL do aluno2 com tema próprio (ilegível para aluno1)
    const pessoal = await request(server)
      .post('/api/v1/planos')
      .set(auth(aluno2Token))
      .send({ titulo: 'Pessoal do Aluno2', tipo: 'PESSOAL' })
      .expect(201);
    const discPessoal = await request(server)
      .post(`/api/v1/planos/${pessoal.body.plano.id as string}/disciplinas`)
      .set(auth(aluno2Token))
      .send({ nome: 'Minha disciplina', ordem: 1 })
      .expect(201);
    const temaPessoal = await request(server)
      .post(`/api/v1/disciplinas/${discPessoal.body.disciplina.id as string}/temas`)
      .set(auth(aluno2Token))
      .send({ nome: 'Meu tema', ordem: 1 })
      .expect(201);
    temaPessoalAluno2Id = temaPessoal.body.tema.id as string;
  });

  // -------------------------------------------------------------------------
  // Autenticação e roles
  // -------------------------------------------------------------------------

  it('sem token → 401; PROFESSOR (não-aluno) → 403 em todas as rotas de questões', async () => {
    const semToken = await request(server).get('/api/v1/questoes').expect(401);
    expectErrorEnvelope(semToken, 'UNAUTHENTICATED');
    const postSemToken = await request(server)
      .post('/api/v1/questoes')
      .send({ temaId: temaAId, data: diasAtras(1), total: 10, erros: 2 })
      .expect(401);
    expectErrorEnvelope(postSemToken, 'UNAUTHENTICATED');

    const professorPost = await criarRegistro(professorToken, {
      temaId: temaAId,
      data: diasAtras(1),
      total: 10,
      erros: 2,
    }).expect(403);
    expectErrorEnvelope(professorPost, 'FORBIDDEN');
    const professorDesempenho = await request(server)
      .get('/api/v1/questoes/desempenho')
      .set(auth(professorToken))
      .expect(403);
    expectErrorEnvelope(professorDesempenho, 'FORBIDDEN');
    expect(await prisma.registroQuestoes.count()).toBe(0);
  });

  // -------------------------------------------------------------------------
  // POST /questoes — CA-1..5, CB-1/CB-2
  // -------------------------------------------------------------------------

  let registro20x8Id: string;

  it('cria registro 20/8 → 201 com envelope {registro} e taxaErro=0.4 derivada (CA-1/CA-5)', async () => {
    const dia = diasAtras(6);
    const res = await criarRegistro(aluno1Token, {
      temaId: temaAId,
      data: dia,
      total: 20,
      erros: 8,
    }).expect(201);

    const registro = res.body.registro as RegistroDto;
    expect(registro).toMatchObject({
      alunoId: aluno1Id,
      temaId: temaAId,
      subtemaId: null,
      data: dia, // serialização YYYY-MM-DD sem off-by-one
      total: 20,
      erros: 8,
      taxaErro: 0.4,
    });
    registro20x8Id = registro.id;

    // RN-3: nenhuma coluna de taxa na tabela — taxa é SEMPRE derivada
    const colunas = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'registro_questoes'`;
    expect(colunas.map((c) => c.column_name)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/taxa/)]),
    );
  });

  it('erros = total → taxaErro 1.0 (CB-2); 1 em 3 → 0.3333 (4 casas)', async () => {
    const cem = await criarRegistro(aluno1Token, {
      temaId: temaAId,
      data: diasAtras(6),
      total: 10,
      erros: 10,
    }).expect(201);
    expect((cem.body.registro as RegistroDto).taxaErro).toBe(1);

    const terco = await criarRegistro(aluno1Token, {
      temaId: temaAId,
      data: diasAtras(6),
      total: 3,
      erros: 1,
    }).expect(201);
    expect((terco.body.registro as RegistroDto).taxaErro).toBe(0.3333);
  });

  it('subtema válido do tema → 201 com subtemaId; data de HOJE é aceita (CA-3/CA-4)', async () => {
    const res = await criarRegistro(aluno1Token, {
      temaId: temaAId,
      subtemaId: subA1Id,
      data: diasAtras(0),
      total: 8,
      erros: 2,
    }).expect(201);
    expect(res.body.registro as RegistroDto).toMatchObject({
      subtemaId: subA1Id,
      data: diasAtras(0),
      taxaErro: 0.25,
    });
  });

  it('erros > total → 422 VALIDATION_ERROR com details em erros (CA-2)', async () => {
    const res = await criarRegistro(aluno1Token, {
      temaId: temaAId,
      data: diasAtras(1),
      total: 5,
      erros: 6,
    }).expect(422);
    expectErrorEnvelope(res, 'VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([
      expect.objectContaining({ field: 'erros', issue: expect.stringContaining('total') }),
    ]);
  });

  it('DTO: total=0 (CB-1), erros=-1, decimais e data malformada → 422', async () => {
    const casos: Array<Record<string, unknown>> = [
      { temaId: temaAId, data: diasAtras(1), total: 0, erros: 0 },
      { temaId: temaAId, data: diasAtras(1), total: 10, erros: -1 },
      { temaId: temaAId, data: diasAtras(1), total: 10.5, erros: 2 },
      { temaId: temaAId, data: diasAtras(1), total: 10, erros: 2.5 },
      { temaId: temaAId, data: '07/07/2026', total: 10, erros: 2 },
      { temaId: 'nao-e-uuid', data: diasAtras(1), total: 10, erros: 2 },
      { data: diasAtras(1), total: 10, erros: 2 }, // sem temaId
    ];
    const antes = await prisma.registroQuestoes.count();
    for (const body of casos) {
      const res = await criarRegistro(aluno1Token, body).expect(422);
      expectErrorEnvelope(res, 'VALIDATION_ERROR');
    }
    expect(await prisma.registroQuestoes.count()).toBe(antes);
  });

  it('data futura real (+2 dias, além da folga UTC+14) → 422; 2026-02-30 → 422 (CA-3)', async () => {
    const futura = await criarRegistro(aluno1Token, {
      temaId: temaAId,
      data: isoDia(new Date(Date.now() + 2 * MS_POR_DIA)),
      total: 10,
      erros: 2,
    }).expect(422);
    expectErrorEnvelope(futura, 'VALIDATION_ERROR');
    expect(futura.body.error.details).toEqual([
      expect.objectContaining({ field: 'data', issue: expect.stringContaining('futura') }),
    ]);

    const invalida = await criarRegistro(aluno1Token, {
      temaId: temaAId,
      data: '2026-02-30',
      total: 10,
      erros: 2,
    }).expect(422);
    expectErrorEnvelope(invalida, 'VALIDATION_ERROR');
    expect(invalida.body.error.details).toEqual([
      expect.objectContaining({ field: 'data', issue: expect.stringContaining('calendário') }),
    ]);
  });

  // -------------------------------------------------------------------------
  // Referências tema/subtema — CA-4, CB-4
  // -------------------------------------------------------------------------

  it('tema inexistente, subtema inexistente e subtema de OUTRO tema → 422 com details (CB-4)', async () => {
    const temaInexistente = await criarRegistro(aluno1Token, {
      temaId: randomUUID(),
      data: diasAtras(1),
      total: 10,
      erros: 2,
    }).expect(422);
    expectErrorEnvelope(temaInexistente, 'VALIDATION_ERROR');
    expect(temaInexistente.body.error.details).toEqual([
      expect.objectContaining({ field: 'temaId', issue: 'tema inexistente' }),
    ]);

    const subtemaInexistente = await criarRegistro(aluno1Token, {
      temaId: temaAId,
      subtemaId: randomUUID(),
      data: diasAtras(1),
      total: 10,
      erros: 2,
    }).expect(422);
    expect(subtemaInexistente.body.error.details).toEqual([
      expect.objectContaining({ field: 'subtemaId', issue: 'subtema inexistente' }),
    ]);

    // subB1 pertence ao temaB, não ao temaA (CA-4/RN-4)
    const cruzado = await criarRegistro(aluno1Token, {
      temaId: temaAId,
      subtemaId: subB1Id,
      data: diasAtras(1),
      total: 10,
      erros: 2,
    }).expect(422);
    expect(cruzado.body.error.details).toEqual([
      expect.objectContaining({
        field: 'subtemaId',
        issue: expect.stringContaining('pertencer ao tema'),
      }),
    ]);
  });

  it('tema de plano PESSOAL de outro aluno → 422 (referência ilegível, não 403); dono usa normal', async () => {
    const ilegivel = await criarRegistro(aluno1Token, {
      temaId: temaPessoalAluno2Id,
      data: diasAtras(1),
      total: 10,
      erros: 2,
    }).expect(422);
    expectErrorEnvelope(ilegivel, 'VALIDATION_ERROR');
    expect(ilegivel.body.error.details).toEqual([
      expect.objectContaining({ field: 'temaId', issue: expect.stringContaining('acessível') }),
    ]);

    // Controle positivo: o PRÓPRIO aluno2 registra no tema do plano PESSOAL dele
    await criarRegistro(aluno2Token, {
      temaId: temaPessoalAluno2Id,
      data: diasAtras(1),
      total: 6,
      erros: 3,
    }).expect(201);
  });

  // -------------------------------------------------------------------------
  // GET /questoes — CA-6 (escopo, filtros inclusivos, sort, paginação)
  // -------------------------------------------------------------------------

  it('setup listagem: 3 registros do aluno1 no temaB em dias distintos', async () => {
    // d(10): 5/1 com subtema B1; d(9): 10/10; d(8): 30/3
    await criarRegistro(aluno1Token, {
      temaId: temaBId,
      subtemaId: subB1Id,
      data: diasAtras(10),
      total: 5,
      erros: 1,
    }).expect(201);
    await criarRegistro(aluno1Token, {
      temaId: temaBId,
      data: diasAtras(9),
      total: 10,
      erros: 10,
    }).expect(201);
    await criarRegistro(aluno1Token, {
      temaId: temaBId,
      data: diasAtras(8),
      total: 30,
      erros: 3,
    }).expect(201);
  });

  it('lista só registros do PRÓPRIO aluno, com envelope paginado e taxaErro por item (CA-6/RN-1)', async () => {
    const res = await request(server).get('/api/v1/questoes').set(auth(aluno1Token)).expect(200);
    const body = res.body as Paginated<RegistroDto>;
    expect(body).toMatchObject({ page: 1, pageSize: 20 });
    expect(body.total).toBeGreaterThanOrEqual(7);
    for (const item of body.data) {
      expect(item.alunoId).toBe(aluno1Id);
      expect(item.taxaErro).toBe(Math.round((item.erros / item.total) * 10_000) / 10_000);
    }

    // aluno2 vê apenas o dele (1 registro no tema pessoal)
    const doAluno2 = await request(server)
      .get('/api/v1/questoes')
      .set(auth(aluno2Token))
      .expect(200);
    const body2 = doAluno2.body as Paginated<RegistroDto>;
    expect(body2.total).toBe(1);
    expect(body2.data[0]).toMatchObject({ alunoId: aluno2Id, temaId: temaPessoalAluno2Id });
  });

  it('filtro temaId + ordenação default -data (mais recente primeiro)', async () => {
    const res = await request(server)
      .get(`/api/v1/questoes?temaId=${temaBId}`)
      .set(auth(aluno1Token))
      .expect(200);
    const body = res.body as Paginated<RegistroDto>;
    expect(body.total).toBe(3);
    expect(body.data.map((r) => r.data)).toEqual([diasAtras(8), diasAtras(9), diasAtras(10)]);
  });

  it('from/to são AMBOS inclusivos: registros exatamente em from e em to entram', async () => {
    // Janela exata [d(10), d(8)] cobre os 3
    const tudo = await request(server)
      .get(`/api/v1/questoes?temaId=${temaBId}&from=${diasAtras(10)}&to=${diasAtras(8)}`)
      .set(auth(aluno1Token))
      .expect(200);
    expect((tudo.body as Paginated<RegistroDto>).total).toBe(3);

    // from=to=d(9): só o registro daquele dia exato
    const umDia = await request(server)
      .get(`/api/v1/questoes?temaId=${temaBId}&from=${diasAtras(9)}&to=${diasAtras(9)}`)
      .set(auth(aluno1Token))
      .expect(200);
    const soDia9 = umDia.body as Paginated<RegistroDto>;
    expect(soDia9.total).toBe(1);
    expect(soDia9.data[0].data).toBe(diasAtras(9));

    // to=d(9) corta o d(8); from=d(9) corta o d(10)
    const ateDia9 = await request(server)
      .get(`/api/v1/questoes?temaId=${temaBId}&to=${diasAtras(9)}`)
      .set(auth(aluno1Token))
      .expect(200);
    expect((ateDia9.body as Paginated<RegistroDto>).data.map((r) => r.data)).toEqual([
      diasAtras(9),
      diasAtras(10),
    ]);
    const desdeDia9 = await request(server)
      .get(`/api/v1/questoes?temaId=${temaBId}&from=${diasAtras(9)}`)
      .set(auth(aluno1Token))
      .expect(200);
    expect((desdeDia9.body as Paginated<RegistroDto>).data.map((r) => r.data)).toEqual([
      diasAtras(8),
      diasAtras(9),
    ]);
  });

  it('from > to → 200 com lista vazia (não erro)', async () => {
    const res = await request(server)
      .get(`/api/v1/questoes?from=${diasAtras(1)}&to=${diasAtras(5)}`)
      .set(auth(aluno1Token))
      .expect(200);
    expect(res.body as Paginated<RegistroDto>).toMatchObject({ data: [], total: 0 });
  });

  it('filtro subtemaId; sort=total asc/desc; sort inválido → 422; paginação', async () => {
    const porSubtema = await request(server)
      .get(`/api/v1/questoes?subtemaId=${subB1Id}`)
      .set(auth(aluno1Token))
      .expect(200);
    const soB1 = porSubtema.body as Paginated<RegistroDto>;
    expect(soB1.total).toBe(1);
    expect(soB1.data[0]).toMatchObject({ subtemaId: subB1Id, total: 5, erros: 1, taxaErro: 0.2 });

    const asc = await request(server)
      .get(`/api/v1/questoes?temaId=${temaBId}&sort=total`)
      .set(auth(aluno1Token))
      .expect(200);
    expect((asc.body as Paginated<RegistroDto>).data.map((r) => r.total)).toEqual([5, 10, 30]);

    const desc = await request(server)
      .get(`/api/v1/questoes?temaId=${temaBId}&sort=-total`)
      .set(auth(aluno1Token))
      .expect(200);
    expect((desc.body as Paginated<RegistroDto>).data.map((r) => r.total)).toEqual([30, 10, 5]);

    const invalido = await request(server)
      .get('/api/v1/questoes?sort=taxaErro')
      .set(auth(aluno1Token))
      .expect(422);
    expectErrorEnvelope(invalido, 'VALIDATION_ERROR');

    const pagina1 = await request(server)
      .get(`/api/v1/questoes?temaId=${temaBId}&pageSize=2`)
      .set(auth(aluno1Token))
      .expect(200);
    expect(pagina1.body as Paginated<RegistroDto>).toMatchObject({
      page: 1,
      pageSize: 2,
      total: 3,
    });
    expect((pagina1.body as Paginated<RegistroDto>).data).toHaveLength(2);

    const pagina2 = await request(server)
      .get(`/api/v1/questoes?temaId=${temaBId}&pageSize=2&page=2`)
      .set(auth(aluno1Token))
      .expect(200);
    expect((pagina2.body as Paginated<RegistroDto>).data).toHaveLength(1);
  });

  it('from inválido de calendário na listagem → 422', async () => {
    const res = await request(server)
      .get('/api/v1/questoes?from=2026-02-30')
      .set(auth(aluno1Token))
      .expect(422);
    expectErrorEnvelope(res, 'VALIDATION_ERROR');
  });

  // -------------------------------------------------------------------------
  // GET /questoes/:id — CA-7
  // -------------------------------------------------------------------------

  it('GET /:id: dono → 200 {registro}; OUTRO aluno → 403; inexistente → 404; malformado → 422 (CA-7)', async () => {
    const proprio = await request(server)
      .get(`/api/v1/questoes/${registro20x8Id}`)
      .set(auth(aluno1Token))
      .expect(200);
    expect(proprio.body.registro as RegistroDto).toMatchObject({
      id: registro20x8Id,
      total: 20,
      erros: 8,
      taxaErro: 0.4,
    });

    const cruzado = await request(server)
      .get(`/api/v1/questoes/${registro20x8Id}`)
      .set(auth(aluno2Token))
      .expect(403);
    expectErrorEnvelope(cruzado, 'FORBIDDEN');

    const inexistente = await request(server)
      .get(`/api/v1/questoes/${randomUUID()}`)
      .set(auth(aluno1Token))
      .expect(404);
    expectErrorEnvelope(inexistente, 'NOT_FOUND');

    const malformado = await request(server)
      .get('/api/v1/questoes/nao-e-uuid')
      .set(auth(aluno1Token))
      .expect(422);
    expectErrorEnvelope(malformado, 'VALIDATION_ERROR');
  });

  // -------------------------------------------------------------------------
  // PATCH /questoes/:id — revalidação com valores resultantes
  // -------------------------------------------------------------------------

  it('PATCH só de erros valida contra total PERSISTIDO: 25 > 20 → 422; reduzir total < erros → 422', async () => {
    const errosDemais = await request(server)
      .patch(`/api/v1/questoes/${registro20x8Id}`)
      .set(auth(aluno1Token))
      .send({ erros: 25 })
      .expect(422);
    expectErrorEnvelope(errosDemais, 'VALIDATION_ERROR');
    expect(errosDemais.body.error.details).toEqual([
      expect.objectContaining({ field: 'erros' }),
    ]);

    const totalBaixo = await request(server)
      .patch(`/api/v1/questoes/${registro20x8Id}`)
      .set(auth(aluno1Token))
      .send({ total: 5 }) // erros persistidos = 8
      .expect(422);
    expect(totalBaixo.body.error.details).toEqual([expect.objectContaining({ field: 'erros' })]);

    // Nada mudou no banco
    const linha = await prisma.registroQuestoes.findUnique({ where: { id: registro20x8Id } });
    expect(linha).toMatchObject({ total: 20, erros: 8 });
  });

  it('PATCH {erros:10} → 200 recalcula taxaErro=0.5; PATCH de temaId → 422 (campo não editável)', async () => {
    const res = await request(server)
      .patch(`/api/v1/questoes/${registro20x8Id}`)
      .set(auth(aluno1Token))
      .send({ erros: 10 })
      .expect(200);
    expect(res.body.registro as RegistroDto).toMatchObject({
      total: 20,
      erros: 10,
      taxaErro: 0.5,
    });

    const temaImutavel = await request(server)
      .patch(`/api/v1/questoes/${registro20x8Id}`)
      .set(auth(aluno1Token))
      .send({ temaId: temaBId })
      .expect(422);
    expectErrorEnvelope(temaImutavel, 'VALIDATION_ERROR');
    const linha = await prisma.registroQuestoes.findUnique({ where: { id: registro20x8Id } });
    expect(linha!.temaId).toBe(temaAId);
  });

  it('PATCH de subtemaId: troca dentro do tema → 200; de outro tema → 422; null desvincula', async () => {
    const paraA2 = await request(server)
      .patch(`/api/v1/questoes/${registro20x8Id}`)
      .set(auth(aluno1Token))
      .send({ subtemaId: subA2Id })
      .expect(200);
    expect((paraA2.body.registro as RegistroDto).subtemaId).toBe(subA2Id);

    const deOutroTema = await request(server)
      .patch(`/api/v1/questoes/${registro20x8Id}`)
      .set(auth(aluno1Token))
      .send({ subtemaId: subB1Id })
      .expect(422);
    expectErrorEnvelope(deOutroTema, 'VALIDATION_ERROR');
    expect(deOutroTema.body.error.details).toEqual([
      expect.objectContaining({
        field: 'subtemaId',
        issue: expect.stringContaining('pertencer ao tema'),
      }),
    ]);

    const desvincula = await request(server)
      .patch(`/api/v1/questoes/${registro20x8Id}`)
      .set(auth(aluno1Token))
      .send({ subtemaId: null })
      .expect(200);
    expect((desvincula.body.registro as RegistroDto).subtemaId).toBeNull();
  });

  it('PATCH de data: futura → 422; 2026-02-30 → 422; válida → 200; OUTRO aluno → 403; inexistente → 404', async () => {
    const futura = await request(server)
      .patch(`/api/v1/questoes/${registro20x8Id}`)
      .set(auth(aluno1Token))
      .send({ data: isoDia(new Date(Date.now() + 2 * MS_POR_DIA)) })
      .expect(422);
    expectErrorEnvelope(futura, 'VALIDATION_ERROR');

    await request(server)
      .patch(`/api/v1/questoes/${registro20x8Id}`)
      .set(auth(aluno1Token))
      .send({ data: '2026-02-30' })
      .expect(422);

    const ok = await request(server)
      .patch(`/api/v1/questoes/${registro20x8Id}`)
      .set(auth(aluno1Token))
      .send({ data: diasAtras(3) })
      .expect(200);
    expect((ok.body.registro as RegistroDto).data).toBe(diasAtras(3));

    const cruzado = await request(server)
      .patch(`/api/v1/questoes/${registro20x8Id}`)
      .set(auth(aluno2Token))
      .send({ erros: 1 })
      .expect(403);
    expectErrorEnvelope(cruzado, 'FORBIDDEN');

    const inexistente = await request(server)
      .patch(`/api/v1/questoes/${randomUUID()}`)
      .set(auth(aluno1Token))
      .send({ erros: 1 })
      .expect(404);
    expectErrorEnvelope(inexistente, 'NOT_FOUND');
  });

  // -------------------------------------------------------------------------
  // DELETE /questoes/:id — soft delete
  // -------------------------------------------------------------------------

  it('DELETE: OUTRO aluno → 403; dono → 204 (SOFT delete: linha fica com deleted_at); some da listagem; GET/PATCH/DELETE de novo → 404', async () => {
    const cruzado = await request(server)
      .delete(`/api/v1/questoes/${registro20x8Id}`)
      .set(auth(aluno2Token))
      .expect(403);
    expectErrorEnvelope(cruzado, 'FORBIDDEN');

    await request(server)
      .delete(`/api/v1/questoes/${registro20x8Id}`)
      .set(auth(aluno1Token))
      .expect(204);

    // Soft delete de verdade: linha continua no banco com deletedAt preenchido
    const linha = await prisma.registroQuestoes.findUnique({ where: { id: registro20x8Id } });
    expect(linha).not.toBeNull();
    expect(linha!.deletedAt).not.toBeNull();

    const get = await request(server)
      .get(`/api/v1/questoes/${registro20x8Id}`)
      .set(auth(aluno1Token))
      .expect(404);
    expectErrorEnvelope(get, 'NOT_FOUND');

    await request(server)
      .patch(`/api/v1/questoes/${registro20x8Id}`)
      .set(auth(aluno1Token))
      .send({ erros: 1 })
      .expect(404);
    await request(server)
      .delete(`/api/v1/questoes/${registro20x8Id}`)
      .set(auth(aluno1Token))
      .expect(404);

    const lista = await request(server).get('/api/v1/questoes').set(auth(aluno1Token)).expect(200);
    expect((lista.body as Paginated<RegistroDto>).data.map((r) => r.id)).not.toContain(
      registro20x8Id,
    );
  });

  // -------------------------------------------------------------------------
  // GET /questoes/desempenho — CA-8, RN-5, D-3, CB-3 (aluno3 dedicado)
  // -------------------------------------------------------------------------

  it('rota /questoes/desempenho NÃO é engolida por GET /:id: 200 mesmo sem registros, com janela default ecoada (D-3)', async () => {
    const antes = isoDia(new Date(Date.now() + FOLGA_TZ_MS));
    const res = await request(server)
      .get('/api/v1/questoes/desempenho')
      .set(auth(aluno3Token))
      .expect(200); // se casasse /:id, seria 422 de UUID inválido
    const depois = isoDia(new Date(Date.now() + FOLGA_TZ_MS));

    const body = res.body as DesempenhoBody;
    expect(body.data).toEqual([]);
    // to = "hoje" em UTC+14; from = to − 29 (30 dias-calendário inclusivos)
    expect([antes, depois]).toContain(body.to);
    expect(body.from).toBe(shiftDia(body.to, -29));
  });

  let registroTemaBAluno3Id: string;

  it('setup desempenho (aluno3): 2 registros do MESMO tema/dia, 1 do temaB e 1 antigo fora da janela', async () => {
    // temaA no MESMO dia (RN-5: sessões diferentes somam): 10/4 + 10/2
    await criarRegistro(aluno3Token, {
      temaId: temaAId,
      data: diasAtras(5),
      total: 10,
      erros: 4,
    }).expect(201);
    await criarRegistro(aluno3Token, {
      temaId: temaAId,
      subtemaId: subA1Id,
      data: diasAtras(5),
      total: 10,
      erros: 2,
    }).expect(201);
    // temaB: 10/8 → taxa 0.8
    const temaB = await criarRegistro(aluno3Token, {
      temaId: temaBId,
      data: diasAtras(4),
      total: 10,
      erros: 8,
    }).expect(201);
    registroTemaBAluno3Id = (temaB.body.registro as RegistroDto).id;
    // Antigo (45 dias atrás): DEVE ficar FORA da janela default de 30 dias
    await criarRegistro(aluno3Token, {
      temaId: temaAId,
      data: diasAtras(45),
      total: 100,
      erros: 0,
    }).expect(201);
  });

  it('desempenho default: soma registros do mesmo tema (RN-5), ordena por taxaErro desc e EXCLUI o registro antigo (D-3)', async () => {
    const res = await request(server)
      .get('/api/v1/questoes/desempenho')
      .set(auth(aluno3Token))
      .expect(200);
    const body = res.body as DesempenhoBody;

    expect(body.data).toHaveLength(2);
    // temaB (0.8) antes de temaA (6/20 = 0.3); antigo (100/0) NÃO entra na soma
    expect(body.data[0]).toEqual({
      temaId: temaBId,
      temaNome: 'Concordância',
      totalQuestoes: 10,
      totalErros: 8,
      taxaErro: 0.8,
    });
    expect(body.data[1]).toEqual({
      temaId: temaAId,
      temaNome: 'Crase',
      totalQuestoes: 20,
      totalErros: 6,
      taxaErro: 0.3,
    });
  });

  it('from explícito ampliando a janela INCLUI o registro antigo na soma do tema', async () => {
    const res = await request(server)
      .get(`/api/v1/questoes/desempenho?from=${diasAtras(50)}&to=${diasAtras(0)}`)
      .set(auth(aluno3Token))
      .expect(200);
    const body = res.body as DesempenhoBody;

    expect(body).toMatchObject({ from: diasAtras(50), to: diasAtras(0) });
    const temaA = body.data.find((d) => d.temaId === temaAId)!;
    expect(temaA).toMatchObject({ totalQuestoes: 120, totalErros: 6, taxaErro: 0.05 });
    // temaB (0.8) continua na frente de temaA (0.05)
    expect(body.data.map((d) => d.temaId)).toEqual([temaBId, temaAId]);
  });

  it('fronteiras inclusivas e filtro temaId no desempenho', async () => {
    // from=to=d(5): só o temaA (os dois registros do dia)
    const soDia5 = await request(server)
      .get(`/api/v1/questoes/desempenho?from=${diasAtras(5)}&to=${diasAtras(5)}`)
      .set(auth(aluno3Token))
      .expect(200);
    expect((soDia5.body as DesempenhoBody).data).toEqual([
      expect.objectContaining({ temaId: temaAId, totalQuestoes: 20, totalErros: 6 }),
    ]);

    const soTemaB = await request(server)
      .get(`/api/v1/questoes/desempenho?temaId=${temaBId}`)
      .set(auth(aluno3Token))
      .expect(200);
    expect((soTemaB.body as DesempenhoBody).data).toEqual([
      expect.objectContaining({ temaId: temaBId, taxaErro: 0.8 }),
    ]);
  });

  it('período vazio e from > to → 200 com data:[] (CB-3); from inválido → 422', async () => {
    const vazio = await request(server)
      .get('/api/v1/questoes/desempenho?from=2020-01-01&to=2020-01-31')
      .set(auth(aluno3Token))
      .expect(200);
    expect(vazio.body as DesempenhoBody).toEqual({
      data: [],
      from: '2020-01-01',
      to: '2020-01-31',
    });

    const invertido = await request(server)
      .get(`/api/v1/questoes/desempenho?from=${diasAtras(0)}&to=${diasAtras(10)}`)
      .set(auth(aluno3Token))
      .expect(200);
    expect((invertido.body as DesempenhoBody).data).toEqual([]);

    const invalido = await request(server)
      .get('/api/v1/questoes/desempenho?from=2026-02-30')
      .set(auth(aluno3Token))
      .expect(422);
    expectErrorEnvelope(invalido, 'VALIDATION_ERROR');
  });

  it('desempenho é escopado por aluno: aluno1 não vê agregados do aluno3', async () => {
    const res = await request(server)
      .get(`/api/v1/questoes/desempenho?from=${diasAtras(5)}&to=${diasAtras(5)}`)
      .set(auth(aluno1Token))
      .expect(200);
    // aluno1 não tem registros em d(5) — os do dia são do aluno3
    expect((res.body as DesempenhoBody).data).toEqual([]);
  });

  it('DELETE de um registro remove-o da agregação de desempenho', async () => {
    await request(server)
      .delete(`/api/v1/questoes/${registroTemaBAluno3Id}`)
      .set(auth(aluno3Token))
      .expect(204);

    const res = await request(server)
      .get('/api/v1/questoes/desempenho')
      .set(auth(aluno3Token))
      .expect(200);
    const body = res.body as DesempenhoBody;
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ temaId: temaAId, totalQuestoes: 20, totalErros: 6 });
  });

  // -------------------------------------------------------------------------
  // REGRESSÕES review: null explícito, nomes de tema/subtema, paginação
  // estável e CHECK de defesa em profundidade no banco
  // -------------------------------------------------------------------------

  it('REGRESSÃO review: POST com "subtemaId": null explícito → 201 sem subtema (equivale a ausente)', async () => {
    const res = await criarRegistro(aluno1Token, {
      temaId: temaAId,
      subtemaId: null,
      data: diasAtras(6),
      total: 9,
      erros: 3,
    }).expect(201);

    const registro = res.body.registro as RegistroDto;
    expect(registro).toMatchObject({
      temaId: temaAId,
      subtemaId: null,
      subtemaNome: null,
      taxaErro: 0.3333,
    });
    const linha = await prisma.registroQuestoes.findUnique({ where: { id: registro.id } });
    expect(linha!.subtemaId).toBeNull();
  });

  it('REGRESSÃO review: PATCH com total/erros/data null → 422 (antes 500) e nada gravado', async () => {
    const base = await criarRegistro(aluno1Token, {
      temaId: temaAId,
      data: diasAtras(6),
      total: 12,
      erros: 3,
    }).expect(201);
    const id = (base.body.registro as RegistroDto).id;

    for (const body of [{ total: null }, { erros: null }, { data: null }]) {
      const res = await request(server)
        .patch(`/api/v1/questoes/${id}`)
        .set(auth(aluno1Token))
        .send(body)
        .expect(422);
      expectErrorEnvelope(res, 'VALIDATION_ERROR');
    }

    // Nada mudou no banco após os três 422
    const linha = await prisma.registroQuestoes.findUnique({ where: { id } });
    expect(linha).toMatchObject({ total: 12, erros: 3, deletedAt: null });
    expect(isoDia(linha!.data)).toBe(diasAtras(6));
  });

  it('REGRESSÃO review: temaNome/subtemaNome em POST, GET /:id, listagem e PATCH; null ao desvincular', async () => {
    const criado = await criarRegistro(aluno1Token, {
      temaId: temaBId,
      subtemaId: subB1Id,
      data: diasAtras(12),
      total: 10,
      erros: 2,
    }).expect(201);
    const registro = criado.body.registro as RegistroDto;
    expect(registro).toMatchObject({
      temaNome: 'Concordância',
      subtemaNome: 'Concordância verbal',
    });

    const porId = await request(server)
      .get(`/api/v1/questoes/${registro.id}`)
      .set(auth(aluno1Token))
      .expect(200);
    expect(porId.body.registro as RegistroDto).toMatchObject({
      temaNome: 'Concordância',
      subtemaNome: 'Concordância verbal',
    });

    // Listagem: todo item tem temaNome; subtemaNome null quando sem subtema
    const lista = await request(server)
      .get(`/api/v1/questoes?temaId=${temaBId}`)
      .set(auth(aluno1Token))
      .expect(200);
    const itens = (lista.body as Paginated<RegistroDto>).data;
    for (const item of itens) {
      expect(item.temaNome).toBe('Concordância');
    }
    const doItem = itens.find((r) => r.id === registro.id)!;
    expect(doItem.subtemaNome).toBe('Concordância verbal');
    const semSubtema = itens.find((r) => r.subtemaId === null)!;
    expect(semSubtema.subtemaNome).toBeNull();

    // PATCH desvinculando: subtemaNome acompanha (null), temaNome permanece
    const desvinculado = await request(server)
      .patch(`/api/v1/questoes/${registro.id}`)
      .set(auth(aluno1Token))
      .send({ subtemaId: null })
      .expect(200);
    expect(desvinculado.body.registro as RegistroDto).toMatchObject({
      temaNome: 'Concordância',
      subtemaId: null,
      subtemaNome: null,
    });
  });

  it('REGRESSÃO review: paginação ESTÁVEL — 15 registros na MESMA data paginam sem duplicar/omitir ids (2 execuções idênticas)', async () => {
    // 15 registros do aluno2 no temaA, todos no MESMO dia: sem o desempate
    // (createdAt desc, id asc) o offset/limit do Postgres poderia repetir ou
    // pular linhas entre as páginas.
    const dia = diasAtras(2);
    for (let i = 1; i <= 15; i += 1) {
      await criarRegistro(aluno2Token, {
        temaId: temaAId,
        data: dia,
        total: i,
        erros: 0,
      }).expect(201);
    }

    const lerPaginas = async (): Promise<string[]> => {
      const p1 = await request(server)
        .get(`/api/v1/questoes?temaId=${temaAId}&pageSize=10`)
        .set(auth(aluno2Token))
        .expect(200);
      const p2 = await request(server)
        .get(`/api/v1/questoes?temaId=${temaAId}&pageSize=10&page=2`)
        .set(auth(aluno2Token))
        .expect(200);
      const body1 = p1.body as Paginated<RegistroDto>;
      const body2 = p2.body as Paginated<RegistroDto>;
      expect(body1).toMatchObject({ page: 1, pageSize: 10, total: 15 });
      expect(body1.data).toHaveLength(10);
      expect(body2).toMatchObject({ page: 2, pageSize: 10, total: 15 });
      expect(body2.data).toHaveLength(5);
      return [...body1.data, ...body2.data].map((r) => r.id);
    };

    const primeira = await lerPaginas();
    // União das páginas: 15 ids ÚNICOS — nenhum repetido, nenhum omitido
    expect(primeira).toHaveLength(15);
    expect(new Set(primeira).size).toBe(15);

    // Determinismo: segunda leitura devolve EXATAMENTE a mesma sequência
    const segunda = await lerPaginas();
    expect(segunda).toEqual(primeira);
  });

  it('REGRESSÃO review: CHECK no banco (defesa em profundidade da RN-2) rejeita INSERT direto com erros>total ou total=0', async () => {
    // A constraint existe na tabela
    const constraints = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT conname FROM pg_constraint WHERE conrelid = 'registro_questoes'::regclass`;
    expect(constraints.map((c) => c.conname)).toContain('registro_questoes_valores_check');

    const antes = await prisma.registroQuestoes.count();

    // Escrita DIRETA no banco (fora da API/service) violando erros <= total
    await expect(
      prisma.registroQuestoes.create({
        data: {
          alunoId: aluno1Id,
          temaId: temaAId,
          data: new Date(`${diasAtras(1)}T00:00:00Z`),
          total: 5,
          erros: 6,
        },
      }),
    ).rejects.toThrow(/registro_questoes_valores_check/);

    // total = 0 também viola (CB-1 no nível do banco)
    await expect(
      prisma.registroQuestoes.create({
        data: {
          alunoId: aluno1Id,
          temaId: temaAId,
          data: new Date(`${diasAtras(1)}T00:00:00Z`),
          total: 0,
          erros: 0,
        },
      }),
    ).rejects.toThrow(/registro_questoes_valores_check/);

    expect(await prisma.registroQuestoes.count()).toBe(antes);
  });
});
