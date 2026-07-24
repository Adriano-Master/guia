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
    `E2E de cronograma exige banco guia_test (recebido: ${process.env.DATABASE_URL}). ` +
      'Nunca rode contra o banco de dev.',
  );
}

const TZ = 'America/Sao_Paulo';
const SP_OFFSET_MIN = 180; // UTC-3 fixo (sem DST desde 2019)

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

/** Ordem respeita FKs: blocos/cronogramas → progresso → planos (cascata) → users. */
async function cleanDatabase(prisma: PrismaService): Promise<void> {
  await prisma.blocoCronograma.deleteMany({});
  await prisma.cronograma.deleteMany({});
  await prisma.progressoSubtema.deleteMany({});
  await prisma.turmaPlano.deleteMany({});
  await prisma.matricula.deleteMany({});
  await prisma.turma.deleteMany({});
  await prisma.plano.deleteMany({});
  await prisma.user.deleteMany({});
}

interface BlocoDto {
  id: string;
  cronogramaId: string;
  disciplinaId: string;
  subtemaId: string | null;
  inicio: string;
  fim: string;
  duracaoMin: number;
  status: string;
}

/** minutos locais (São Paulo) desde 00:00 do dia do instante UTC dado */
function minutosLocais(iso: string): number {
  const d = new Date(iso);
  return (((d.getUTCHours() * 60 + d.getUTCMinutes() - SP_OFFSET_MIN) % 1440) + 1440) % 1440;
}

/** dia da semana local em São Paulo */
function weekdayLocal(iso: string): number {
  const d = new Date(new Date(iso).getTime() - SP_OFFSET_MIN * 60_000);
  return d.getUTCDay();
}

/**
 * Dias do padrão canônico, rotacionados para NUNCA incluir "hoje" no TZ do
 * aluno: desde a correção do review (item 3), janelas de HOJE cujo fim já
 * passou não são materializadas na semana 0 — com dias fixos [1,3,5] a
 * contagem de blocos dependeria do dia/hora em que a suíte roda.
 */
const HOJE_SP = weekdayLocal(new Date().toISOString());
const DIAS_CANONICOS = [1, 3, 5].map((d) => (HOJE_SP + d) % 7).sort((a, b) => a - b);

describe('Cronograma e Calendário (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const senha = 'senha-cronograma-e2e';
  let professorToken: string;
  let aluno1Token: string;
  let aluno2Token: string;
  let aluno1Id: string;
  let professorId: string;

  let oficialId: string; // plano canônico publicado (30/20/20/30)
  let rascunhoId: string; // OFICIAL não publicado
  let pessoalVazioAluno2Id: string; // PESSOAL sem disciplinas
  let pessoalPesoQuebradoId: string; // PESSOAL do aluno2 com Σ pesos ≠ 100 (via DB)

  let discPortuguesId: string;
  let discMatematicaId: string;
  let discInformaticaId: string;
  let discDireitoId: string;

  // Subtemas de Português na ordem pedagógica esperada (tema.ordem, subtema.ordem)
  let subProcliseId: string; // tema 1, ordem 1
  let subMesocliseId: string; // tema 1, ordem 2
  let subEncliseId: string; // tema 1, ordem 3
  let subCoesaoId: string; // tema 2, ordem 1
  let subCoerenciaId: string; // tema 2, ordem 2

  let cronograma1Id: string;
  let blocosCronograma1: BlocoDto[];
  let cronograma2Id: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  function bodyCanonico(overrides: Record<string, unknown> = {}) {
    const dias = DIAS_CANONICOS;
    return {
      planoId: oficialId,
      diasSemana: dias,
      janelas: dias.flatMap((dia) => [
        { dia, inicio: '08:00', fim: '10:00' },
        { dia, inicio: '14:00', fim: '16:00' },
      ]),
      granularidadeMin: 60,
      timezone: TZ,
      ...overrides,
    };
  }

  function minutosDe(blocos: BlocoDto[], disciplinaId: string): number {
    return blocos
      .filter((b) => b.disciplinaId === disciplinaId)
      .reduce((acc, b) => acc + b.duracaoMin, 0);
  }

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    await cleanDatabase(prisma);

    const senhaHash = await hashPassword(senha);
    const professor = await prisma.user.create({
      data: {
        nome: 'Professor Cronograma',
        email: 'professor.cronograma@guia.test',
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
        email: 'aluno1.cronograma@guia.test',
        senhaHash,
        role: 'ALUNO',
        status: 'ATIVO',
        origem: 'PROPRIO',
      },
    });
    aluno1Id = aluno1.id;
    await prisma.user.create({
      data: {
        nome: 'Aluno Dois',
        email: 'aluno2.cronograma@guia.test',
        senhaHash,
        role: 'ALUNO',
        status: 'ATIVO',
        origem: 'PROPRIO',
      },
    });

    const server = app.getHttpServer();
    const login = async (email: string): Promise<string> => {
      const res = await request(server)
        .post('/api/v1/auth/login')
        .send({ email, senha })
        .expect(200);
      return res.body.accessToken as string;
    };
    professorToken = await login('professor.cronograma@guia.test');
    aluno1Token = await login('aluno1.cronograma@guia.test');
    aluno2Token = await login('aluno2.cronograma@guia.test');
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  // -------------------------------------------------------------------------
  // Setup do plano canônico do design (via API, como o professor faria)
  // -------------------------------------------------------------------------

  it('setup: professor monta e publica o plano do exemplo numérico (30/20/20/30)', async () => {
    const server = app.getHttpServer();

    const plano = await request(server)
      .post('/api/v1/planos')
      .set(auth(professorToken))
      .send({ titulo: 'Analista TRF', tipo: 'OFICIAL' })
      .expect(201);
    oficialId = plano.body.plano.id;

    const criarDisciplina = async (nome: string, ordem: number): Promise<string> => {
      const res = await request(server)
        .post(`/api/v1/planos/${oficialId}/disciplinas`)
        .set(auth(professorToken))
        .send({ nome, ordem })
        .expect(201);
      return res.body.disciplina.id as string;
    };
    discPortuguesId = await criarDisciplina('Português', 1);
    discMatematicaId = await criarDisciplina('Matemática', 2);
    discInformaticaId = await criarDisciplina('Informática', 3);
    discDireitoId = await criarDisciplina('Direito', 4);

    // Temas de Português criados FORA de ordem (ordem 2 antes da 1), para
    // validar que a fila segue tema.ordem e não a ordem de criação.
    const temaInterpretacao = await request(server)
      .post(`/api/v1/disciplinas/${discPortuguesId}/temas`)
      .set(auth(professorToken))
      .send({ nome: 'Interpretação de texto', ordem: 2 })
      .expect(201);
    const temaColocacao = await request(server)
      .post(`/api/v1/disciplinas/${discPortuguesId}/temas`)
      .set(auth(professorToken))
      .send({ nome: 'Colocação pronominal', ordem: 1 })
      .expect(201);
    const temaColocacaoId = temaColocacao.body.tema.id as string;
    const temaInterpretacaoId = temaInterpretacao.body.tema.id as string;

    const criarSubtema = async (temaId: string, nome: string, ordem: number): Promise<string> => {
      const res = await request(server)
        .post(`/api/v1/temas/${temaId}/subtemas`)
        .set(auth(professorToken))
        .send({ nome, ordem })
        .expect(201);
      return res.body.subtema.id as string;
    };
    // Subtemas também fora de ordem de criação
    subMesocliseId = await criarSubtema(temaColocacaoId, 'Mesóclise', 2);
    subProcliseId = await criarSubtema(temaColocacaoId, 'Próclise', 1);
    subEncliseId = await criarSubtema(temaColocacaoId, 'Ênclise', 3);
    subCoerenciaId = await criarSubtema(temaInterpretacaoId, 'Coerência', 2);
    subCoesaoId = await criarSubtema(temaInterpretacaoId, 'Coesão', 1);

    await request(server)
      .put(`/api/v1/planos/${oficialId}/pesos`)
      .set(auth(professorToken))
      .send({
        pesos: [
          { disciplinaId: discPortuguesId, pesoPercentual: 30 },
          { disciplinaId: discMatematicaId, pesoPercentual: 20 },
          { disciplinaId: discInformaticaId, pesoPercentual: 20 },
          { disciplinaId: discDireitoId, pesoPercentual: 30 },
        ],
      })
      .expect(200);

    await request(server)
      .post(`/api/v1/planos/${oficialId}/publicar`)
      .set(auth(professorToken))
      .expect(200);

    // Regra de matrícula: aluno1 lê o OFICIAL via turma + matrícula ATIVA
    await vincularPlanoAAlunos(prisma, { planoId: oficialId, professorId, alunoIds: [aluno1Id] });

    // Plano OFICIAL rascunho (não publicado) para o caso 403
    const rascunho = await request(server)
      .post('/api/v1/planos')
      .set(auth(professorToken))
      .send({ titulo: 'Rascunho Cronograma', tipo: 'OFICIAL' })
      .expect(201);
    rascunhoId = rascunho.body.plano.id;

    // PESSOAL vazio do aluno2 para o caso 422 "plano sem disciplinas"
    const vazio = await request(server)
      .post('/api/v1/planos')
      .set(auth(aluno2Token))
      .send({ titulo: 'Plano vazio', tipo: 'PESSOAL' })
      .expect(201);
    pessoalVazioAluno2Id = vazio.body.plano.id;
  });

  // -------------------------------------------------------------------------
  // Autenticação e autorização das rotas
  // -------------------------------------------------------------------------

  it('sem token: POST /cronogramas e GET /cronogramas/ativo → 401 UNAUTHENTICATED', async () => {
    const post = await request(app.getHttpServer())
      .post('/api/v1/cronogramas')
      .send(bodyCanonico())
      .expect(401);
    expectErrorEnvelope(post, 'UNAUTHENTICATED');

    const get = await request(app.getHttpServer()).get('/api/v1/cronogramas/ativo').expect(401);
    expectErrorEnvelope(get, 'UNAUTHENTICATED');
  });

  it('professor (não-aluno) tenta gerar cronograma → 403 FORBIDDEN', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/cronogramas')
      .set(auth(professorToken))
      .send(bodyCanonico())
      .expect(403);
    expectErrorEnvelope(res, 'FORBIDDEN');
  });

  it('GET /cronogramas/ativo sem cronograma gerado → 404 NOT_FOUND', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/cronogramas/ativo')
      .set(auth(aluno1Token))
      .expect(404);
    expectErrorEnvelope(res, 'NOT_FOUND');
  });

  it('POST com planoId inexistente → 404; plano rascunho → 403; PESSOAL alheio → 403', async () => {
    const inexistente = await request(app.getHttpServer())
      .post('/api/v1/cronogramas')
      .set(auth(aluno1Token))
      .send(bodyCanonico({ planoId: randomUUID() }))
      .expect(404);
    expectErrorEnvelope(inexistente, 'NOT_FOUND');

    const rascunho = await request(app.getHttpServer())
      .post('/api/v1/cronogramas')
      .set(auth(aluno1Token))
      .send(bodyCanonico({ planoId: rascunhoId }))
      .expect(403);
    expectErrorEnvelope(rascunho, 'FORBIDDEN');

    const alheio = await request(app.getHttpServer())
      .post('/api/v1/cronogramas')
      .set(auth(aluno1Token))
      .send(bodyCanonico({ planoId: pessoalVazioAluno2Id }))
      .expect(403);
    expectErrorEnvelope(alheio, 'FORBIDDEN');
  });

  // -------------------------------------------------------------------------
  // Validações 422
  // -------------------------------------------------------------------------

  it('plano próprio sem disciplinas/pesos → 422 (regra de bloqueio da geração)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/cronogramas')
      .set(auth(aluno2Token))
      .send(bodyCanonico({ planoId: pessoalVazioAluno2Id }))
      .expect(422);
    expectErrorEnvelope(res, 'VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([
      { field: 'planoId', issue: 'plano deve ter disciplinas com pesos definidos' },
    ]);
  });

  it('Σ pesos ≠ 100 no banco → 422 "soma deve ser 100"', async () => {
    // Monta um plano válido do aluno2 e quebra o peso direto no banco (o PUT
    // /pesos jamais aceitaria ≠ 100).
    const server = app.getHttpServer();
    const plano = await request(server)
      .post('/api/v1/planos')
      .set(auth(aluno2Token))
      .send({ titulo: 'Peso quebrado', tipo: 'PESSOAL' })
      .expect(201);
    pessoalPesoQuebradoId = plano.body.plano.id;
    const disc = await request(server)
      .post(`/api/v1/planos/${pessoalPesoQuebradoId}/disciplinas`)
      .set(auth(aluno2Token))
      .send({ nome: 'Solo', ordem: 1 })
      .expect(201);
    await request(server)
      .put(`/api/v1/planos/${pessoalPesoQuebradoId}/pesos`)
      .set(auth(aluno2Token))
      .send({ pesos: [{ disciplinaId: disc.body.disciplina.id, pesoPercentual: 100 }] })
      .expect(200);
    await prisma.pesoDisciplina.updateMany({
      where: { planoId: pessoalPesoQuebradoId },
      data: { pesoPercentual: '99.99' },
    });

    const res = await request(server)
      .post('/api/v1/cronogramas')
      .set(auth(aluno2Token))
      .send(bodyCanonico({ planoId: pessoalPesoQuebradoId }))
      .expect(422);
    expectErrorEnvelope(res, 'VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([
      { field: 'pesoPercentual', issue: 'soma deve ser 100' },
    ]);
  });

  it('janelas inválidas → 422 (menor que granularidade, fim ≤ início, sobreposição, dia fora de diasSemana)', async () => {
    const server = app.getHttpServer();

    const curta = await request(server)
      .post('/api/v1/cronogramas')
      .set(auth(aluno1Token))
      .send(
        bodyCanonico({ diasSemana: [1], janelas: [{ dia: 1, inicio: '08:00', fim: '08:30' }] }),
      )
      .expect(422);
    expectErrorEnvelope(curta, 'VALIDATION_ERROR');
    expect(curta.body.error.details).toEqual([
      expect.objectContaining({ field: 'janelas.0', issue: expect.stringContaining('granularidade') }),
    ]);

    const invertida = await request(server)
      .post('/api/v1/cronogramas')
      .set(auth(aluno1Token))
      .send(
        bodyCanonico({ diasSemana: [1], janelas: [{ dia: 1, inicio: '10:00', fim: '08:00' }] }),
      )
      .expect(422);
    expect(invertida.body.error.details).toEqual([
      { field: 'janelas.0', issue: 'fim deve ser maior que inicio' },
    ]);

    const sobrepostas = await request(server)
      .post('/api/v1/cronogramas')
      .set(auth(aluno1Token))
      .send(
        bodyCanonico({
          diasSemana: [1],
          janelas: [
            { dia: 1, inicio: '08:00', fim: '10:00' },
            { dia: 1, inicio: '09:00', fim: '11:00' },
          ],
        }),
      )
      .expect(422);
    expect(sobrepostas.body.error.details).toEqual([
      { field: 'janelas.1', issue: 'janelas do mesmo dia não podem se sobrepor' },
    ]);

    const diaFora = await request(server)
      .post('/api/v1/cronogramas')
      .set(auth(aluno1Token))
      .send(
        bodyCanonico({ diasSemana: [1], janelas: [{ dia: 6, inicio: '08:00', fim: '10:00' }] }),
      )
      .expect(422);
    expect(diaFora.body.error.details).toEqual([
      { field: 'janelas.0.dia', issue: 'dia da janela deve estar em diasSemana' },
    ]);
  });

  it('DTO inválido → 422 (diasSemana vazio, granularidade 45, timezone não-IANA, hora malformada)', async () => {
    const server = app.getHttpServer();

    const semDias = await request(server)
      .post('/api/v1/cronogramas')
      .set(auth(aluno1Token))
      .send(bodyCanonico({ diasSemana: [], janelas: [] }))
      .expect(422);
    expectErrorEnvelope(semDias, 'VALIDATION_ERROR');

    await request(server)
      .post('/api/v1/cronogramas')
      .set(auth(aluno1Token))
      .send(bodyCanonico({ granularidadeMin: 45 }))
      .expect(422);

    await request(server)
      .post('/api/v1/cronogramas')
      .set(auth(aluno1Token))
      .send(bodyCanonico({ timezone: 'Marte/Cratera' }))
      .expect(422);

    await request(server)
      .post('/api/v1/cronogramas')
      .set(auth(aluno1Token))
      .send(
        bodyCanonico({ diasSemana: [1], janelas: [{ dia: 1, inicio: '8h00', fim: '10:00' }] }),
      )
      .expect(422);

    // Nenhuma das tentativas inválidas pode ter criado cronograma
    const count = await prisma.cronograma.count({ where: { alunoId: aluno1Id } });
    expect(count).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Geração canônica (exemplo numérico do design)
  // -------------------------------------------------------------------------

  it('POST /cronogramas com o exemplo do design → 201, [4,4,2,2] slots e Σ 720 min/semana', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/cronogramas')
      .set(auth(aluno1Token))
      .send(bodyCanonico())
      .expect(201);

    const cronograma = res.body.cronograma;
    expect(cronograma).toMatchObject({
      id: expect.any(String),
      alunoId: aluno1Id,
      planoId: oficialId,
      diasSemana: DIAS_CANONICOS,
      horasSemanaTotal: 12,
      granularidadeMin: 60,
      timezone: TZ,
      ativo: true,
    });
    cronograma1Id = cronograma.id;
    blocosCronograma1 = cronograma.blocos as BlocoDto[];

    // 12 slots/semana × 4 semanas materializadas, sem fusões no padrão canônico
    expect(blocosCronograma1).toHaveLength(48);
    expect(blocosCronograma1.every((b) => b.status === 'PLANEJADO')).toBe(true);

    // Proporção do exemplo: Português 4 e Direito 4 slots (240 min/sem),
    // Matemática 2 e Informática 2 (120 min/sem) → totais em 4 semanas:
    expect(minutosDe(blocosCronograma1, discPortuguesId)).toBe(960);
    expect(minutosDe(blocosCronograma1, discDireitoId)).toBe(960);
    expect(minutosDe(blocosCronograma1, discMatematicaId)).toBe(480);
    expect(minutosDe(blocosCronograma1, discInformaticaId)).toBe(480);
    expect(blocosCronograma1.reduce((acc, b) => acc + b.duracaoMin, 0)).toBe(2880);
  });

  it('todos os blocos caem nas janelas locais (08–10h/14–16h SP = 11–13h/17–19h UTC) e nos dias escolhidos', () => {
    for (const b of blocosCronograma1) {
      const inicioLocal = minutosLocais(b.inicio);
      const fimLocal = minutosLocais(b.fim);
      const manha = inicioLocal >= 480 && fimLocal <= 600;
      const tarde = inicioLocal >= 840 && fimLocal <= 960;
      expect(manha || tarde).toBe(true);
      expect(DIAS_CANONICOS).toContain(weekdayLocal(b.inicio));
      // ADR-03: persistido em UTC → 08:00/09:00/14:00/15:00 locais = 11/12/17/18 UTC
      expect([11, 12, 17, 18]).toContain(new Date(b.inicio).getUTCHours());
      expect(new Date(b.inicio).getUTCMinutes()).toBe(0);
      expect(b.duracaoMin).toBe(
        (new Date(b.fim).getTime() - new Date(b.inicio).getTime()) / 60_000,
      );
    }
  });

  it('nenhum bloco se sobrepõe', () => {
    const ordenados = [...blocosCronograma1].sort(
      (a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime(),
    );
    for (let i = 1; i < ordenados.length; i += 1) {
      expect(new Date(ordenados[i - 1].fim).getTime()).toBeLessThanOrEqual(
        new Date(ordenados[i].inicio).getTime(),
      );
    }
  });

  it('fila de subtemas: blocos de Português seguem (tema.ordem, subtema.ordem) e avançam entre semanas', () => {
    const portugues = blocosCronograma1
      .filter((b) => b.disciplinaId === discPortuguesId)
      .sort((a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime());
    expect(portugues).toHaveLength(16);

    // 5 pendentes: 4 consumidos na semana 0 e o 5º na semana 1 (fila contínua);
    // os demais blocos ficam sem subtema (revisão).
    expect(portugues.map((b) => b.subtemaId)).toEqual([
      subProcliseId,
      subMesocliseId,
      subEncliseId,
      subCoesaoId,
      subCoerenciaId,
      ...Array<null>(11).fill(null),
    ]);

    // Disciplinas sem conteúdo cadastrado → blocos de revisão (subtemaId null)
    const semConteudo = blocosCronograma1.filter((b) => b.disciplinaId !== discPortuguesId);
    expect(semConteudo.every((b) => b.subtemaId === null)).toBe(true);
  });

  it('GET /cronogramas/ativo → o cronograma recém-gerado', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/cronogramas/ativo')
      .set(auth(aluno1Token))
      .expect(200);
    expect(res.body.cronograma).toMatchObject({ id: cronograma1Id, ativo: true });
  });

  it('GET /cronogramas/{id}/blocos com from/to → só a primeira semana (12 blocos)', async () => {
    const inicios = blocosCronograma1.map((b) => new Date(b.inicio).getTime());
    const min = Math.min(...inicios);
    const from = new Date(min).toISOString();
    const to = new Date(min + 7 * 86_400_000 - 1).toISOString();

    const res = await request(app.getHttpServer())
      .get(`/api/v1/cronogramas/${cronograma1Id}/blocos?from=${from}&to=${to}`)
      .set(auth(aluno1Token))
      .expect(200);

    expect(res.body.blocos).toHaveLength(12);
    expect(
      (res.body.blocos as BlocoDto[]).reduce((acc, b) => acc + b.duracaoMin, 0),
    ).toBe(720);

    const semFiltro = await request(app.getHttpServer())
      .get(`/api/v1/cronogramas/${cronograma1Id}/blocos`)
      .set(auth(aluno1Token))
      .expect(200);
    expect(semFiltro.body.blocos).toHaveLength(48);
  });

  it('REGRESSÃO review: fronteira `to` é exclusiva — bloco começando exatamente em `to` NÃO retorna', async () => {
    const inicios = blocosCronograma1.map((b) => new Date(b.inicio).getTime());
    const min = Math.min(...inicios);
    // O padrão semanal se repete a cada 7 dias: o primeiro bloco da semana 1
    // começa EXATAMENTE em min + 7d (SP não tem DST) — fronteira perfeita.
    const fronteira = new Date(min + 7 * 86_400_000).toISOString();
    expect(blocosCronograma1.some((b) => b.inicio === fronteira)).toBe(true);

    const res = await request(app.getHttpServer())
      .get(
        `/api/v1/cronogramas/${cronograma1Id}/blocos?from=${new Date(min).toISOString()}&to=${fronteira}`,
      )
      .set(auth(aluno1Token))
      .expect(200);

    const blocos = res.body.blocos as BlocoDto[];
    expect(blocos).toHaveLength(12); // só a semana 0
    expect(blocos.every((b) => b.inicio !== fronteira)).toBe(true);
    expect(blocos.every((b) => new Date(b.inicio).getTime() < new Date(fronteira).getTime())).toBe(
      true,
    );
  });

  it('REGRESSÃO review: 51 janelas → 422 (ArrayMaxSize do DTO)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/cronogramas')
      .set(auth(aluno1Token))
      .send(
        bodyCanonico({
          diasSemana: [DIAS_CANONICOS[0]],
          janelas: Array.from({ length: 51 }, () => ({
            dia: DIAS_CANONICOS[0],
            inicio: '08:00',
            fim: '10:00',
          })),
        }),
      )
      .expect(422);
    expectErrorEnvelope(res, 'VALIDATION_ERROR');
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'janelas', issue: expect.stringContaining('50') }),
      ]),
    );
  });

  // -------------------------------------------------------------------------
  // Escopo por dono (403) e status do bloco
  // -------------------------------------------------------------------------

  it('aluno2 não acessa cronograma/blocos do aluno1 → 403; inexistente → 404', async () => {
    const blocos = await request(app.getHttpServer())
      .get(`/api/v1/cronogramas/${cronograma1Id}/blocos`)
      .set(auth(aluno2Token))
      .expect(403);
    expectErrorEnvelope(blocos, 'FORBIDDEN');

    const patch = await request(app.getHttpServer())
      .patch(`/api/v1/blocos/${blocosCronograma1[0].id}`)
      .set(auth(aluno2Token))
      .send({ status: 'CONCLUIDO' })
      .expect(403);
    expectErrorEnvelope(patch, 'FORBIDDEN');

    const inexistente = await request(app.getHttpServer())
      .get(`/api/v1/cronogramas/${randomUUID()}/blocos`)
      .set(auth(aluno1Token))
      .expect(404);
    expectErrorEnvelope(inexistente, 'NOT_FOUND');
  });

  it('PATCH /blocos/{id}: CONCLUIDO e PULADO → 200; status inválido → 422; inexistente → 404; id malformado → 422', async () => {
    const blocoId = blocosCronograma1[0].id;
    const server = app.getHttpServer();

    const concluido = await request(server)
      .patch(`/api/v1/blocos/${blocoId}`)
      .set(auth(aluno1Token))
      .send({ status: 'CONCLUIDO' })
      .expect(200);
    expect(concluido.body.bloco).toMatchObject({ id: blocoId, status: 'CONCLUIDO' });

    const pulado = await request(server)
      .patch(`/api/v1/blocos/${blocosCronograma1[1].id}`)
      .set(auth(aluno1Token))
      .send({ status: 'PULADO' })
      .expect(200);
    expect(pulado.body.bloco.status).toBe('PULADO');

    // Persistiu de fato
    const noBanco = await prisma.blocoCronograma.findUnique({ where: { id: blocoId } });
    expect(noBanco?.status).toBe('CONCLUIDO');

    const invalido = await request(server)
      .patch(`/api/v1/blocos/${blocoId}`)
      .set(auth(aluno1Token))
      .send({ status: 'FEITO' })
      .expect(422);
    expectErrorEnvelope(invalido, 'VALIDATION_ERROR');

    const inexistente = await request(server)
      .patch(`/api/v1/blocos/${randomUUID()}`)
      .set(auth(aluno1Token))
      .send({ status: 'CONCLUIDO' })
      .expect(404);
    expectErrorEnvelope(inexistente, 'NOT_FOUND');

    await request(server)
      .patch('/api/v1/blocos/nao-e-uuid')
      .set(auth(aluno1Token))
      .send({ status: 'CONCLUIDO' })
      .expect(422);
  });

  // -------------------------------------------------------------------------
  // Regeneração: substitui o ativo e respeita o progresso
  // -------------------------------------------------------------------------

  it('regenerar após concluir um subtema → novo ativo, anterior desativado, fila avança', async () => {
    // Aluno1 conclui "Próclise" (progresso gravado direto, feature progresso ainda não exposta)
    await prisma.progressoSubtema.create({
      data: {
        alunoId: aluno1Id,
        subtemaId: subProcliseId,
        concluido: true,
        concluidoEm: new Date(),
      },
    });

    const res = await request(app.getHttpServer())
      .post('/api/v1/cronogramas')
      .set(auth(aluno1Token))
      .send(bodyCanonico())
      .expect(201);

    cronograma2Id = res.body.cronograma.id;
    expect(cronograma2Id).not.toBe(cronograma1Id);
    expect(res.body.cronograma.ativo).toBe(true);

    // Só 1 cronograma ativo por aluno; o anterior segue existindo, desativado
    const ativos = await prisma.cronograma.findMany({
      where: { alunoId: aluno1Id, ativo: true, deletedAt: null },
    });
    expect(ativos.map((c) => c.id)).toEqual([cronograma2Id]);
    const anterior = await prisma.cronograma.findUnique({ where: { id: cronograma1Id } });
    expect(anterior?.ativo).toBe(false);

    // Fila pulou o concluído: começa em Mesóclise
    const portugues = (res.body.cronograma.blocos as BlocoDto[])
      .filter((b) => b.disciplinaId === discPortuguesId)
      .sort((a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime());
    expect(portugues.map((b) => b.subtemaId).slice(0, 4)).toEqual([
      subMesocliseId,
      subEncliseId,
      subCoesaoId,
      subCoerenciaId,
    ]);
    expect(portugues.slice(4).every((b) => b.subtemaId === null)).toBe(true);

    const ativo = await request(app.getHttpServer())
      .get('/api/v1/cronogramas/ativo')
      .set(auth(aluno1Token))
      .expect(200);
    expect(ativo.body.cronograma.id).toBe(cronograma2Id);
  });

  it('blocos do cronograma desativado continuam consultáveis (histórico)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/cronogramas/${cronograma1Id}/blocos`)
      .set(auth(aluno1Token))
      .expect(200);
    expect(res.body.blocos).toHaveLength(48);
  });

  it('REGRESSÃO review: índice único parcial (aluno_id WHERE ativo) existe e o banco rejeita 2º ativo', async () => {
    const indices = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'cronogramas'
    `;
    expect(indices.map((i) => i.indexname)).toContain('cronogramas_aluno_id_ativo_unique');

    // Violação DIRETA no banco (fora da API): segundo ativo do mesmo aluno → P2002
    await expect(
      prisma.cronograma.create({
        data: {
          alunoId: aluno1Id,
          planoId: oficialId,
          diasSemana: DIAS_CANONICOS,
          janelas: [],
          horasSemanaTotal: 1,
          granularidadeMin: 60,
          timezone: TZ,
          ativo: true,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    // O invariante segue de pé: exatamente 1 ativo (o cronograma2)
    const ativos = await prisma.cronograma.count({
      where: { alunoId: aluno1Id, ativo: true, deletedAt: null },
    });
    expect(ativos).toBe(1);
  });
});
