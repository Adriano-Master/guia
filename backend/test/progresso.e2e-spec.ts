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
    `E2E de progresso exige banco guia_test (recebido: ${process.env.DATABASE_URL}). ` +
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

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

interface MarcacaoDto {
  subtemaId: string;
  concluido: boolean;
  concluidoEm: string | null;
}

interface SubtemaFlatDto {
  subtemaId: string;
  nome: string;
  ordem: number;
  temaId: string;
  disciplinaId: string;
  concluido: boolean;
  concluidoEm: string | null;
}

interface TemaNodeDto {
  temaId: string;
  nome: string;
  progressoPercentual: number;
  concluidos: number;
  totais: number;
  subtemas: Array<{ subtemaId: string; nome: string; concluido: boolean; concluidoEm: string | null }>;
}

interface DisciplinaNodeDto {
  disciplinaId: string;
  nome: string;
  progressoPercentual: number;
  concluidos: number;
  totais: number;
  temas: TemaNodeDto[];
}

interface PlanoProgressoDto {
  planoId: string;
  progressoPercentual: number;
  subtemasConcluidos: number;
  subtemasTotais: number;
  disciplinas: DisciplinaNodeDto[];
}

interface BlocoDto {
  id: string;
  disciplinaId: string;
  subtemaId: string | null;
  inicio: string;
}

describe('Progresso (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: ReturnType<INestApplication['getHttpServer']>;

  const senha = 'senha-progresso-e2e';
  let professorToken: string;
  let adminToken: string;
  let aluno1Token: string;
  let aluno2Token: string;
  let aluno1Id: string;
  let aluno2Id: string;
  let professorId: string;

  // Plano OFICIAL publicado — espelha o exemplo do design + disciplina p/ DT-02
  let oficialId: string;
  let discPortuguesId: string;
  let discRaciocinioId: string;
  let temaColocacaoId: string; // Português, ordem 1
  let temaCraseId: string; // Português, ordem 2
  let temaAId: string; // Raciocínio, ordem 1
  let temaBId: string; // Raciocínio, ordem 2
  let temaVazioId: string; // Raciocínio, ordem 3 — SEM subtemas (CA-07/CB-01)
  let subProcliseId: string;
  let subMesocliseId: string;
  let subEncliseId: string;
  let subRegraGeralId: string;
  let subA1Id: string;
  let subB1Id: string;
  let subB2Id: string;
  let subB3Id: string;
  let subUsoFacultativoId: string; // criado depois (CB-03)

  // OFICIAL não publicado e PESSOAL do aluno2 (escopo)
  let rascunhoId: string;
  let temaRascunhoId: string;
  let subRascunhoId: string;
  let pessoalAluno2Id: string;
  let subPessoalM1Id: string;
  let subPessoalM2Id: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const putProgresso = (token: string, subtemaId: string, body: unknown) =>
    request(server)
      .put(`/api/v1/progresso/subtemas/${subtemaId}`)
      .set(auth(token))
      .send(body as object);

  const getPlano = async (token: string, planoId: string): Promise<PlanoProgressoDto> => {
    const res = await request(server)
      .get(`/api/v1/progresso/planos/${planoId}`)
      .set(auth(token))
      .expect(200);
    return res.body as PlanoProgressoDto;
  };

  const contarLinhas = (alunoId: string, subtemaId: string) =>
    prisma.progressoSubtema.count({ where: { alunoId, subtemaId } });

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    server = app.getHttpServer();
    await cleanDatabase(prisma);

    const senhaHash = await hashPassword(senha);
    const criarUser = (nome: string, email: string, role: 'ADMIN' | 'PROFESSOR' | 'ALUNO') =>
      prisma.user.create({
        data: { nome, email, senhaHash, role, status: 'ATIVO', origem: 'PROPRIO' },
      });
    const professor = await criarUser(
      'Professor Progresso',
      'professor.progresso@guia.test',
      'PROFESSOR',
    );
    professorId = professor.id;
    await criarUser('Admin Progresso', 'admin.progresso@guia.test', 'ADMIN');
    const aluno1 = await criarUser('Aluno Um', 'aluno1.progresso@guia.test', 'ALUNO');
    const aluno2 = await criarUser('Aluno Dois', 'aluno2.progresso@guia.test', 'ALUNO');
    aluno1Id = aluno1.id;
    aluno2Id = aluno2.id;

    const login = async (email: string): Promise<string> => {
      const res = await request(server)
        .post('/api/v1/auth/login')
        .send({ email, senha })
        .expect(200);
      return res.body.accessToken as string;
    };
    professorToken = await login('professor.progresso@guia.test');
    adminToken = await login('admin.progresso@guia.test');
    aluno1Token = await login('aluno1.progresso@guia.test');
    aluno2Token = await login('aluno2.progresso@guia.test');
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  // -------------------------------------------------------------------------
  // Setup da árvore (exemplo do design + DT-02 + tema vazio)
  // -------------------------------------------------------------------------

  it('setup: plano oficial publicado, rascunho e pessoal do aluno2', async () => {
    const criarPlano = async (token: string, titulo: string, tipo: string): Promise<string> => {
      const res = await request(server)
        .post('/api/v1/planos')
        .set(auth(token))
        .send({ titulo, tipo })
        .expect(201);
      return res.body.plano.id as string;
    };
    const criarDisciplina = async (
      token: string,
      planoId: string,
      nome: string,
      ordem: number,
    ): Promise<string> => {
      const res = await request(server)
        .post(`/api/v1/planos/${planoId}/disciplinas`)
        .set(auth(token))
        .send({ nome, ordem })
        .expect(201);
      return res.body.disciplina.id as string;
    };
    const criarTema = async (
      token: string,
      disciplinaId: string,
      nome: string,
      ordem: number,
    ): Promise<string> => {
      const res = await request(server)
        .post(`/api/v1/disciplinas/${disciplinaId}/temas`)
        .set(auth(token))
        .send({ nome, ordem })
        .expect(201);
      return res.body.tema.id as string;
    };
    const criarSubtema = async (
      token: string,
      temaId: string,
      nome: string,
      ordem: number,
    ): Promise<string> => {
      const res = await request(server)
        .post(`/api/v1/temas/${temaId}/subtemas`)
        .set(auth(token))
        .send({ nome, ordem })
        .expect(201);
      return res.body.subtema.id as string;
    };

    // OFICIAL publicado — Português espelha o exemplo do design.md
    oficialId = await criarPlano(professorToken, 'Analista Progresso', 'OFICIAL');
    discPortuguesId = await criarDisciplina(professorToken, oficialId, 'Português', 1);
    discRaciocinioId = await criarDisciplina(professorToken, oficialId, 'Raciocínio', 2);

    temaColocacaoId = await criarTema(professorToken, discPortuguesId, 'Colocação pronominal', 1);
    temaCraseId = await criarTema(professorToken, discPortuguesId, 'Crase', 2);
    temaAId = await criarTema(professorToken, discRaciocinioId, 'Tema A', 1);
    temaBId = await criarTema(professorToken, discRaciocinioId, 'Tema B', 2);
    temaVazioId = await criarTema(professorToken, discRaciocinioId, 'Tema Vazio', 3);

    subProcliseId = await criarSubtema(professorToken, temaColocacaoId, 'Próclise', 1);
    subMesocliseId = await criarSubtema(professorToken, temaColocacaoId, 'Mesóclise', 2);
    subEncliseId = await criarSubtema(professorToken, temaColocacaoId, 'Ênclise', 3);
    subRegraGeralId = await criarSubtema(professorToken, temaCraseId, 'Regra geral', 1);
    subA1Id = await criarSubtema(professorToken, temaAId, 'A1', 1);
    subB1Id = await criarSubtema(professorToken, temaBId, 'B1', 1);
    subB2Id = await criarSubtema(professorToken, temaBId, 'B2', 2);
    subB3Id = await criarSubtema(professorToken, temaBId, 'B3', 3);

    await request(server)
      .put(`/api/v1/planos/${oficialId}/pesos`)
      .set(auth(professorToken))
      .send({
        pesos: [
          { disciplinaId: discPortuguesId, pesoPercentual: 60 },
          { disciplinaId: discRaciocinioId, pesoPercentual: 40 },
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

    // OFICIAL NÃO publicado (ilegível para aluno)
    rascunhoId = await criarPlano(professorToken, 'Rascunho Progresso', 'OFICIAL');
    const discRascunhoId = await criarDisciplina(professorToken, rascunhoId, 'Oculta', 1);
    temaRascunhoId = await criarTema(professorToken, discRascunhoId, 'Tema Oculto', 1);
    subRascunhoId = await criarSubtema(professorToken, temaRascunhoId, 'Sub Oculto', 1);

    // PESSOAL do aluno2 (ilegível para aluno1) — CB-04: ids próprios
    pessoalAluno2Id = await criarPlano(aluno2Token, 'Plano do Dois', 'PESSOAL');
    const discPessoalId = await criarDisciplina(aluno2Token, pessoalAluno2Id, 'Minha', 1);
    const temaPessoalId = await criarTema(aluno2Token, discPessoalId, 'Meu Tema', 1);
    subPessoalM1Id = await criarSubtema(aluno2Token, temaPessoalId, 'M1', 1);
    subPessoalM2Id = await criarSubtema(aluno2Token, temaPessoalId, 'M2', 2);
  });

  // -------------------------------------------------------------------------
  // Autenticação e roles
  // -------------------------------------------------------------------------

  it('sem token → 401 UNAUTHENTICATED nas três rotas', async () => {
    const put = await request(server)
      .put(`/api/v1/progresso/subtemas/${randomUUID()}`)
      .send({ concluido: true })
      .expect(401);
    expectErrorEnvelope(put, 'UNAUTHENTICATED');

    const getPlanoRes = await request(server)
      .get(`/api/v1/progresso/planos/${randomUUID()}`)
      .expect(401);
    expectErrorEnvelope(getPlanoRes, 'UNAUTHENTICATED');

    const getSubtemas = await request(server)
      .get(`/api/v1/progresso/subtemas?planoId=${randomUUID()}`)
      .expect(401);
    expectErrorEnvelope(getSubtemas, 'UNAUTHENTICATED');
  });

  it('PROFESSOR e ADMIN → 403 FORBIDDEN nas rotas de progresso (rotas são de ALUNO)', async () => {
    for (const token of [professorToken, adminToken]) {
      const put = await putProgresso(token, subProcliseId, { concluido: true }).expect(403);
      expectErrorEnvelope(put, 'FORBIDDEN');

      const plano = await request(server)
        .get(`/api/v1/progresso/planos/${oficialId}`)
        .set(auth(token))
        .expect(403);
      expectErrorEnvelope(plano, 'FORBIDDEN');

      const lista = await request(server)
        .get(`/api/v1/progresso/subtemas?planoId=${oficialId}`)
        .set(auth(token))
        .expect(403);
      expectErrorEnvelope(lista, 'FORBIDDEN');
    }
    expect(await prisma.progressoSubtema.count()).toBe(0);
  });

  // -------------------------------------------------------------------------
  // PUT — validações de entrada e escopo (CA-08, CA-09)
  // -------------------------------------------------------------------------

  it('PUT com uuid malformado → 422; subtema inexistente → 404 (CA-09); body vazio → 422', async () => {
    const malformado = await putProgresso(aluno1Token, 'nao-e-uuid', { concluido: true }).expect(
      422,
    );
    expectErrorEnvelope(malformado, 'VALIDATION_ERROR');

    const inexistente = await putProgresso(aluno1Token, randomUUID(), { concluido: true }).expect(
      404,
    );
    expectErrorEnvelope(inexistente, 'NOT_FOUND');

    const semCampo = await putProgresso(aluno1Token, subProcliseId, {}).expect(422);
    expectErrorEnvelope(semCampo, 'VALIDATION_ERROR');
    expect(semCampo.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'concluido' })]),
    );

    const campoExtra = await putProgresso(aluno1Token, subProcliseId, {
      concluido: true,
      hack: 1,
    }).expect(422);
    expectErrorEnvelope(campoExtra, 'VALIDATION_ERROR');

    expect(await prisma.progressoSubtema.count()).toBe(0);
  });

  it('REGRESSÃO review: PUT com concluido NÃO-booleano ("false"/"sim"/1) → 422, sem coerção e sem gravar', async () => {
    // Antes da correção, enableImplicitConversion coagia "false"/"sim"/1 para
    // `true` ANTES do @IsBoolean — um cliente enviando a string "false"
    // MARCAVA o subtema como concluído. O @Transform do DTO agora lê o valor
    // bruto (obj.concluido) e exige booleano JSON estrito.
    for (const concluido of ['false', 'sim', 1]) {
      const res = await putProgresso(aluno1Token, subMesocliseId, { concluido });
      expect(res.status).toBe(422);
      expectErrorEnvelope(res, 'VALIDATION_ERROR');
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'concluido' })]),
      );
    }
    // Nenhum 422 gravou nada
    expect(await contarLinhas(aluno1Id, subMesocliseId)).toBe(0);
  });

  it('PUT {concluido:false} booleano puro em Mesóclise → 200 false (baseline p/ os agregados)', async () => {
    const res = await putProgresso(aluno1Token, subMesocliseId, { concluido: false }).expect(200);
    expect(res.body).toEqual({ subtemaId: subMesocliseId, concluido: false, concluidoEm: null });
  });

  it('escopo: subtema de OFICIAL não publicado ou de PESSOAL alheio → 403; GETs idem (CA-08)', async () => {
    const rascunho = await putProgresso(aluno1Token, subRascunhoId, { concluido: true }).expect(
      403,
    );
    expectErrorEnvelope(rascunho, 'FORBIDDEN');

    const pessoal = await putProgresso(aluno1Token, subPessoalM1Id, { concluido: true }).expect(
      403,
    );
    expectErrorEnvelope(pessoal, 'FORBIDDEN');

    const getPessoal = await request(server)
      .get(`/api/v1/progresso/planos/${pessoalAluno2Id}`)
      .set(auth(aluno1Token))
      .expect(403);
    expectErrorEnvelope(getPessoal, 'FORBIDDEN');

    const getRascunho = await request(server)
      .get(`/api/v1/progresso/planos/${rascunhoId}`)
      .set(auth(aluno1Token))
      .expect(403);
    expectErrorEnvelope(getRascunho, 'FORBIDDEN');

    const listaPessoal = await request(server)
      .get(`/api/v1/progresso/subtemas?planoId=${pessoalAluno2Id}`)
      .set(auth(aluno1Token))
      .expect(403);
    expectErrorEnvelope(listaPessoal, 'FORBIDDEN');

    expect(
      await prisma.progressoSubtema.count({
        where: { subtemaId: { in: [subRascunhoId, subPessoalM1Id] } },
      }),
    ).toBe(0);
  });

  it('GET /progresso/planos: inexistente → 404; uuid malformado → 422', async () => {
    const inexistente = await request(server)
      .get(`/api/v1/progresso/planos/${randomUUID()}`)
      .set(auth(aluno1Token))
      .expect(404);
    expectErrorEnvelope(inexistente, 'NOT_FOUND');

    const malformado = await request(server)
      .get('/api/v1/progresso/planos/nao-e-uuid')
      .set(auth(aluno1Token))
      .expect(422);
    expectErrorEnvelope(malformado, 'VALIDATION_ERROR');
  });

  // -------------------------------------------------------------------------
  // PUT — caminho feliz, idempotência, CB-05, CA-02, CB-06
  // -------------------------------------------------------------------------

  let concluidoEmOriginal: string;

  it('PUT marca subtema → 200 top-level {subtemaId, concluido, concluidoEm} ISO UTC (CA-01)', async () => {
    const res = await putProgresso(aluno1Token, subProcliseId, { concluido: true }).expect(200);

    // Objeto top-level, SEM wrapper
    expect(res.body.subtemaId).toBe(subProcliseId);
    expect(res.body).toEqual({
      subtemaId: subProcliseId,
      concluido: true,
      concluidoEm: expect.stringMatching(ISO_UTC),
    });
    const concluidoEm = new Date(res.body.concluidoEm as string).getTime();
    expect(Math.abs(Date.now() - concluidoEm)).toBeLessThan(10_000);

    expect(await contarLinhas(aluno1Id, subProcliseId)).toBe(1);
    concluidoEmOriginal = res.body.concluidoEm as string;
  });

  it('remarcar concluído: 200, concluidoEm PRESERVADO e continua UMA linha (CA-03, CB-05, RN-05)', async () => {
    // Garante diferença mensurável de relógio entre as marcações
    await new Promise((resolve) => setTimeout(resolve, 60));

    const res = await putProgresso(aluno1Token, subProcliseId, { concluido: true }).expect(200);
    expect(res.body).toEqual({
      subtemaId: subProcliseId,
      concluido: true,
      concluidoEm: concluidoEmOriginal, // NÃO foi reescrito
    });

    expect(await contarLinhas(aluno1Id, subProcliseId)).toBe(1); // 2 PUTs → 1 linha
  });

  it('desmarcar zera concluidoEm (CA-02); desmarcar de novo é idempotente; remarcar gera concluidoEm NOVO', async () => {
    const desmarcar = await putProgresso(aluno1Token, subProcliseId, { concluido: false }).expect(
      200,
    );
    expect(desmarcar.body).toEqual({
      subtemaId: subProcliseId,
      concluido: false,
      concluidoEm: null,
    });

    const deNovo = await putProgresso(aluno1Token, subProcliseId, { concluido: false }).expect(
      200,
    );
    expect(deNovo.body.concluido).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 60));
    const remarcar = await putProgresso(aluno1Token, subProcliseId, { concluido: true }).expect(
      200,
    );
    expect(remarcar.body.concluido).toBe(true);
    // Transição false→true: data NOVA (a original foi zerada no unmark)
    expect(new Date(remarcar.body.concluidoEm as string).getTime()).toBeGreaterThan(
      new Date(concluidoEmOriginal).getTime(),
    );
    expect(await contarLinhas(aluno1Id, subProcliseId)).toBe(1);
  });

  it('desmarcar subtema NUNCA marcado → 200 concluido=false sem erro, cria registro único (CB-06)', async () => {
    expect(await contarLinhas(aluno1Id, subB3Id)).toBe(0);

    const res = await putProgresso(aluno1Token, subB3Id, { concluido: false }).expect(200);
    expect(res.body).toEqual({ subtemaId: subB3Id, concluido: false, concluidoEm: null });

    expect(await contarLinhas(aluno1Id, subB3Id)).toBe(1);
    const linha = await prisma.progressoSubtema.findUnique({
      where: { alunoId_subtemaId: { alunoId: aluno1Id, subtemaId: subB3Id } },
    });
    expect(linha).toMatchObject({ concluido: false, concluidoEm: null, deletedAt: null });
  });

  it('unique (aluno_id, subtema_id) existe no banco: INSERT duplicado direto → P2002 (CA-03)', async () => {
    await expect(
      prisma.progressoSubtema.create({
        data: { alunoId: aluno1Id, subtemaId: subProcliseId, concluido: true },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  // -------------------------------------------------------------------------
  // Agregação — exemplo do design, DT-02, CA-04..07, CB-01 (aluno1)
  // Estado alvo: Próclise✓ Mesóclise✗ Ênclise✓ | Regra geral✓ | A1✓ | B*✗
  // -------------------------------------------------------------------------

  it('GET /progresso/planos reproduz o exemplo do design: 66.67 / 100 / 75 na cadeia de Português (CA-04..06)', async () => {
    await putProgresso(aluno1Token, subEncliseId, { concluido: true }).expect(200);
    await putProgresso(aluno1Token, subRegraGeralId, { concluido: true }).expect(200);
    await putProgresso(aluno1Token, subA1Id, { concluido: true }).expect(200);

    const res = await request(server)
      .get(`/api/v1/progresso/planos/${oficialId}`)
      .set(auth(aluno1Token))
      .expect(200);

    // Resposta top-level, sem wrapper
    const body = res.body as PlanoProgressoDto;
    expect(body.planoId).toBe(oficialId);

    // Plano: 4 de 8 → 50 (CA-06)
    expect(body).toMatchObject({
      progressoPercentual: 50,
      subtemasConcluidos: 4,
      subtemasTotais: 8,
    });

    const portugues = body.disciplinas.find((d) => d.disciplinaId === discPortuguesId)!;
    expect(portugues).toMatchObject({ progressoPercentual: 75, concluidos: 3, totais: 4 });

    const colocacao = portugues.temas.find((t) => t.temaId === temaColocacaoId)!;
    expect(colocacao).toMatchObject({ progressoPercentual: 66.67, concluidos: 2, totais: 3 });
    expect(colocacao.subtemas.map((s) => [s.nome, s.concluido])).toEqual([
      ['Próclise', true],
      ['Mesóclise', false],
      ['Ênclise', true],
    ]);
    // Datas ISO UTC nas folhas concluídas; null nas pendentes
    expect(colocacao.subtemas[0].concluidoEm).toMatch(ISO_UTC);
    expect(colocacao.subtemas[1].concluidoEm).toBeNull();

    const crase = portugues.temas.find((t) => t.temaId === temaCraseId)!;
    expect(crase).toMatchObject({ progressoPercentual: 100, concluidos: 1, totais: 1 });
  });

  it('DT-02 na API: Raciocínio = 1/4 = 25 (por folhas), NÃO 50 (média de médias); tema vazio → 0 e não vira 100 (CA-07, CB-01)', async () => {
    const body = await getPlano(aluno1Token, oficialId);

    const raciocinio = body.disciplinas.find((d) => d.disciplinaId === discRaciocinioId)!;
    expect(raciocinio).toMatchObject({ progressoPercentual: 25, concluidos: 1, totais: 4 });

    const temaA = raciocinio.temas.find((t) => t.temaId === temaAId)!;
    const temaB = raciocinio.temas.find((t) => t.temaId === temaBId)!;
    const temaVazio = raciocinio.temas.find((t) => t.temaId === temaVazioId)!;
    expect(temaA).toMatchObject({ progressoPercentual: 100, concluidos: 1, totais: 1 });
    expect(temaB).toMatchObject({ progressoPercentual: 0, concluidos: 0, totais: 3 });
    // Tema sem subtemas: 0%, totais 0, e não entra na razão da disciplina
    expect(temaVazio).toMatchObject({ progressoPercentual: 0, concluidos: 0, totais: 0 });
    expect(temaVazio.subtemas).toEqual([]);
  });

  it('progresso é POR aluno: marcações do aluno2 não vazam para o aluno1 (RN-03, CA-08)', async () => {
    await putProgresso(aluno2Token, subRegraGeralId, { concluido: true }).expect(200);

    const doAluno2 = await getPlano(aluno2Token, oficialId);
    expect(doAluno2).toMatchObject({
      progressoPercentual: 12.5, // 1/8
      subtemasConcluidos: 1,
      subtemasTotais: 8,
    });
    const crase2 = doAluno2.disciplinas
      .find((d) => d.disciplinaId === discPortuguesId)!
      .temas.find((t) => t.temaId === temaCraseId)!;
    expect(crase2.progressoPercentual).toBe(100);

    // aluno1 permanece intacto
    const doAluno1 = await getPlano(aluno1Token, oficialId);
    expect(doAluno1).toMatchObject({ progressoPercentual: 50, subtemasConcluidos: 4 });

    // Uma linha por (aluno, subtema): Regra geral tem duas, uma de cada aluno
    expect(
      await prisma.progressoSubtema.count({ where: { subtemaId: subRegraGeralId } }),
    ).toBe(2);
  });

  it('CB-02/CB-04: aluno2 conclui TODOS os subtemas do plano PESSOAL → 100 em todos os níveis', async () => {
    await putProgresso(aluno2Token, subPessoalM1Id, { concluido: true }).expect(200);
    await putProgresso(aluno2Token, subPessoalM2Id, { concluido: true }).expect(200);

    const body = await getPlano(aluno2Token, pessoalAluno2Id);
    expect(body).toMatchObject({
      progressoPercentual: 100,
      subtemasConcluidos: 2,
      subtemasTotais: 2,
    });
    expect(body.disciplinas[0].progressoPercentual).toBe(100);
    expect(body.disciplinas[0].temas[0].progressoPercentual).toBe(100);
  });

  // -------------------------------------------------------------------------
  // RN-04 — subtema soft-deleted sai de numerador E denominador
  // -------------------------------------------------------------------------

  it('RN-04: soft-delete de subtema CONCLUÍDO tira 1 dos dois lados da razão; restaurar reverte', async () => {
    // Ênclise (concluído) soft-deleted → Colocação 1/2, Português 2/3, plano 3/7
    await prisma.subtema.update({ where: { id: subEncliseId }, data: { deletedAt: new Date() } });

    const body = await getPlano(aluno1Token, oficialId);
    expect(body).toMatchObject({
      progressoPercentual: 42.86, // 3/7
      subtemasConcluidos: 3,
      subtemasTotais: 7,
    });
    const portugues = body.disciplinas.find((d) => d.disciplinaId === discPortuguesId)!;
    expect(portugues).toMatchObject({ progressoPercentual: 66.67, concluidos: 2, totais: 3 });
    const colocacao = portugues.temas.find((t) => t.temaId === temaColocacaoId)!;
    expect(colocacao).toMatchObject({ progressoPercentual: 50, concluidos: 1, totais: 2 });
    expect(colocacao.subtemas.map((s) => s.nome)).toEqual(['Próclise', 'Mesóclise']);

    await prisma.subtema.update({ where: { id: subEncliseId }, data: { deletedAt: null } });
    expect((await getPlano(aluno1Token, oficialId)).progressoPercentual).toBe(50);
  });

  it('RN-04: soft-delete de subtema PENDENTE reduz só o denominador (Colocação vira 2/2 = 100)', async () => {
    await prisma.subtema.update({
      where: { id: subMesocliseId },
      data: { deletedAt: new Date() },
    });

    const body = await getPlano(aluno1Token, oficialId);
    expect(body).toMatchObject({
      progressoPercentual: 57.14, // 4/7
      subtemasConcluidos: 4,
      subtemasTotais: 7,
    });
    const colocacao = body.disciplinas
      .find((d) => d.disciplinaId === discPortuguesId)!
      .temas.find((t) => t.temaId === temaColocacaoId)!;
    expect(colocacao).toMatchObject({ progressoPercentual: 100, concluidos: 2, totais: 2 });

    await prisma.subtema.update({ where: { id: subMesocliseId }, data: { deletedAt: null } });
  });

  // -------------------------------------------------------------------------
  // CB-03 — subtema novo aumenta denominador (cálculo sob demanda)
  // -------------------------------------------------------------------------

  it('CB-03: professor adiciona subtema após marcações → percentual do aluno CAI imediatamente', async () => {
    const antes = await getPlano(aluno1Token, oficialId);
    expect(antes.progressoPercentual).toBe(50); // 4/8

    const res = await request(server)
      .post(`/api/v1/temas/${temaCraseId}/subtemas`)
      .set(auth(professorToken))
      .send({ nome: 'Uso facultativo', ordem: 2 })
      .expect(201);
    subUsoFacultativoId = res.body.subtema.id as string;

    const depois = await getPlano(aluno1Token, oficialId);
    expect(depois).toMatchObject({
      progressoPercentual: 44.44, // 4/9
      subtemasConcluidos: 4,
      subtemasTotais: 9,
    });
    const portugues = depois.disciplinas.find((d) => d.disciplinaId === discPortuguesId)!;
    expect(portugues).toMatchObject({ progressoPercentual: 60, concluidos: 3, totais: 5 });
    const crase = portugues.temas.find((t) => t.temaId === temaCraseId)!;
    expect(crase).toMatchObject({ progressoPercentual: 50, concluidos: 1, totais: 2 });
  });

  // -------------------------------------------------------------------------
  // Upsert revive registro de progresso soft-deleted
  // -------------------------------------------------------------------------

  it('PUT revive registro de progresso soft-deleted: 200, linha ÚNICA com deletedAt=null e data nova', async () => {
    const antesRevive = await prisma.progressoSubtema.findUnique({
      where: { alunoId_subtemaId: { alunoId: aluno1Id, subtemaId: subProcliseId } },
    });
    await prisma.progressoSubtema.update({
      where: { alunoId_subtemaId: { alunoId: aluno1Id, subtemaId: subProcliseId } },
      data: { deletedAt: new Date() },
    });

    // Soft-deleted não conta na agregação
    const semProclise = await getPlano(aluno1Token, oficialId);
    expect(semProclise).toMatchObject({ subtemasConcluidos: 3, progressoPercentual: 33.33 }); // 3/9

    await new Promise((resolve) => setTimeout(resolve, 60));
    const res = await putProgresso(aluno1Token, subProcliseId, { concluido: true }).expect(200);
    expect(res.body).toMatchObject({ subtemaId: subProcliseId, concluido: true });

    expect(await contarLinhas(aluno1Id, subProcliseId)).toBe(1); // revive, não duplica
    const linha = await prisma.progressoSubtema.findUnique({
      where: { alunoId_subtemaId: { alunoId: aluno1Id, subtemaId: subProcliseId } },
    });
    expect(linha).toMatchObject({ concluido: true, deletedAt: null });
    // Registro morto não preserva a data antiga: transição "nova" para true
    expect(linha!.concluidoEm!.getTime()).toBeGreaterThan(
      antesRevive!.concluidoEm!.getTime(),
    );

    expect((await getPlano(aluno1Token, oficialId)).progressoPercentual).toBe(44.44); // 4/9 de volta
  });

  // -------------------------------------------------------------------------
  // GET /progresso/subtemas — listagem plana (US-04)
  // -------------------------------------------------------------------------

  describe('GET /progresso/subtemas', () => {
    it('sem planoId → 422 com detail em planoId', async () => {
      const res = await request(server)
        .get('/api/v1/progresso/subtemas')
        .set(auth(aluno1Token))
        .expect(422);
      expectErrorEnvelope(res, 'VALIDATION_ERROR');
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'planoId' })]),
      );
    });

    it('planoId inexistente → 404; planoId malformado → 422', async () => {
      const inexistente = await request(server)
        .get(`/api/v1/progresso/subtemas?planoId=${randomUUID()}`)
        .set(auth(aluno1Token))
        .expect(404);
      expectErrorEnvelope(inexistente, 'NOT_FOUND');

      const malformado = await request(server)
        .get('/api/v1/progresso/subtemas?planoId=nao-e-uuid')
        .set(auth(aluno1Token))
        .expect(422);
      expectErrorEnvelope(malformado, 'VALIDATION_ERROR');
    });

    it('lista {subtemas:[...]} completa e ordenada por disciplina → tema → ordem', async () => {
      const res = await request(server)
        .get(`/api/v1/progresso/subtemas?planoId=${oficialId}`)
        .set(auth(aluno1Token))
        .expect(200);

      const subtemas = res.body.subtemas as SubtemaFlatDto[];
      expect(subtemas).toHaveLength(9);
      expect(subtemas.map((s) => s.nome)).toEqual([
        'Próclise',
        'Mesóclise',
        'Ênclise',
        'Regra geral',
        'Uso facultativo',
        'A1',
        'B1',
        'B2',
        'B3',
      ]);
      const proclise = subtemas[0];
      expect(proclise).toMatchObject({
        subtemaId: subProcliseId,
        temaId: temaColocacaoId,
        disciplinaId: discPortuguesId,
        concluido: true,
        concluidoEm: expect.stringMatching(ISO_UTC),
      });
      expect(subtemas[1]).toMatchObject({ nome: 'Mesóclise', concluido: false, concluidoEm: null });
    });

    it('filtro concluido=true lista só os concluídos', async () => {
      const res = await request(server)
        .get(`/api/v1/progresso/subtemas?planoId=${oficialId}&concluido=true`)
        .set(auth(aluno1Token))
        .expect(200);
      const nomes = (res.body.subtemas as SubtemaFlatDto[]).map((s) => s.nome);
      expect(nomes).toEqual(['Próclise', 'Ênclise', 'Regra geral', 'A1']);
    });

    it('REGRESSÃO review: filtro concluido=false lista só PENDENTES (US-04 "o que falta")', async () => {
      // Antes da correção, enableImplicitConversion fazia Boolean('false') ===
      // true ANTES do @Transform e o filtro "o que falta" devolvia os
      // CONCLUÍDOS. O @Transform agora lê o valor bruto (obj.concluido).
      const res = await request(server)
        .get(`/api/v1/progresso/subtemas?planoId=${oficialId}&concluido=false`)
        .set(auth(aluno1Token))
        .expect(200);
      const nomes = (res.body.subtemas as SubtemaFlatDto[]).map((s) => s.nome);
      expect(nomes).toEqual(['Mesóclise', 'Uso facultativo', 'B1', 'B2', 'B3']);
    });

    it('concluido=x (inválido) → 422 VALIDATION_ERROR ("concluido deve ser true ou false")', async () => {
      // O @Transform do DTO lê o valor bruto (obj.concluido) antes da
      // conversão implícita do pipe global: só 'true'/'false' viram booleano;
      // qualquer outro valor reprova no @IsBoolean.
      const res = await request(server)
        .get(`/api/v1/progresso/subtemas?planoId=${oficialId}&concluido=x`)
        .set(auth(aluno1Token))
        .expect(422);
      expectErrorEnvelope(res, 'VALIDATION_ERROR');
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'concluido' })]),
      );
    });

    it('REGRESSÃO review: temaId inexistente → 404; malformado → 422', async () => {
      const inexistente = await request(server)
        .get(`/api/v1/progresso/subtemas?planoId=${oficialId}&temaId=${randomUUID()}`)
        .set(auth(aluno1Token))
        .expect(404);
      expectErrorEnvelope(inexistente, 'NOT_FOUND');

      const malformado = await request(server)
        .get(`/api/v1/progresso/subtemas?planoId=${oficialId}&temaId=nao-e-uuid`)
        .set(auth(aluno1Token))
        .expect(422);
      expectErrorEnvelope(malformado, 'VALIDATION_ERROR');
    });

    it('REGRESSÃO review: temaId VÁLIDO mas de OUTRO plano → 404 (planoId divergente, sem 200 [] silencioso)', async () => {
      // Tema existe e está ativo, mas pertence ao plano rascunho — a consulta
      // é feita sobre o plano OFICIAL legível, então a divergência é 404 (e
      // não vaza a existência do tema alheio).
      const res = await request(server)
        .get(`/api/v1/progresso/subtemas?planoId=${oficialId}&temaId=${temaRascunhoId}`)
        .set(auth(aluno1Token))
        .expect(404);
      expectErrorEnvelope(res, 'NOT_FOUND');
    });

    it('REGRESSÃO review: temaId soft-deleted → 404; restaurado volta a 200', async () => {
      await prisma.tema.update({ where: { id: temaVazioId }, data: { deletedAt: new Date() } });
      try {
        const res = await request(server)
          .get(`/api/v1/progresso/subtemas?planoId=${oficialId}&temaId=${temaVazioId}`)
          .set(auth(aluno1Token))
          .expect(404);
        expectErrorEnvelope(res, 'NOT_FOUND');
      } finally {
        await prisma.tema.update({ where: { id: temaVazioId }, data: { deletedAt: null } });
      }

      const restaurado = await request(server)
        .get(`/api/v1/progresso/subtemas?planoId=${oficialId}&temaId=${temaVazioId}`)
        .set(auth(aluno1Token))
        .expect(200);
      expect(restaurado.body.subtemas).toEqual([]); // tema vazio: 200 com lista vazia legítima
    });

    it('filtro temaId restringe ao tema; combinado com concluido=true intersecta', async () => {
      const doTema = await request(server)
        .get(`/api/v1/progresso/subtemas?planoId=${oficialId}&temaId=${temaColocacaoId}`)
        .set(auth(aluno1Token))
        .expect(200);
      expect((doTema.body.subtemas as SubtemaFlatDto[]).map((s) => s.nome)).toEqual([
        'Próclise',
        'Mesóclise',
        'Ênclise',
      ]);

      const combinado = await request(server)
        .get(
          `/api/v1/progresso/subtemas?planoId=${oficialId}&temaId=${temaColocacaoId}&concluido=true`,
        )
        .set(auth(aluno1Token))
        .expect(200);
      expect((combinado.body.subtemas as SubtemaFlatDto[]).map((s) => s.nome)).toEqual([
        'Próclise',
        'Ênclise',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Consistência com o cronograma: concluído sai da fila (CA-10 + cronograma)
  // -------------------------------------------------------------------------

  it('marcar concluído via PUT → gerar cronograma → subtemas concluídos NÃO entram na fila de blocos', async () => {
    // Fecha a pendência de Colocação: agora Português só tem "Uso facultativo"
    // pendente e Raciocínio tem B1..B3.
    await putProgresso(aluno1Token, subMesocliseId, { concluido: true }).expect(200);

    const dias = [1, 3, 5];
    const res = await request(server)
      .post('/api/v1/cronogramas')
      .set(auth(aluno1Token))
      .send({
        planoId: oficialId,
        diasSemana: dias,
        janelas: dias.map((dia) => ({ dia, inicio: '08:00', fim: '10:00' })),
        granularidadeMin: 60,
        timezone: 'America/Sao_Paulo',
      })
      .expect(201);

    const blocos = res.body.cronograma.blocos as BlocoDto[];
    expect(blocos.length).toBeGreaterThan(0);

    const concluidos = [subProcliseId, subMesocliseId, subEncliseId, subRegraGeralId, subA1Id];
    for (const bloco of blocos) {
      expect(concluidos).not.toContain(bloco.subtemaId);
    }

    // Fila de Português pula direto para o próximo pendente (Uso facultativo)
    const filaPortugues = blocos
      .filter((b) => b.disciplinaId === discPortuguesId && b.subtemaId !== null)
      .map((b) => b.subtemaId);
    expect(filaPortugues).toEqual([subUsoFacultativoId]);

    // Raciocínio consome os pendentes na ordem (B1 → B2 → B3); B3 tem registro
    // concluido=false (CB-06) e continua elegível
    const filaRaciocinio = blocos
      .filter((b) => b.disciplinaId === discRaciocinioId && b.subtemaId !== null)
      .map((b) => b.subtemaId);
    expect(filaRaciocinio).toEqual([subB1Id, subB2Id, subB3Id]);
  });
});
