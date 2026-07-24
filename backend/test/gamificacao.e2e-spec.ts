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
import { RankingService } from '../src/modules/gamificacao/ranking.service';
import { PrismaService } from '../src/prisma/prisma.service';

// Banco DEDICADO de teste (guia_test) — nunca o banco de dev `guia`.
if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('localhost:5432/test')) {
  process.env.DATABASE_URL =
    'postgresql://guia:160402dbbba472cb61848717@localhost:5433/guia_test?schema=public';
}
if (!/guia_test/.test(process.env.DATABASE_URL)) {
  throw new Error(
    `E2E de gamificação exige banco guia_test (recebido: ${process.env.DATABASE_URL}). ` +
      'Nunca rode contra o banco de dev.',
  );
}

async function createApp(): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    // Tokens emitidos direto pelo TokenService (throttler de /auth limita
    // 5/min); guard neutralizado por segurança, como nos demais e2e.
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

/** Ordem respeita FKs: pontuações/sessões/registros → cronogramas → progresso → turmas → planos → users. */
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface RankingItem {
  posicao: number;
  alunoId: string;
  nome: string;
  pontos: number;
  subtemasConcluidos: number;
  horasEstudadas: number;
}

interface RankingBody {
  data: RankingItem[];
  page: number;
  pageSize: number;
  total: number;
}

interface MeBody {
  posicaoGlobal: number | null;
  pontos: number;
  subtemasConcluidos: number;
  horasEstudadas: number;
  semanasConsistentes: number;
  composicao: { pontosSubtemas: number; pontosHoras: number; pontosBonus: number };
  turmas: Array<{ turmaId: string; nome: string; posicao: number }>;
}

/**
 * Fixtures de constância na semana ISO seg 2026-07-06 → dom 2026-07-12,
 * America/Sao_Paulo (UTC-3 fixo). Duas sessões foram escolhidas para FALHAR
 * com contagem em UTC puro:
 * - qui 23:00 local = 2026-07-10T02:00Z (dia UTC = sexta 07-10);
 * - dom 23:00 local = 2026-07-13T02:00Z (dia E SEMANA UTC = segunda 07-13).
 * Local: {06,07,08,09,12} = 5 dias distintos → bônus. UTC: {06,07,08,10} na
 * semana + 07-13 na seguinte = 4 dias → sem bônus.
 */
const DIAS_ALUNO_A = [
  '2026-07-06T13:00:00Z', // seg 10:00 local
  '2026-07-07T13:00:00Z', // ter 10:00 local
  '2026-07-08T13:00:00Z', // qua 10:00 local
  '2026-07-10T02:00:00Z', // QUI 23:00 local (dia UTC = sexta)
  '2026-07-13T02:00:00Z', // DOM 23:00 local (dia/semana UTC = segunda seguinte)
];

/** alunoB: 4 dias distintos (seg–qui) — 5º e 6º dias são fim=null/soft-deleted. */
const DIAS_ALUNO_B = [
  '2026-07-06T13:00:00Z',
  '2026-07-07T13:00:00Z',
  '2026-07-08T13:00:00Z',
  '2026-07-09T13:00:00Z',
];

// Ids FIXOS (ordenados) para o desempate final por u.id asc do CA-02
const TIE_ID_1 = 'e1111111-1111-4111-8111-111111111111';
const TIE_ID_2 = 'e2222222-2222-4222-8222-222222222222';

describe('Gamificação / Ranking (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let rankingService: RankingService;
  let server: ReturnType<INestApplication['getHttpServer']>;

  const senha = 'senha-gamificacao-e2e';
  let adminToken: string;
  let moderadorToken: string;
  let professor1Token: string;
  let professor2Token: string;
  let professor1Id: string;
  let professor2Id: string;

  let alunoTopId: string;
  let alunoAId: string;
  let alunoBId: string;
  let alunoCId: string;
  let alunoTrancadoId: string;
  let alunoInativoId: string;
  let alunoNovoId: string;
  let alunoAToken: string;
  let alunoBToken: string;
  let alunoTrancadoToken: string;
  let alunoInativoToken: string;
  let alunoNovoToken: string;

  let disciplinaId: string;
  let subtemaIds: string[];
  let turmaAlfaId: string;
  let turmaBetaId: string;
  let turmaVaziaId: string;
  let turmaDeletadaId: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const getRanking = (token: string, rota: string) => request(server).get(rota).set(auth(token));

  const criarSessao = (
    alunoId: string,
    inicio: string,
    duracaoMin: number,
    extra: Record<string, unknown> = {},
  ) => {
    const inicioDate = new Date(inicio);
    return prisma.sessaoEstudo.create({
      data: {
        alunoId,
        disciplinaId,
        origem: 'MANUAL',
        inicio: inicioDate,
        fim: new Date(inicioDate.getTime() + duracaoMin * 60_000),
        duracaoMin,
        ...extra,
      },
    });
  };

  const concluirSubtemas = (alunoId: string, ids: string[]) =>
    prisma.progressoSubtema.createMany({
      data: ids.map((subtemaId) => ({
        alunoId,
        subtemaId,
        concluido: true,
        concluidoEm: new Date('2026-07-12T12:00:00Z'),
      })),
    });

  const pontuacaoDe = (alunoId: string) =>
    prisma.pontuacaoAluno.findUnique({ where: { alunoId } });

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    rankingService = app.get(RankingService);
    server = app.getHttpServer();
    await cleanDatabase(prisma);

    const senhaHash = await hashPassword(senha);
    const tokenService = app.get(TokenService);
    const criarUserComToken = async (
      nome: string,
      email: string,
      role: 'ADMIN' | 'MODERADOR' | 'PROFESSOR' | 'ALUNO',
      id?: string,
    ): Promise<{ id: string; token: string }> => {
      const user = await prisma.user.create({
        data: {
          ...(id ? { id } : {}),
          nome,
          email,
          senhaHash,
          role,
          status: 'ATIVO',
          origem: 'PROPRIO',
        },
      });
      return { id: user.id, token: await tokenService.signAccessToken(user) };
    };

    adminToken = (await criarUserComToken('Admin Rank', 'admin.rank@guia.test', 'ADMIN')).token;
    moderadorToken = (
      await criarUserComToken('Moderador Rank', 'mod.rank@guia.test', 'MODERADOR')
    ).token;
    const professor1 = await criarUserComToken('Prof Um', 'prof1.rank@guia.test', 'PROFESSOR');
    const professor2 = await criarUserComToken('Prof Dois', 'prof2.rank@guia.test', 'PROFESSOR');
    professor1Token = professor1.token;
    professor1Id = professor1.id;
    professor2Token = professor2.token;
    professor2Id = professor2.id;

    const alunoTop = await criarUserComToken('Aluno Top', 'top.rank@guia.test', 'ALUNO');
    const alunoA = await criarUserComToken('Aluno Alfa', 'a.rank@guia.test', 'ALUNO');
    const alunoB = await criarUserComToken('Aluno Beta', 'b.rank@guia.test', 'ALUNO');
    const alunoC = await criarUserComToken('Aluno Zerado', 'c.rank@guia.test', 'ALUNO');
    const alunoTrancado = await criarUserComToken(
      'Aluno Trancado',
      'trancado.rank@guia.test',
      'ALUNO',
    );
    const alunoInativo = await criarUserComToken(
      'Aluno Inativo',
      'inativo.rank@guia.test',
      'ALUNO',
    );
    alunoTopId = alunoTop.id;
    alunoAId = alunoA.id;
    alunoAToken = alunoA.token;
    alunoBId = alunoB.id;
    alunoBToken = alunoB.token;
    alunoCId = alunoC.id;
    alunoTrancadoId = alunoTrancado.id;
    alunoTrancadoToken = alunoTrancado.token;
    alunoInativoId = alunoInativo.id;
    alunoInativoToken = alunoInativo.token;

    // Árvore mínima de conteúdo (via Prisma: insumo, não alvo deste e2e)
    const plano = await prisma.plano.create({
      data: { titulo: 'Plano Ranking', tipo: 'OFICIAL', autorId: professor1Id, publicado: true },
    });
    const disciplina = await prisma.disciplina.create({
      data: { planoId: plano.id, nome: 'Português', ordem: 1 },
    });
    disciplinaId = disciplina.id;
    const tema = await prisma.tema.create({
      data: { disciplinaId, nome: 'Crase', ordem: 1 },
    });
    subtemaIds = [];
    for (let i = 1; i <= 6; i += 1) {
      const subtema = await prisma.subtema.create({
        data: { temaId: tema.id, nome: `Subtema ${i}`, ordem: i },
      });
      subtemaIds.push(subtema.id);
    }

    // Cronograma ATIVO do alunoA define o timezone das semanas consistentes
    await prisma.cronograma.create({
      data: {
        alunoId: alunoAId,
        planoId: plano.id,
        diasSemana: [1, 3, 5],
        janelas: [],
        horasSemanaTotal: 6,
        granularidadeMin: 60,
        timezone: 'America/Sao_Paulo',
        ativo: true,
      },
    });

    // ---- Turmas e matrículas -------------------------------------------------
    const criarTurma = (nome: string, professorId: string) =>
      prisma.turma.create({
        data: {
          nome,
          professorId,
          codigoConvite: `RK${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`,
        },
      });
    const turmaAlfa = await criarTurma('Turma Alfa', professor1Id);
    const turmaBeta = await criarTurma('Turma Beta', professor1Id);
    const turmaVazia = await criarTurma('Turma Vazia', professor2Id);
    const turmaDeletada = await criarTurma('Turma Deletada', professor1Id);
    await prisma.turma.update({
      where: { id: turmaDeletada.id },
      data: { deletedAt: new Date() },
    });
    turmaAlfaId = turmaAlfa.id;
    turmaBetaId = turmaBeta.id;
    turmaVaziaId = turmaVazia.id;
    turmaDeletadaId = turmaDeletada.id;

    await prisma.matricula.createMany({
      data: [
        { turmaId: turmaAlfaId, alunoId: alunoAId, status: 'ATIVA' },
        { turmaId: turmaAlfaId, alunoId: alunoBId, status: 'ATIVA' },
        { turmaId: turmaAlfaId, alunoId: alunoCId, status: 'ATIVA' },
        { turmaId: turmaAlfaId, alunoId: alunoInativoId, status: 'ATIVA' }, // user INATIVO depois
        { turmaId: turmaAlfaId, alunoId: alunoTrancadoId, status: 'INATIVA' }, // CA-04
        { turmaId: turmaBetaId, alunoId: alunoTopId, status: 'ATIVA' },
        { turmaId: turmaBetaId, alunoId: alunoAId, status: 'ATIVA' },
      ],
    });

    // ---- Atividade -----------------------------------------------------------
    // alunoA: 5 dias distintos LOCAIS na semana de 07-06 (60 min cada = 5h)
    for (const inicio of DIAS_ALUNO_A) {
      await criarSessao(alunoAId, inicio, 60);
    }
    // Na mesma semana: em andamento (sex) e soft-deleted (sáb) NÃO contam
    // como dia nem como horas — sem eles o bônus não muda (já são 5 dias).
    await criarSessao(alunoAId, '2026-07-10T13:00:00Z', 500, { fim: null, origem: 'CRONOMETRO' });
    await criarSessao(alunoAId, '2026-07-11T13:00:00Z', 777, { deletedAt: new Date() });
    await concluirSubtemas(alunoAId, [subtemaIds[0], subtemaIds[1]]);

    // alunoB: 4 dias reais; o 5º dia é fim=null e o 6º é soft-deleted — se
    // qualquer um contasse, ele ganharia o bônus indevidamente.
    for (const inicio of DIAS_ALUNO_B) {
      await criarSessao(alunoBId, inicio, 60);
    }
    await criarSessao(alunoBId, '2026-07-10T13:00:00Z', 60, { fim: null, origem: 'CRONOMETRO' });
    await criarSessao(alunoBId, '2026-07-11T13:00:00Z', 60, { deletedAt: new Date() });
    await concluirSubtemas(alunoBId, [subtemaIds[0]]);

    // alunoTop: volume num único dia (sem constância): 10h + 5 subtemas = 100
    await criarSessao(alunoTopId, '2026-07-14T13:00:00Z', 600);
    await concluirSubtemas(alunoTopId, subtemaIds.slice(0, 5));

    // alunoTrancado: 2h = 10 pontos (entra no global, fora da Turma Alfa)
    await criarSessao(alunoTrancadoId, '2026-07-14T13:00:00Z', 120);

    // alunoInativo: 1h + 1 subtema = 15 pontos (recomputado ANTES de inativar)
    await criarSessao(alunoInativoId, '2026-07-14T13:00:00Z', 60);
    await concluirSubtemas(alunoInativoId, [subtemaIds[5]]);
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  // -------------------------------------------------------------------------
  // Recomputação (CA-01, CA-07, RN-05) — fórmula com dados reais
  // -------------------------------------------------------------------------

  it('recomputarTodos() calcula a fórmula com dados reais; 23h local conta no dia LOCAL (falharia em UTC)', async () => {
    const total = await rankingService.recomputarTodos();
    expect(total).toBe(6); // Top, A, B, C, Trancado, Inativo (ainda ATIVO)

    // alunoA: 2 subtemas (20) + 5h (25) + 1 semana consistente (50) = 95.
    // O bônus SÓ existe porque qui/dom 23:00 locais contam nos dias locais.
    const pontA = await pontuacaoDe(alunoAId);
    expect(pontA).toMatchObject({ pontos: 95, subtemasConcluidos: 2 });
    expect(Number(pontA!.horasEstudadas)).toBe(5);

    // alunoB: 4 dias distintos (fim=null e soft-deleted NÃO contam) → sem
    // bônus: 1 subtema (10) + 4h (20) = 30.
    const pontB = await pontuacaoDe(alunoBId);
    expect(pontB).toMatchObject({ pontos: 30, subtemasConcluidos: 1 });
    expect(Number(pontB!.horasEstudadas)).toBe(4);

    // alunoTop: 5 subtemas (50) + 10h num único dia (50) + 0 semanas = 100
    expect(await pontuacaoDe(alunoTopId)).toMatchObject({ pontos: 100, subtemasConcluidos: 5 });
    // alunoTrancado: 2h = 10; alunoInativo: 1h + 1 subtema = 15; alunoC: 0
    expect(await pontuacaoDe(alunoTrancadoId)).toMatchObject({ pontos: 10 });
    expect(await pontuacaoDe(alunoInativoId)).toMatchObject({ pontos: 15, subtemasConcluidos: 1 });
    expect(await pontuacaoDe(alunoCId)).toMatchObject({
      pontos: 0,
      subtemasConcluidos: 0,
    });
  });

  it('CA-07 + idempotência: 2ª execução mantém os pontos e avança atualizado_em; INATIVO fica intocado (RN-05)', async () => {
    // Inativa o aluno DEPOIS da 1ª recomputação (agregado já materializado)
    await prisma.user.update({ where: { id: alunoInativoId }, data: { status: 'INATIVO' } });

    const antes = new Map(
      (await prisma.pontuacaoAluno.findMany({})).map((p) => [p.alunoId, p]),
    );
    await delay(25);

    const total = await rankingService.recomputarTodos();
    expect(total).toBe(5); // sem o INATIVO

    const depois = new Map(
      (await prisma.pontuacaoAluno.findMany({})).map((p) => [p.alunoId, p]),
    );
    for (const alunoId of [alunoTopId, alunoAId, alunoBId, alunoCId, alunoTrancadoId]) {
      // Idempotente: mesmos dados → mesmos pontos (CA-01)
      expect(depois.get(alunoId)!.pontos).toBe(antes.get(alunoId)!.pontos);
      expect(depois.get(alunoId)!.subtemasConcluidos).toBe(antes.get(alunoId)!.subtemasConcluidos);
      // CA-07: atualizado_em reflete o último cálculo mesmo sem mudança
      expect(depois.get(alunoId)!.atualizadoEm.getTime()).toBeGreaterThan(
        antes.get(alunoId)!.atualizadoEm.getTime(),
      );
    }
    // RN-05: registro do INATIVO PRESERVADO e não recomputado
    expect(depois.get(alunoInativoId)).toMatchObject({ pontos: 15 });
    expect(depois.get(alunoInativoId)!.atualizadoEm.getTime()).toBe(
      antes.get(alunoInativoId)!.atualizadoEm.getTime(),
    );
  });

  it('recomputarAluno: incremental idempotente para ATIVO; NO-OP para INATIVO', async () => {
    const topAntes = await pontuacaoDe(alunoTopId);
    await delay(25);
    await rankingService.recomputarAluno(alunoTopId);
    const topDepois = await pontuacaoDe(alunoTopId);
    expect(topDepois).toMatchObject({ pontos: 100, subtemasConcluidos: 5 });
    expect(topDepois!.atualizadoEm.getTime()).toBeGreaterThan(topAntes!.atualizadoEm.getTime());

    const inativoAntes = await pontuacaoDe(alunoInativoId);
    await rankingService.recomputarAluno(alunoInativoId);
    const inativoDepois = await pontuacaoDe(alunoInativoId);
    expect(inativoDepois!.atualizadoEm.getTime()).toBe(inativoAntes!.atualizadoEm.getTime());
    expect(inativoDepois!.pontos).toBe(15);
  });

  it('setup: alunoNovo matriculado APÓS a recomputação (sem registro de pontuação)', async () => {
    const senhaHash = await hashPassword(senha);
    const user = await prisma.user.create({
      data: {
        nome: 'Aluno Novo',
        email: 'novo.rank@guia.test',
        senhaHash,
        role: 'ALUNO',
        status: 'ATIVO',
        origem: 'PROPRIO',
      },
    });
    alunoNovoId = user.id;
    alunoNovoToken = await app.get(TokenService).signAccessToken(user);
    await prisma.matricula.create({
      data: { turmaId: turmaAlfaId, alunoId: alunoNovoId, status: 'ATIVA' },
    });
    expect(await pontuacaoDe(alunoNovoId)).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Ranking global (CA-02, CA-03, RN-05, casos de borda)
  // -------------------------------------------------------------------------

  it('global: ordenado por pontos desc; INATIVO omitido; ATIVO sem registro aparece 0/0/0 no FIM (null por último)', async () => {
    const res = await getRanking(alunoAToken, '/api/v1/ranking/global?pageSize=100').expect(200);
    const body = res.body as RankingBody;

    expect(body).toMatchObject({ page: 1, pageSize: 100, total: 6 });
    expect(body.data).toEqual([
      { posicao: 1, alunoId: alunoTopId, nome: 'Aluno Top', pontos: 100, subtemasConcluidos: 5, horasEstudadas: 10 },
      { posicao: 2, alunoId: alunoAId, nome: 'Aluno Alfa', pontos: 95, subtemasConcluidos: 2, horasEstudadas: 5 },
      { posicao: 3, alunoId: alunoBId, nome: 'Aluno Beta', pontos: 30, subtemasConcluidos: 1, horasEstudadas: 4 },
      { posicao: 4, alunoId: alunoTrancadoId, nome: 'Aluno Trancado', pontos: 10, subtemasConcluidos: 0, horasEstudadas: 2 },
      // Empate 0×0: quem TEM registro (atualizado_em) vem antes do sem registro (null por último)
      { posicao: 5, alunoId: alunoCId, nome: 'Aluno Zerado', pontos: 0, subtemasConcluidos: 0, horasEstudadas: 0 },
      { posicao: 6, alunoId: alunoNovoId, nome: 'Aluno Novo', pontos: 0, subtemasConcluidos: 0, horasEstudadas: 0 },
    ]);
    // RN-05: INATIVO omitido (registro preservado na tabela, testado acima)
    expect(body.data.map((i) => i.alunoId)).not.toContain(alunoInativoId);
  });

  it('global é acessível a QUALQUER autenticado (aluno, professor, admin); sem token → 401', async () => {
    for (const token of [alunoAToken, professor1Token, adminToken]) {
      const res = await getRanking(token, '/api/v1/ranking/global').expect(200);
      expect((res.body as RankingBody).total).toBe(6);
    }
    const semToken = await request(server).get('/api/v1/ranking/global').expect(401);
    expectErrorEnvelope(semToken, 'UNAUTHENTICATED');
  });

  it('CA-03: paginação com posicao CONTÍNUA entre páginas (pageSize=2 → página 2 começa em 3)', async () => {
    const p2 = await getRanking(alunoAToken, '/api/v1/ranking/global?page=2&pageSize=2').expect(200);
    expect(p2.body as RankingBody).toMatchObject({ page: 2, pageSize: 2, total: 6 });
    expect((p2.body as RankingBody).data.map((i) => [i.posicao, i.alunoId])).toEqual([
      [3, alunoBId],
      [4, alunoTrancadoId],
    ]);

    const p3 = await getRanking(alunoAToken, '/api/v1/ranking/global?page=3&pageSize=2').expect(200);
    expect((p3.body as RankingBody).data.map((i) => [i.posicao, i.alunoId])).toEqual([
      [5, alunoCId],
      [6, alunoNovoId],
    ]);
  });

  it('caso de borda: pageSize=101 → CLAMPADO a 100 (200, não 422); pageSize=0/não-inteiro → 422', async () => {
    const clampado = await getRanking(
      alunoAToken,
      '/api/v1/ranking/global?pageSize=101',
    ).expect(200);
    expect(clampado.body as RankingBody).toMatchObject({ page: 1, pageSize: 100, total: 6 });

    for (const invalido of ['0', 'abc', '2.5']) {
      const res = await getRanking(
        alunoAToken,
        `/api/v1/ranking/global?pageSize=${invalido}`,
      ).expect(422);
      expectErrorEnvelope(res, 'VALIDATION_ERROR');
    }
  });

  // -------------------------------------------------------------------------
  // Ranking por turma (CA-04, CA-05)
  // -------------------------------------------------------------------------

  it('CA-04: Turma Alfa só com matrículas ATIVAS de users ATIVOS — Trancado (matrícula INATIVA) e Inativo fora', async () => {
    const res = await getRanking(alunoAToken, `/api/v1/ranking/turmas/${turmaAlfaId}`).expect(200);
    const body = res.body as RankingBody;

    expect(body).toMatchObject({ page: 1, pageSize: 20, total: 4 });
    expect(body.data.map((i) => [i.posicao, i.alunoId, i.pontos])).toEqual([
      [1, alunoAId, 95],
      [2, alunoBId, 30],
      [3, alunoCId, 0],
      [4, alunoNovoId, 0],
    ]);
  });

  it('mesmo agregado, posição por pares: alunoA é 1º na Turma Alfa e 2º na Turma Beta', async () => {
    const res = await getRanking(alunoAToken, `/api/v1/ranking/turmas/${turmaBetaId}`).expect(200);
    const body = res.body as RankingBody;
    expect(body.total).toBe(2);
    expect(body.data.map((i) => [i.posicao, i.alunoId])).toEqual([
      [1, alunoTopId],
      [2, alunoAId],
    ]);
  });

  it('CA-05: aluno sem matrícula ATIVA na turma → 403 (sem matrícula E matrícula INATIVA)', async () => {
    const semMatricula = await getRanking(
      alunoBToken,
      `/api/v1/ranking/turmas/${turmaBetaId}`,
    ).expect(403);
    expectErrorEnvelope(semMatricula, 'FORBIDDEN');

    const matriculaInativa = await getRanking(
      alunoTrancadoToken,
      `/api/v1/ranking/turmas/${turmaAlfaId}`,
    ).expect(403);
    expectErrorEnvelope(matriculaInativa, 'FORBIDDEN');
  });

  it('CA-05: professor da turma acessa; professor de OUTRA turma → 403; ADMIN/MODERADOR leem qualquer turma', async () => {
    await getRanking(professor1Token, `/api/v1/ranking/turmas/${turmaAlfaId}`).expect(200);

    const outroProfessor = await getRanking(
      professor2Token,
      `/api/v1/ranking/turmas/${turmaAlfaId}`,
    ).expect(403);
    expectErrorEnvelope(outroProfessor, 'FORBIDDEN');

    // Precedente do TurmasAccessService: moderação (ADMIN/MODERADOR) lê qualquer turma
    await getRanking(adminToken, `/api/v1/ranking/turmas/${turmaAlfaId}`).expect(200);
    await getRanking(moderadorToken, `/api/v1/ranking/turmas/${turmaAlfaId}`).expect(200);
  });

  it('turma sem alunos ativos → data: [] e total: 0', async () => {
    const res = await getRanking(professor2Token, `/api/v1/ranking/turmas/${turmaVaziaId}`).expect(
      200,
    );
    expect(res.body as RankingBody).toEqual({ data: [], page: 1, pageSize: 20, total: 0 });
  });

  it('turma soft-deleted ou inexistente → 404; id não-UUID → 422 (precedente de turmas)', async () => {
    const deletada = await getRanking(
      professor1Token,
      `/api/v1/ranking/turmas/${turmaDeletadaId}`,
    ).expect(404);
    expectErrorEnvelope(deletada, 'NOT_FOUND');

    const inexistente = await getRanking(
      professor1Token,
      `/api/v1/ranking/turmas/${randomUUID()}`,
    ).expect(404);
    expectErrorEnvelope(inexistente, 'NOT_FOUND');

    const malformado = await getRanking(
      professor1Token,
      '/api/v1/ranking/turmas/nao-uuid',
    ).expect(422);
    expectErrorEnvelope(malformado, 'VALIDATION_ERROR');
  });

  // -------------------------------------------------------------------------
  // /ranking/me (CA-06)
  // -------------------------------------------------------------------------

  it('CA-06: /me do alunoA — posição global + posições POR TURMA distintas + composição da pontuação', async () => {
    const res = await getRanking(alunoAToken, '/api/v1/ranking/me').expect(200);

    expect(res.body as MeBody).toEqual({
      posicaoGlobal: 2,
      pontos: 95,
      subtemasConcluidos: 2,
      horasEstudadas: 5,
      semanasConsistentes: 1,
      composicao: { pontosSubtemas: 20, pontosHoras: 25, pontosBonus: 50 },
      turmas: [
        { turmaId: turmaAlfaId, nome: 'Turma Alfa', posicao: 1 },
        { turmaId: turmaBetaId, nome: 'Turma Beta', posicao: 2 },
      ],
    });
  });

  it('/me do alunoNovo (ATIVO sem registro): posição REAL no fim do ranking com tudo 0', async () => {
    const res = await getRanking(alunoNovoToken, '/api/v1/ranking/me').expect(200);
    expect(res.body as MeBody).toEqual({
      posicaoGlobal: 6,
      pontos: 0,
      subtemasConcluidos: 0,
      horasEstudadas: 0,
      semanasConsistentes: 0,
      composicao: { pontosSubtemas: 0, pontosHoras: 0, pontosBonus: 0 },
      turmas: [{ turmaId: turmaAlfaId, nome: 'Turma Alfa', posicao: 4 }],
    });
  });

  it('/me de aluno INATIVO (token ainda válido): fora do conjunto → posicaoGlobal null e turmas []', async () => {
    const res = await getRanking(alunoInativoToken, '/api/v1/ranking/me').expect(200);
    expect(res.body as MeBody).toEqual({
      posicaoGlobal: null,
      pontos: 0,
      subtemasConcluidos: 0,
      horasEstudadas: 0,
      semanasConsistentes: 0,
      composicao: { pontosSubtemas: 0, pontosHoras: 0, pontosBonus: 0 },
      turmas: [],
    });
  });

  it('/me é exclusivo de ALUNO: professor e admin → 403; sem token → 401', async () => {
    for (const token of [professor1Token, adminToken]) {
      const res = await getRanking(token, '/api/v1/ranking/me').expect(403);
      expectErrorEnvelope(res, 'FORBIDDEN');
    }
    const semToken = await request(server).get('/api/v1/ranking/me').expect(401);
    expectErrorEnvelope(semToken, 'UNAUTHENTICATED');
  });

  // -------------------------------------------------------------------------
  // Desempate CA-02 com agregados materializados controlados (RN-06)
  // -------------------------------------------------------------------------

  it('CA-02: empate em pontos → subtemas desc → atualizado_em asc → id asc (lido SÓ do agregado, RN-06)', async () => {
    const senhaHash = await hashPassword(senha);
    const criarTie = async (nome: string, email: string, id?: string): Promise<string> => {
      const user = await prisma.user.create({
        data: {
          ...(id ? { id } : {}),
          nome,
          email,
          senhaHash,
          role: 'ALUNO',
          status: 'ATIVO',
          origem: 'PROPRIO',
        },
      });
      return user.id;
    };
    const tieMaisSubtemas = await criarTie('Tie Subtemas', 'tie.subtemas@guia.test');
    const tieCedo = await criarTie('Tie Cedo', 'tie.cedo@guia.test');
    const tieTarde = await criarTie('Tie Tarde', 'tie.tarde@guia.test');
    await criarTie('Tie Id 1', 'tie.id1@guia.test', TIE_ID_1);
    await criarTie('Tie Id 2', 'tie.id2@guia.test', TIE_ID_2);

    // Agregados materializados direto (RN-06: a leitura NUNCA recalcula — os
    // alunos não têm nenhuma sessão/subtema e ainda assim rankeiam por aqui)
    const inserirPontuacao = (
      alunoId: string,
      subtemasConcluidos: number,
      atualizadoEm: string,
    ) =>
      prisma.pontuacaoAluno.create({
        data: {
          alunoId,
          pontos: 60,
          subtemasConcluidos,
          horasEstudadas: '0.00',
          atualizadoEm: new Date(atualizadoEm),
        },
      });
    await inserirPontuacao(tieMaisSubtemas, 6, '2026-07-20T12:00:00Z');
    await inserirPontuacao(tieCedo, 5, '2026-07-20T10:00:00Z'); // chegou primeiro
    await inserirPontuacao(tieTarde, 5, '2026-07-20T11:00:00Z');
    await inserirPontuacao(TIE_ID_1, 5, '2026-07-20T11:30:00Z'); // empate TOTAL → id asc
    await inserirPontuacao(TIE_ID_2, 5, '2026-07-20T11:30:00Z');

    const res = await getRanking(alunoAToken, '/api/v1/ranking/global?pageSize=100').expect(200);
    const body = res.body as RankingBody;
    expect(body.total).toBe(11);

    // Bloco dos 60 pontos: posições 3–7 na ordem exata do desempate
    const bloco60 = body.data.filter((i) => i.pontos === 60);
    expect(bloco60.map((i) => [i.posicao, i.alunoId])).toEqual([
      [3, tieMaisSubtemas], // + subtemas vence
      [4, tieCedo], // atualizado_em mais antigo na frente
      [5, tieTarde],
      [6, TIE_ID_1], // empate total → id asc
      [7, TIE_ID_2],
    ]);
    // E o restante desloca de forma contínua: Top(1), A(2), bloco 60 (3–7),
    // B(8), Trancado(9), C(10), Novo(11)
    expect(body.data.map((i) => i.alunoId).slice(0, 2)).toEqual([alunoTopId, alunoAId]);
    expect([body.data[7].posicao, body.data[7].alunoId]).toEqual([8, alunoBId]);
    expect([body.data[8].posicao, body.data[8].alunoId]).toEqual([9, alunoTrancadoId]);
    expect([body.data[10].posicao, body.data[10].alunoId]).toEqual([11, alunoNovoId]);
  });
});
