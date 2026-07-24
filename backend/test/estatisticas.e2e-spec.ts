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
    `E2E de estatísticas exige banco guia_test (recebido: ${process.env.DATABASE_URL}). ` +
      'Nunca rode contra o banco de dev.',
  );
}

const MS_POR_DIA = 24 * 60 * 60_000;
/** America/Sao_Paulo = UTC-3 fixo (sem DST desde 2019). */
const OFFSET_SP_MS = 3 * 60 * 60_000;

function isoDia(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Dia de calendário `n` dias atrás (UTC) — fixtures de questões no passado. */
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
    // 5/min); o guard é neutralizado por segurança, como no e2e de questões.
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

/** Ordem respeita FKs: registros/sessões → blocos/cronogramas → progresso → turmas → planos → users. */
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

interface HorasDisciplinaItem {
  disciplinaId: string;
  disciplina: string;
  horas: number;
}

interface HorasBody {
  data: HorasDisciplinaItem[];
  totalHoras: number;
}

interface SerieBucket {
  bucket: string;
  horas: number;
}

interface SerieBody {
  granularidade: string;
  from: string;
  to: string;
  timezone: string;
  data: SerieBucket[];
}

interface ProgressoBody {
  percentual: number;
  concluidos: number;
  totalSubtemas: number;
  porDisciplina?: Array<{
    disciplinaId: string;
    disciplina: string;
    percentual: number;
    concluidos: number;
    totalSubtemas: number;
  }>;
}

interface QuestoesTotais {
  total: number;
  erros: number;
  taxaErro: number;
}

interface DesempenhoBody extends QuestoesTotais {
  data?: Array<{
    disciplinaId?: string;
    temaId?: string;
    nome: string;
    total: number;
    erros: number;
    taxaErro: number;
  }>;
}

interface ResumoBody {
  horasTotais: number;
  progresso: { percentual: number; concluidos: number; totalSubtemas: number };
  questoes: QuestoesTotais;
}

/**
 * Datas FIXAS no passado (hoje ≥ 2026-07-23) escolhidas pela fronteira de
 * timezone/semana em America/Sao_Paulo (UTC-3):
 * - s1: 2026-07-10T02:00Z = quinta 2026-07-09 23:00 local (dia local ≠ dia UTC)
 * - s2: 2026-07-13T02:00Z = DOMINGO 2026-07-12 23:00 local (semana de 07-06)
 * - s3: 2026-07-13T13:00Z = segunda 2026-07-13 10:00 local (semana de 07-13)
 */
const S1_INICIO = new Date('2026-07-10T02:00:00Z'); // Português, 60 min
const S2_INICIO = new Date('2026-07-13T02:00:00Z'); // Matemática, 30 min
const S3_INICIO = new Date('2026-07-13T13:00:00Z'); // Português, 90 min

const ROTAS = [
  '/api/v1/estatisticas/resumo',
  '/api/v1/estatisticas/horas-por-disciplina',
  '/api/v1/estatisticas/serie-temporal',
  '/api/v1/estatisticas/progresso',
  '/api/v1/estatisticas/desempenho-questoes',
];

describe('Estatísticas (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: ReturnType<INestApplication['getHttpServer']>;

  const senha = 'senha-estatisticas-e2e';
  let adminToken: string;
  let professorToken: string;
  let aluno1Token: string;
  let aluno2Token: string;
  let aluno3Token: string; // aluno SEM nenhum dado
  let aluno1Id: string;
  let aluno2Id: string;
  let professorId: string;

  let planoId: string;
  let discPortuguesId: string;
  let discMatematicaId: string;
  let discDireitoId: string; // com peso, SEM sessões (CA-02)
  let temaCraseId: string; // Português
  let temaFracoesId: string; // Matemática
  let subPt1Id: string;
  let subPt2Id: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const getEstatistica = (token: string, rota: string) =>
    request(server).get(rota).set(auth(token));

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
      role: 'ADMIN' | 'PROFESSOR' | 'ALUNO',
    ): Promise<{ id: string; token: string }> => {
      const user = await prisma.user.create({
        data: { nome, email, senhaHash, role, status: 'ATIVO', origem: 'PROPRIO' },
      });
      return { id: user.id, token: await tokenService.signAccessToken(user) };
    };

    const admin = await criarUserComToken('Admin Stats', 'admin.stats@guia.test', 'ADMIN');
    adminToken = admin.token;
    const professor = await criarUserComToken(
      'Professor Stats',
      'prof.stats@guia.test',
      'PROFESSOR',
    );
    professorToken = professor.token;
    professorId = professor.id;
    const aluno1 = await criarUserComToken('Aluno Um', 'aluno1.stats@guia.test', 'ALUNO');
    const aluno2 = await criarUserComToken('Aluno Dois', 'aluno2.stats@guia.test', 'ALUNO');
    const aluno3 = await criarUserComToken('Aluno Três', 'aluno3.stats@guia.test', 'ALUNO');
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
  // Setup: plano, cronograma ativo do aluno1 e fixtures de sessões/progresso/questões
  // -------------------------------------------------------------------------

  it('setup: plano OFICIAL publicado (3 disciplinas, 6 subtemas), cronograma ativo do aluno1 em America/Sao_Paulo', async () => {
    const plano = await request(server)
      .post('/api/v1/planos')
      .set(auth(professorToken))
      .send({ titulo: 'Plano Estatísticas', tipo: 'OFICIAL' })
      .expect(201);
    planoId = plano.body.plano.id as string;

    const criarDisciplina = async (nome: string, ordem: number): Promise<string> => {
      const res = await request(server)
        .post(`/api/v1/planos/${planoId}/disciplinas`)
        .set(auth(professorToken))
        .send({ nome, ordem })
        .expect(201);
      return res.body.disciplina.id as string;
    };
    discPortuguesId = await criarDisciplina('Português', 1);
    discMatematicaId = await criarDisciplina('Matemática', 2);
    discDireitoId = await criarDisciplina('Direito', 3);

    const criarTema = async (disciplinaId: string, nome: string): Promise<string> => {
      const res = await request(server)
        .post(`/api/v1/disciplinas/${disciplinaId}/temas`)
        .set(auth(professorToken))
        .send({ nome, ordem: 1 })
        .expect(201);
      return res.body.tema.id as string;
    };
    temaCraseId = await criarTema(discPortuguesId, 'Crase');
    temaFracoesId = await criarTema(discMatematicaId, 'Frações');
    const temaDireitoId = await criarTema(discDireitoId, 'Princípios');

    const criarSubtema = async (temaId: string, nome: string, ordem: number): Promise<string> => {
      const res = await request(server)
        .post(`/api/v1/temas/${temaId}/subtemas`)
        .set(auth(professorToken))
        .send({ nome, ordem })
        .expect(201);
      return res.body.subtema.id as string;
    };
    subPt1Id = await criarSubtema(temaCraseId, 'Regra geral', 1);
    subPt2Id = await criarSubtema(temaCraseId, 'Casos especiais', 2);
    await criarSubtema(temaFracoesId, 'Operações', 1);
    await criarSubtema(temaFracoesId, 'Problemas', 2);
    await criarSubtema(temaDireitoId, 'Legalidade', 1);
    await criarSubtema(temaDireitoId, 'Impessoalidade', 2);

    await request(server)
      .put(`/api/v1/planos/${planoId}/pesos`)
      .set(auth(professorToken))
      .send({
        pesos: [
          { disciplinaId: discPortuguesId, pesoPercentual: 40 },
          { disciplinaId: discMatematicaId, pesoPercentual: 30 },
          { disciplinaId: discDireitoId, pesoPercentual: 30 },
        ],
      })
      .expect(200);
    await request(server)
      .post(`/api/v1/planos/${planoId}/publicar`)
      .set(auth(professorToken))
      .expect(200);

    await vincularPlanoAAlunos(prisma, {
      planoId,
      professorId,
      alunoIds: [aluno1Id, aluno2Id],
    });

    // Cronograma ATIVO do aluno1 — define plano ativo (RN-02) e timezone (RN-03)
    const dias = [1, 3, 5];
    await request(server)
      .post('/api/v1/cronogramas')
      .set(auth(aluno1Token))
      .send({
        planoId,
        diasSemana: dias,
        janelas: dias.map((dia) => ({ dia, inicio: '08:00', fim: '10:00' })),
        granularidadeMin: 60,
        timezone: 'America/Sao_Paulo',
      })
      .expect(201);
  });

  it('setup: sessões (fronteiras de TZ), sessão em andamento, soft-deleted, sessão do aluno2, progresso e questões', async () => {
    const criarSessao = (
      alunoId: string,
      disciplinaId: string,
      inicio: Date,
      duracaoMin: number,
      extra: Record<string, unknown> = {},
    ) =>
      prisma.sessaoEstudo.create({
        data: {
          alunoId,
          disciplinaId,
          origem: 'MANUAL',
          inicio,
          fim: new Date(inicio.getTime() + duracaoMin * 60_000),
          duracaoMin,
          ...extra,
        },
      });

    // Sessões finalizadas do aluno1 (3h no total)
    await criarSessao(aluno1Id, discPortuguesId, S1_INICIO, 60);
    await criarSessao(aluno1Id, discMatematicaId, S2_INICIO, 30);
    await criarSessao(aluno1Id, discPortuguesId, S3_INICIO, 90);

    // CA-01: cronômetro EM ANDAMENTO (fim null) não conta, mesmo com duracaoMin>0
    await prisma.sessaoEstudo.create({
      data: {
        alunoId: aluno1Id,
        disciplinaId: discPortuguesId,
        origem: 'CRONOMETRO',
        inicio: new Date('2026-07-14T12:00:00Z'),
        fim: null,
        duracaoMin: 500,
      },
    });
    // CA-01: sessão soft-deleted não conta
    await criarSessao(aluno1Id, discPortuguesId, new Date('2026-07-11T12:00:00Z'), 777, {
      deletedAt: new Date(),
    });

    // Isolamento: sessão GRANDE do aluno2 não pode vazar para o aluno1
    await criarSessao(aluno2Id, discMatematicaId, new Date('2026-07-14T12:00:00Z'), 600);

    // Progresso: aluno1 conclui 1 de 6 subtemas; aluno2 conclui 1 (mas não tem cronograma)
    await request(server)
      .put(`/api/v1/progresso/subtemas/${subPt1Id}`)
      .set(auth(aluno1Token))
      .send({ concluido: true })
      .expect(200);
    await request(server)
      .put(`/api/v1/progresso/subtemas/${subPt2Id}`)
      .set(auth(aluno2Token))
      .send({ concluido: true })
      .expect(200);

    // Questões do aluno1: Crase (Português) 20/8 e Frações (Matemática) 10/1
    await request(server)
      .post('/api/v1/questoes')
      .set(auth(aluno1Token))
      .send({ temaId: temaCraseId, data: diasAtras(3), total: 20, erros: 8 })
      .expect(201);
    await request(server)
      .post('/api/v1/questoes')
      .set(auth(aluno1Token))
      .send({ temaId: temaFracoesId, data: diasAtras(2), total: 10, erros: 1 })
      .expect(201);
  });

  // -------------------------------------------------------------------------
  // CA-06 — autenticação e papéis nos 5 endpoints
  // -------------------------------------------------------------------------

  it('CA-06: sem token → 401 UNAUTHENTICATED nos 5 endpoints', async () => {
    for (const rota of ROTAS) {
      const res = await request(server).get(rota).expect(401);
      expectErrorEnvelope(res, 'UNAUTHENTICATED');
    }
  });

  it('CA-06: ADMIN e PROFESSOR → 403 FORBIDDEN nos 5 endpoints (rotas exclusivas de ALUNO)', async () => {
    for (const token of [adminToken, professorToken]) {
      for (const rota of ROTAS) {
        const res = await getEstatistica(token, rota).expect(403);
        expectErrorEnvelope(res, 'FORBIDDEN');
      }
    }
  });

  // -------------------------------------------------------------------------
  // Resumo — integra horas (CA-01), progresso (CA-03) e questões (CA-05)
  // -------------------------------------------------------------------------

  it('resumo do aluno1 integra os três blocos; sessões em andamento/soft-deleted e dados do aluno2 FORA', async () => {
    const res = await getEstatistica(aluno1Token, '/api/v1/estatisticas/resumo').expect(200);
    const body = res.body as ResumoBody;

    expect(body).toEqual({
      // 60+30+90 = 180 min = 3h — sem os 500 (fim null), 777 (deleted) e 600 (aluno2)
      horasTotais: 3,
      // 1 de 6 subtemas do plano ativo → 16.666… → 16.7 (1 casa half-up)
      progresso: { percentual: 16.7, concluidos: 1, totalSubtemas: 6 },
      // 20/8 + 10/1 = 30/9 → 0.3
      questoes: { total: 30, erros: 9, taxaErro: 0.3 },
    });
  });

  it('resumo do aluno2: horas próprias (10h), questões zeradas e progresso 0/0/0 SEM cronograma ativo (CA-03)', async () => {
    const res = await getEstatistica(aluno2Token, '/api/v1/estatisticas/resumo').expect(200);
    expect(res.body as ResumoBody).toEqual({
      horasTotais: 10,
      progresso: { percentual: 0, concluidos: 0, totalSubtemas: 0 }, // marcou subtema, mas sem plano ativo
      questoes: { total: 0, erros: 0, taxaErro: 0 },
    });
  });

  it('aluno3 sem NENHUM dado → resumo todo zerado', async () => {
    const res = await getEstatistica(aluno3Token, '/api/v1/estatisticas/resumo').expect(200);
    expect(res.body as ResumoBody).toEqual({
      horasTotais: 0,
      progresso: { percentual: 0, concluidos: 0, totalSubtemas: 0 },
      questoes: { total: 0, erros: 0, taxaErro: 0 },
    });
  });

  // -------------------------------------------------------------------------
  // Horas por disciplina — CA-02, RN-03 nos filtros, soft delete
  // -------------------------------------------------------------------------

  it('CA-02: uma linha por disciplina COM sessão (horas desc); Direito (0h) não aparece', async () => {
    const res = await getEstatistica(
      aluno1Token,
      '/api/v1/estatisticas/horas-por-disciplina',
    ).expect(200);
    const body = res.body as HorasBody;

    expect(body.data).toEqual([
      { disciplinaId: discPortuguesId, disciplina: 'Português', horas: 2.5 },
      { disciplinaId: discMatematicaId, disciplina: 'Matemática', horas: 0.5 },
    ]);
    expect(body.totalHoras).toBe(3);
    expect(body.data.map((d) => d.disciplinaId)).not.toContain(discDireitoId);
  });

  it('RN-03: from/to recortam por DIA LOCAL — sessão de 23h local (02:00Z do dia seguinte) pertence ao dia local', async () => {
    // s1 = 2026-07-10T02:00Z = 2026-07-09 23:00 em SP → entra no dia local 07-09…
    const dia9 = await getEstatistica(
      aluno1Token,
      '/api/v1/estatisticas/horas-por-disciplina?from=2026-07-09&to=2026-07-09',
    ).expect(200);
    expect(dia9.body as HorasBody).toEqual({
      data: [{ disciplinaId: discPortuguesId, disciplina: 'Português', horas: 1 }],
      totalHoras: 1,
    });

    // …e NÃO no dia 07-10 (que em UTC a conteria)
    const dia10 = await getEstatistica(
      aluno1Token,
      '/api/v1/estatisticas/horas-por-disciplina?from=2026-07-10&to=2026-07-10',
    ).expect(200);
    expect(dia10.body as HorasBody).toEqual({ data: [], totalHoras: 0 });
  });

  it('from/to INCLUSIVOS: sessão no dia `to` entra; o dia seguinte não', async () => {
    // to=07-12 inclui s2 (domingo 23h local); s3 (07-13) fica fora
    const ateDomingo = await getEstatistica(
      aluno1Token,
      '/api/v1/estatisticas/horas-por-disciplina?to=2026-07-12',
    ).expect(200);
    expect((ateDomingo.body as HorasBody).totalHoras).toBe(1.5); // s1 (1h) + s2 (0.5h)
    expect((ateDomingo.body as HorasBody).data).toEqual([
      { disciplinaId: discPortuguesId, disciplina: 'Português', horas: 1 },
      { disciplinaId: discMatematicaId, disciplina: 'Matemática', horas: 0.5 },
    ]);

    // from=07-13 pega só s3
    const desdeSegunda = await getEstatistica(
      aluno1Token,
      '/api/v1/estatisticas/horas-por-disciplina?from=2026-07-13',
    ).expect(200);
    expect(desdeSegunda.body as HorasBody).toEqual({
      data: [{ disciplinaId: discPortuguesId, disciplina: 'Português', horas: 1.5 }],
      totalHoras: 1.5,
    });
  });

  it('caso de borda: disciplina SOFT-DELETED com sessões antigas segue nas estatísticas com o nome preservado', async () => {
    await prisma.disciplina.update({
      where: { id: discMatematicaId },
      data: { deletedAt: new Date() },
    });
    try {
      const res = await getEstatistica(
        aluno1Token,
        '/api/v1/estatisticas/horas-por-disciplina',
      ).expect(200);
      const body = res.body as HorasBody;
      expect(body.data).toContainEqual({
        disciplinaId: discMatematicaId,
        disciplina: 'Matemática', // nome preservado
        horas: 0.5,
      });
      expect(body.totalHoras).toBe(3);
    } finally {
      await prisma.disciplina.update({
        where: { id: discMatematicaId },
        data: { deletedAt: null },
      });
    }
  });

  // -------------------------------------------------------------------------
  // Série temporal — CA-04 / RN-03 (fronteira de dia e de semana no TZ local)
  // -------------------------------------------------------------------------

  it('RN-03 (dia): série diária contínua colocando a sessão de 23h local no dia LOCAL correto (≠ dia UTC)', async () => {
    const res = await getEstatistica(
      aluno1Token,
      '/api/v1/estatisticas/serie-temporal?granularidade=dia&from=2026-07-08&to=2026-07-14',
    ).expect(200);
    const body = res.body as SerieBody;

    expect(body).toMatchObject({
      granularidade: 'dia',
      from: '2026-07-08',
      to: '2026-07-14',
      timezone: 'America/Sao_Paulo',
    });
    // Contínua (7 buckets, zeros incluídos); s1 no dia local 07-09, NÃO em 07-10
    expect(body.data).toEqual([
      { bucket: '2026-07-08', horas: 0 },
      { bucket: '2026-07-09', horas: 1 }, // s1: 02:00Z de 07-10 = 23:00 local de 07-09
      { bucket: '2026-07-10', horas: 0 },
      { bucket: '2026-07-11', horas: 0 }, // soft-deleted (777 min) fora
      { bucket: '2026-07-12', horas: 0.5 }, // s2: domingo 23h local
      { bucket: '2026-07-13', horas: 1.5 }, // s3: segunda 10h local
      { bucket: '2026-07-14', horas: 0 }, // fim=null (500 min) fora
    ]);
  });

  it('RN-03 (semana): domingo 23h local fica na semana ANTERIOR; segunda vai para a semana seguinte; rótulo é a segunda-feira', async () => {
    const res = await getEstatistica(
      aluno1Token,
      '/api/v1/estatisticas/serie-temporal?granularidade=semana&from=2026-07-06&to=2026-07-19',
    ).expect(200);
    const body = res.body as SerieBody;

    expect(body.data).toEqual([
      // s1 (qui 07-09, 1h) + s2 (DOMINGO 07-12 23h local, 0.5h) → semana de 07-06
      { bucket: '2026-07-06', horas: 1.5 },
      // s3 (SEGUNDA 07-13 10h local) abre a semana seguinte
      { bucket: '2026-07-13', horas: 1.5 },
    ]);
  });

  it('semana parcial: from no meio da semana ainda é rotulado pela segunda-feira daquela semana', async () => {
    const res = await getEstatistica(
      aluno1Token,
      '/api/v1/estatisticas/serie-temporal?granularidade=semana&from=2026-07-09&to=2026-07-14',
    ).expect(200);
    const body = res.body as SerieBody;
    expect(body.data.map((b) => b.bucket)).toEqual(['2026-07-06', '2026-07-13']);
    expect(body.data).toEqual([
      { bucket: '2026-07-06', horas: 1.5 },
      { bucket: '2026-07-13', horas: 1.5 },
    ]);
  });

  it('série com from/to inclusivos: sessão do dia `to` entra; deslocar `to` um dia para trás a remove', async () => {
    const comSegunda = await getEstatistica(
      aluno1Token,
      '/api/v1/estatisticas/serie-temporal?from=2026-07-12&to=2026-07-13',
    ).expect(200);
    expect((comSegunda.body as SerieBody).data).toEqual([
      { bucket: '2026-07-12', horas: 0.5 },
      { bucket: '2026-07-13', horas: 1.5 },
    ]);

    const semSegunda = await getEstatistica(
      aluno1Token,
      '/api/v1/estatisticas/serie-temporal?from=2026-07-12&to=2026-07-12',
    ).expect(200);
    expect((semSegunda.body as SerieBody).data).toEqual([{ bucket: '2026-07-12', horas: 0.5 }]);
  });

  it('defaults ecoados: 30 dias inclusivos terminando HOJE local, timezone na resposta; aluno sem dados → série contínua de zeros', async () => {
    // aluno3 não tem cronograma → timezone default America/Sao_Paulo
    const antes = isoDia(new Date(Date.now() - OFFSET_SP_MS));
    const res = await getEstatistica(aluno3Token, '/api/v1/estatisticas/serie-temporal').expect(
      200,
    );
    const depois = isoDia(new Date(Date.now() - OFFSET_SP_MS));

    const body = res.body as SerieBody;
    expect(body.granularidade).toBe('dia');
    expect(body.timezone).toBe('America/Sao_Paulo');
    expect([antes, depois]).toContain(body.to); // hoje LOCAL de São Paulo
    expect(body.from).toBe(shiftDia(body.to, -29)); // 30 dias inclusivos
    expect(body.data).toHaveLength(30);
    expect(body.data[0].bucket).toBe(body.from);
    expect(body.data[29].bucket).toBe(body.to);
    for (const bucket of body.data) {
      expect(bucket.horas).toBe(0); // contínua e toda zerada
    }
  });

  // -------------------------------------------------------------------------
  // Progresso — CA-03 e detalhamento por disciplina
  // -------------------------------------------------------------------------

  it('progresso do aluno1: 1/6 = 16.7%; porDisciplina=true detalha as 3 disciplinas do plano ativo', async () => {
    const semDetalhe = await getEstatistica(aluno1Token, '/api/v1/estatisticas/progresso').expect(
      200,
    );
    expect(semDetalhe.body as ProgressoBody).toEqual({
      percentual: 16.7,
      concluidos: 1,
      totalSubtemas: 6,
    });
    expect(semDetalhe.body).not.toHaveProperty('porDisciplina');

    const detalhado = await getEstatistica(
      aluno1Token,
      '/api/v1/estatisticas/progresso?porDisciplina=true',
    ).expect(200);
    expect((detalhado.body as ProgressoBody).porDisciplina).toEqual([
      { disciplinaId: discPortuguesId, disciplina: 'Português', percentual: 50, concluidos: 1, totalSubtemas: 2 },
      { disciplinaId: discMatematicaId, disciplina: 'Matemática', percentual: 0, concluidos: 0, totalSubtemas: 2 },
      { disciplinaId: discDireitoId, disciplina: 'Direito', percentual: 0, concluidos: 0, totalSubtemas: 2 },
    ]);
  });

  it('CA-03: aluno2 (sem cronograma ativo) → 0/0/0 mesmo tendo marcado subtema; porDisciplina=[]', async () => {
    const res = await getEstatistica(
      aluno2Token,
      '/api/v1/estatisticas/progresso?porDisciplina=true',
    ).expect(200);
    expect(res.body as ProgressoBody).toEqual({
      percentual: 0,
      concluidos: 0,
      totalSubtemas: 0,
      porDisciplina: [],
    });
  });

  // -------------------------------------------------------------------------
  // Desempenho em questões — CA-05
  // -------------------------------------------------------------------------

  it('desempenho-questoes: totais com taxa derivada; agruparPor=disciplina e tema (total desc)', async () => {
    const totais = await getEstatistica(
      aluno1Token,
      '/api/v1/estatisticas/desempenho-questoes',
    ).expect(200);
    expect(totais.body as DesempenhoBody).toEqual({ total: 30, erros: 9, taxaErro: 0.3 });
    expect(totais.body).not.toHaveProperty('data');

    const porDisciplina = await getEstatistica(
      aluno1Token,
      '/api/v1/estatisticas/desempenho-questoes?agruparPor=disciplina',
    ).expect(200);
    expect((porDisciplina.body as DesempenhoBody).data).toEqual([
      { disciplinaId: discPortuguesId, nome: 'Português', total: 20, erros: 8, taxaErro: 0.4 },
      { disciplinaId: discMatematicaId, nome: 'Matemática', total: 10, erros: 1, taxaErro: 0.1 },
    ]);

    const porTema = await getEstatistica(
      aluno1Token,
      '/api/v1/estatisticas/desempenho-questoes?agruparPor=tema',
    ).expect(200);
    expect((porTema.body as DesempenhoBody).data).toEqual([
      { temaId: temaCraseId, nome: 'Crase', total: 20, erros: 8, taxaErro: 0.4 },
      { temaId: temaFracoesId, nome: 'Frações', total: 10, erros: 1, taxaErro: 0.1 },
    ]);
  });

  it('aluno3 sem registros: desempenho zerado; agruparPor devolve data:[]', async () => {
    const res = await getEstatistica(
      aluno3Token,
      '/api/v1/estatisticas/desempenho-questoes?agruparPor=disciplina',
    ).expect(200);
    expect(res.body as DesempenhoBody).toEqual({ total: 0, erros: 0, taxaErro: 0, data: [] });
  });

  // -------------------------------------------------------------------------
  // 422 — validações de query
  // -------------------------------------------------------------------------

  it('422: from > to na série e em horas-por-disciplina, com details em from', async () => {
    for (const rota of [
      '/api/v1/estatisticas/serie-temporal?from=2026-07-10&to=2026-07-09',
      '/api/v1/estatisticas/horas-por-disciplina?from=2026-07-10&to=2026-07-09',
    ]) {
      const res = await getEstatistica(aluno1Token, rota).expect(422);
      expectErrorEnvelope(res, 'VALIDATION_ERROR');
      expect(res.body.error.details).toEqual([
        expect.objectContaining({ field: 'from', issue: expect.stringContaining('posterior') }),
      ]);
    }
  });

  it('422: data de calendário inexistente (2026-02-30) e formato inválido (07/07/2026)', async () => {
    const invalida = await getEstatistica(
      aluno1Token,
      '/api/v1/estatisticas/serie-temporal?from=2026-02-30',
    ).expect(422);
    expectErrorEnvelope(invalida, 'VALIDATION_ERROR');
    expect(invalida.body.error.details).toEqual([
      expect.objectContaining({ field: 'from', issue: expect.stringContaining('calendário') }),
    ]);

    const emHoras = await getEstatistica(
      aluno1Token,
      '/api/v1/estatisticas/horas-por-disciplina?to=2026-02-30',
    ).expect(422);
    expectErrorEnvelope(emHoras, 'VALIDATION_ERROR');

    const malFormatada = await getEstatistica(
      aluno1Token,
      '/api/v1/estatisticas/serie-temporal?from=07/07/2026',
    ).expect(422);
    expectErrorEnvelope(malFormatada, 'VALIDATION_ERROR');
  });

  it('teto do intervalo da série (review ALTO): dia aceita 366 dias e rejeita 367; extremo 0001..9999 → 422 imediato', async () => {
    // 2025-07-01..2026-07-01 = 366 dias inclusivos (teto exato) → 200
    const noTeto = await getEstatistica(
      aluno1Token,
      '/api/v1/estatisticas/serie-temporal?granularidade=dia&from=2025-07-01&to=2026-07-01',
    ).expect(200);
    const noTetoBody = noTeto.body as SerieBody;
    expect(noTetoBody.data).toHaveLength(366);
    expect(noTetoBody.data[0].bucket).toBe('2025-07-01');
    expect(noTetoBody.data[365].bucket).toBe('2026-07-01');

    // 367 dias → 422 com details em from
    const estourado = await getEstatistica(
      aluno1Token,
      '/api/v1/estatisticas/serie-temporal?granularidade=dia&from=2025-06-30&to=2026-07-01',
    ).expect(422);
    expectErrorEnvelope(estourado, 'VALIDATION_ERROR');
    expect(estourado.body.error.details).toEqual([
      expect.objectContaining({ field: 'from', issue: expect.stringContaining('366') }),
    ]);

    // Extremo: sem o teto isso materializaria ~3,65 milhões de buckets
    const extremo = await getEstatistica(
      aluno1Token,
      '/api/v1/estatisticas/serie-temporal?from=0001-01-01&to=9999-12-31',
    ).expect(422);
    expectErrorEnvelope(extremo, 'VALIDATION_ERROR');
    expect(extremo.body.error.details).toEqual([expect.objectContaining({ field: 'from' })]);
  });

  it('teto do intervalo da série (semana): 3660 dias → 200 com 524 segundas; 3661 → 422', async () => {
    // 2016-06-24..2026-07-01 = 3660 dias inclusivos (teto exato da semana)
    const noTeto = await getEstatistica(
      aluno1Token,
      '/api/v1/estatisticas/serie-temporal?granularidade=semana&from=2016-06-24&to=2026-07-01',
    ).expect(200);
    const body = noTeto.body as SerieBody;
    expect(body.data).toHaveLength(524); // segundas de 2016-06-20 a 2026-06-29
    expect(body.data[0].bucket).toBe('2016-06-20');
    expect(body.data[523].bucket).toBe('2026-06-29');

    const estourado = await getEstatistica(
      aluno1Token,
      '/api/v1/estatisticas/serie-temporal?granularidade=semana&from=2016-06-23&to=2026-07-01',
    ).expect(422);
    expectErrorEnvelope(estourado, 'VALIDATION_ERROR');
    expect(estourado.body.error.details).toEqual([
      expect.objectContaining({ field: 'from', issue: expect.stringContaining('3660') }),
    ]);
  });

  it('422: granularidade inválida (hora), porDisciplina inválido (x/1) e agruparPor inválido', async () => {
    const granularidade = await getEstatistica(
      aluno1Token,
      '/api/v1/estatisticas/serie-temporal?granularidade=hora',
    ).expect(422);
    expectErrorEnvelope(granularidade, 'VALIDATION_ERROR');
    expect(granularidade.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'granularidade' })]),
    );

    for (const valor of ['x', '1']) {
      const res = await getEstatistica(
        aluno1Token,
        `/api/v1/estatisticas/progresso?porDisciplina=${valor}`,
      ).expect(422);
      expectErrorEnvelope(res, 'VALIDATION_ERROR');
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'porDisciplina' })]),
      );
    }

    const agruparPor = await getEstatistica(
      aluno1Token,
      '/api/v1/estatisticas/desempenho-questoes?agruparPor=assunto',
    ).expect(422);
    expectErrorEnvelope(agruparPor, 'VALIDATION_ERROR');
  });

  // -------------------------------------------------------------------------
  // Escopo por dono (CA-06): números de um aluno nunca vazam para outro
  // -------------------------------------------------------------------------

  it('CA-06: estatísticas são SEMPRE do aluno autenticado — números do aluno1 e aluno2 não se misturam', async () => {
    const doAluno1 = await getEstatistica(aluno1Token, '/api/v1/estatisticas/resumo').expect(200);
    const doAluno2 = await getEstatistica(aluno2Token, '/api/v1/estatisticas/resumo').expect(200);
    expect((doAluno1.body as ResumoBody).horasTotais).toBe(3);
    expect((doAluno2.body as ResumoBody).horasTotais).toBe(10);

    // Série do aluno2 na semana das sessões do aluno1: só a própria sessão (07-14)
    const serie2 = await getEstatistica(
      aluno2Token,
      '/api/v1/estatisticas/serie-temporal?from=2026-07-08&to=2026-07-14',
    ).expect(200);
    expect((serie2.body as SerieBody).data).toEqual([
      { bucket: '2026-07-08', horas: 0 },
      { bucket: '2026-07-09', horas: 0 },
      { bucket: '2026-07-10', horas: 0 },
      { bucket: '2026-07-11', horas: 0 },
      { bucket: '2026-07-12', horas: 0 },
      { bucket: '2026-07-13', horas: 0 },
      { bucket: '2026-07-14', horas: 10 }, // 600 min do aluno2 (09:00 local de 07-14)
    ]);
  });
});
