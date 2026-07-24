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
    `E2E de planos exige banco guia_test (recebido: ${process.env.DATABASE_URL}). ` +
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

/** Limpa na ordem turma/matrícula → plano → user (FKs impedem o inverso). */
async function cleanDatabase(prisma: PrismaService): Promise<void> {
  await prisma.turmaPlano.deleteMany({});
  await prisma.matricula.deleteMany({});
  await prisma.turma.deleteMany({});
  await prisma.plano.deleteMany({});
  await prisma.user.deleteMany({});
}

describe('Planos de Estudo (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const senha = 'senha-planos-e2e';
  let professorToken: string;
  let aluno1Token: string;
  let aluno2Token: string;
  let professorId: string;
  let aluno1Id: string;

  // Estado compartilhado do fluxo (testes sequenciais, como na suíte de auth)
  let oficialId: string; // OFICIAL que será publicado (Fluxo A)
  let rascunhoId: string; // OFICIAL que permanece rascunho
  let rascunhoDisciplinaId: string;
  let rascunhoTemaId: string;
  let rascunhoSubtemaId: string;
  let discPortuguesId: string;
  let discDireitoId: string;
  let temaColocacaoId: string;
  let pessoalAluno1Id: string; // PESSOAL do zero do aluno1
  let pessoalAluno1DiscId: string;
  let pessoalAluno2Id: string;
  let derivadoId: string; // PESSOAL derivado pelo aluno1
  let derivadoDiscId: string;
  let derivadoSubtemaId: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** Snapshot bruto (via Prisma) de toda a árvore + pesos de um plano, para CA-07. */
  async function snapshotPlano(planoId: string): Promise<unknown> {
    const [plano, disciplinas, temas, subtemas, pesos] = await Promise.all([
      prisma.plano.findUnique({ where: { id: planoId } }),
      prisma.disciplina.findMany({ where: { planoId }, orderBy: { id: 'asc' } }),
      prisma.tema.findMany({
        where: { disciplina: { planoId } },
        orderBy: { id: 'asc' },
      }),
      prisma.subtema.findMany({
        where: { tema: { disciplina: { planoId } } },
        orderBy: { id: 'asc' },
      }),
      prisma.pesoDisciplina.findMany({ where: { planoId }, orderBy: { id: 'asc' } }),
    ]);
    // Normaliza Dates/Decimals para comparação byte-a-byte via JSON
    return JSON.parse(JSON.stringify({ plano, disciplinas, temas, subtemas, pesos }));
  }

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    await cleanDatabase(prisma);

    const senhaHash = await hashPassword(senha);
    const professor = await prisma.user.create({
      data: {
        nome: 'Professor Planos',
        email: 'professor.planos@guia.test',
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
        email: 'aluno1.planos@guia.test',
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
        email: 'aluno2.planos@guia.test',
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
    professorToken = await login('professor.planos@guia.test');
    aluno1Token = await login('aluno1.planos@guia.test');
    aluno2Token = await login('aluno2.planos@guia.test');
  });

  afterAll(async () => {
    // Limpeza na ordem certa para não quebrar as demais suítes (FK autor_id)
    await cleanDatabase(prisma);
    await app.close();
  });

  // -------------------------------------------------------------------------
  // Autenticação e RN-01 (CA-01/CA-02)
  // -------------------------------------------------------------------------

  it('GET /planos sem token → 401 UNAUTHENTICATED', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/planos').expect(401);
    expectErrorEnvelope(res, 'UNAUTHENTICATED');
  });

  it('professor cria plano OFICIAL → 201 { plano } com publicado=false e autorId (Fluxo A/1)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/planos')
      .set(auth(professorToken))
      .send({ titulo: 'Analista TRF', descricao: 'Plano oficial da turma', tipo: 'OFICIAL' })
      .expect(201);

    expect(res.body.plano).toMatchObject({
      id: expect.any(String),
      titulo: 'Analista TRF',
      descricao: 'Plano oficial da turma',
      tipo: 'OFICIAL',
      autorId: professorId,
      planoOrigemId: null,
      publicado: false,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    oficialId = res.body.plano.id;
  });

  it('aluno tenta criar OFICIAL → 403 FORBIDDEN (CA-01)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/planos')
      .set(auth(aluno1Token))
      .send({ titulo: 'Oficial pirata', tipo: 'OFICIAL' })
      .expect(403);
    expectErrorEnvelope(res, 'FORBIDDEN');
  });

  it('professor tenta criar PESSOAL → 403 (RN-01)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/planos')
      .set(auth(professorToken))
      .send({ titulo: 'Pessoal do professor', tipo: 'PESSOAL' })
      .expect(403);
    expectErrorEnvelope(res, 'FORBIDDEN');
  });

  it('aluno cria PESSOAL do zero → 201 com autorId = aluno (CA-02/US-05)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/planos')
      .set(auth(aluno1Token))
      .send({ titulo: 'Meu plano do zero', tipo: 'PESSOAL' })
      .expect(201);
    expect(res.body.plano).toMatchObject({
      tipo: 'PESSOAL',
      autorId: aluno1Id,
      publicado: false,
    });
    pessoalAluno1Id = res.body.plano.id;
  });

  it('PATCH /planos/{id} com campo tipo no body → 422 (tipo imutável, DT-06)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/planos/${oficialId}`)
      .set(auth(professorToken))
      .send({ titulo: 'Analista TRF', tipo: 'PESSOAL' })
      .expect(422);
    expectErrorEnvelope(res, 'VALIDATION_ERROR');
  });

  // -------------------------------------------------------------------------
  // Fluxo A — conteúdo, pesos e publicação
  // -------------------------------------------------------------------------

  it('publicar OFICIAL sem disciplinas → 422 com details de disciplinas e pesos (CA-05/CB-01)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/planos/${oficialId}/publicar`)
      .set(auth(professorToken))
      .expect(422);
    expectErrorEnvelope(res, 'VALIDATION_ERROR');
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'disciplinas' }),
        { field: 'pesoPercentual', issue: 'soma deve ser 100' },
      ]),
    );
  });

  it('professor monta a árvore: disciplinas → temas → subtemas (Fluxo A/2)', async () => {
    const server = app.getHttpServer();

    // Criadas fora de ordem de propósito, para validar a ordenação por `ordem`
    const direito = await request(server)
      .post(`/api/v1/planos/${oficialId}/disciplinas`)
      .set(auth(professorToken))
      .send({ nome: 'Direito Administrativo', ordem: 2 })
      .expect(201);
    expect(direito.body.disciplina).toMatchObject({
      planoId: oficialId,
      nome: 'Direito Administrativo',
      ordem: 2,
    });
    discDireitoId = direito.body.disciplina.id;

    const portugues = await request(server)
      .post(`/api/v1/planos/${oficialId}/disciplinas`)
      .set(auth(professorToken))
      .send({ nome: 'Português', ordem: 1 })
      .expect(201);
    discPortuguesId = portugues.body.disciplina.id;

    const tema = await request(server)
      .post(`/api/v1/disciplinas/${discPortuguesId}/temas`)
      .set(auth(professorToken))
      .send({ nome: 'Colocação pronominal', ordem: 1 })
      .expect(201);
    expect(tema.body.tema).toMatchObject({ disciplinaId: discPortuguesId, ordem: 1 });
    temaColocacaoId = tema.body.tema.id;

    // Subtemas fora de ordem
    const mesoclise = await request(server)
      .post(`/api/v1/temas/${temaColocacaoId}/subtemas`)
      .set(auth(professorToken))
      .send({ nome: 'Mesóclise', ordem: 2, duracaoEstimadaMin: 30 })
      .expect(201);
    expect(mesoclise.body.subtema).toMatchObject({
      temaId: temaColocacaoId,
      nome: 'Mesóclise',
      ordem: 2,
      duracaoEstimadaMin: 30,
    });

    await request(server)
      .post(`/api/v1/temas/${temaColocacaoId}/subtemas`)
      .set(auth(professorToken))
      .send({ nome: 'Próclise', ordem: 1 })
      .expect(201);

    await request(server)
      .post(`/api/v1/disciplinas/${discDireitoId}/temas`)
      .set(auth(professorToken))
      .send({ nome: 'Atos administrativos', ordem: 1 })
      .expect(201);
  });

  it('criar tema em disciplina inexistente → 404; subtema em tema inexistente → 404 (CA-10)', async () => {
    const temaRes = await request(app.getHttpServer())
      .post(`/api/v1/disciplinas/${randomUUID()}/temas`)
      .set(auth(professorToken))
      .send({ nome: 'Órfão', ordem: 1 })
      .expect(404);
    expectErrorEnvelope(temaRes, 'NOT_FOUND');

    const subtemaRes = await request(app.getHttpServer())
      .post(`/api/v1/temas/${randomUUID()}/subtemas`)
      .set(auth(professorToken))
      .send({ nome: 'Órfão', ordem: 1 })
      .expect(404);
    expectErrorEnvelope(subtemaRes, 'NOT_FOUND');
  });

  it('PUT pesos com Σ = 99.99 → 422 com details exatos (CA-03/CB-02)', async () => {
    const res = await request(app.getHttpServer())
      .put(`/api/v1/planos/${oficialId}/pesos`)
      .set(auth(professorToken))
      .send({
        pesos: [
          { disciplinaId: discPortuguesId, pesoPercentual: 59.99 },
          { disciplinaId: discDireitoId, pesoPercentual: 40.0 },
        ],
      })
      .expect(422);
    expectErrorEnvelope(res, 'VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([
      { field: 'pesoPercentual', issue: 'soma deve ser 100' },
    ]);
  });

  it('PUT pesos com Σ = 100.01 → 422 (CB-02)', async () => {
    const res = await request(app.getHttpServer())
      .put(`/api/v1/planos/${oficialId}/pesos`)
      .set(auth(professorToken))
      .send({
        pesos: [
          { disciplinaId: discPortuguesId, pesoPercentual: 60.01 },
          { disciplinaId: discDireitoId, pesoPercentual: 40.0 },
        ],
      })
      .expect(422);
    expect(res.body.error.details).toEqual([
      { field: 'pesoPercentual', issue: 'soma deve ser 100' },
    ]);
  });

  it('PUT pesos com disciplinaId duplicado → 409 CONFLICT (CA-04/CB-06)', async () => {
    const res = await request(app.getHttpServer())
      .put(`/api/v1/planos/${oficialId}/pesos`)
      .set(auth(professorToken))
      .send({
        pesos: [
          { disciplinaId: discPortuguesId, pesoPercentual: 50 },
          { disciplinaId: discPortuguesId, pesoPercentual: 50 },
        ],
      })
      .expect(409);
    expectErrorEnvelope(res, 'CONFLICT');
  });

  it('PUT pesos referenciando disciplina de OUTRO plano → 422 com field=disciplinaId', async () => {
    // Disciplina no plano PESSOAL do aluno1
    const alheia = await request(app.getHttpServer())
      .post(`/api/v1/planos/${pessoalAluno1Id}/disciplinas`)
      .set(auth(aluno1Token))
      .send({ nome: 'Informática', ordem: 1 })
      .expect(201);
    pessoalAluno1DiscId = alheia.body.disciplina.id;

    const res = await request(app.getHttpServer())
      .put(`/api/v1/planos/${oficialId}/pesos`)
      .set(auth(professorToken))
      .send({
        pesos: [
          { disciplinaId: discPortuguesId, pesoPercentual: 50 },
          { disciplinaId: pessoalAluno1DiscId, pesoPercentual: 50 },
        ],
      })
      .expect(422);
    expectErrorEnvelope(res, 'VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([
      expect.objectContaining({ field: 'disciplinaId' }),
    ]);
  });

  it('PUT pesos com Σ = 100.00 → 200 { pesos } como numbers (Fluxo A/3)', async () => {
    const res = await request(app.getHttpServer())
      .put(`/api/v1/planos/${oficialId}/pesos`)
      .set(auth(professorToken))
      .send({
        pesos: [
          { disciplinaId: discPortuguesId, pesoPercentual: 60 },
          { disciplinaId: discDireitoId, pesoPercentual: 40 },
        ],
      })
      .expect(200);

    expect(res.body.pesos).toHaveLength(2);
    const byDisc = Object.fromEntries(
      res.body.pesos.map((p: { disciplinaId: string; pesoPercentual: number }) => [
        p.disciplinaId,
        p.pesoPercentual,
      ]),
    );
    expect(byDisc[discPortuguesId]).toBe(60);
    expect(byDisc[discDireitoId]).toBe(40);
  });

  it('PUT substitui o conjunto: re-enviar pesos não viola o unique (replace-all)', async () => {
    const res = await request(app.getHttpServer())
      .put(`/api/v1/planos/${oficialId}/pesos`)
      .set(auth(professorToken))
      .send({
        pesos: [
          { disciplinaId: discPortuguesId, pesoPercentual: 55.5 },
          { disciplinaId: discDireitoId, pesoPercentual: 44.5 },
        ],
      })
      .expect(200);
    expect(res.body.pesos).toHaveLength(2);

    // Volta ao estado 60/40 e confere o GET
    await request(app.getHttpServer())
      .put(`/api/v1/planos/${oficialId}/pesos`)
      .set(auth(professorToken))
      .send({
        pesos: [
          { disciplinaId: discPortuguesId, pesoPercentual: 60 },
          { disciplinaId: discDireitoId, pesoPercentual: 40 },
        ],
      })
      .expect(200);

    const get = await request(app.getHttpServer())
      .get(`/api/v1/planos/${oficialId}/pesos`)
      .set(auth(professorToken))
      .expect(200);
    expect(get.body.pesos).toHaveLength(2);
  });

  it('aluno tenta publicar → 403 (rota restrita a interno)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/planos/${oficialId}/publicar`)
      .set(auth(aluno1Token))
      .expect(403);
    expectErrorEnvelope(res, 'FORBIDDEN');
  });

  it('publicar com conteúdo e pesos válidos → 200 publicado=true; repetido é idempotente (Fluxo A/4)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/planos/${oficialId}/publicar`)
      .set(auth(professorToken))
      .expect(200);
    expect(res.body.plano).toMatchObject({ id: oficialId, publicado: true });

    const again = await request(app.getHttpServer())
      .post(`/api/v1/planos/${oficialId}/publicar`)
      .set(auth(professorToken))
      .expect(200);
    expect(again.body.plano.publicado).toBe(true);
  });

  it('setup: vincula o OFICIAL publicado a turma com matrícula ATIVA do aluno1 (regra de matrícula)', async () => {
    await vincularPlanoAAlunos(prisma, {
      planoId: oficialId,
      professorId,
      alunoIds: [aluno1Id],
    });
  });

  it('GET /planos/{id} retorna árvore completa ordenada por `ordem` + pesos (RN-07)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/planos/${oficialId}`)
      .set(auth(aluno1Token)) // aluno lê OFICIAL publicado de turma matriculada
      .expect(200);

    const plano = res.body.plano;
    expect(plano.disciplinas.map((d: { nome: string }) => d.nome)).toEqual([
      'Português',
      'Direito Administrativo',
    ]);
    const subtemas = plano.disciplinas[0].temas[0].subtemas;
    expect(subtemas.map((s: { nome: string }) => s.nome)).toEqual(['Próclise', 'Mesóclise']);
    expect(plano.pesos).toHaveLength(2);
    const soma = plano.pesos.reduce(
      (acc: number, p: { pesoPercentual: number }) => acc + p.pesoPercentual,
      0,
    );
    expect(soma).toBe(100);
  });

  // -------------------------------------------------------------------------
  // Fluxo B — derivação (CA-06..CA-09, CB-03, CB-05)
  // -------------------------------------------------------------------------

  it('setup: professor cria OFICIAL rascunho completo (disciplina+tema+subtema+peso)', async () => {
    const server = app.getHttpServer();
    const plano = await request(server)
      .post('/api/v1/planos')
      .set(auth(professorToken))
      .send({ titulo: 'Oficial Rascunho', tipo: 'OFICIAL' })
      .expect(201);
    rascunhoId = plano.body.plano.id;

    const disc = await request(server)
      .post(`/api/v1/planos/${rascunhoId}/disciplinas`)
      .set(auth(professorToken))
      .send({ nome: 'Informática', ordem: 1 })
      .expect(201);
    rascunhoDisciplinaId = disc.body.disciplina.id;

    const tema = await request(server)
      .post(`/api/v1/disciplinas/${rascunhoDisciplinaId}/temas`)
      .set(auth(professorToken))
      .send({ nome: 'Redes', ordem: 1 })
      .expect(201);
    rascunhoTemaId = tema.body.tema.id;

    const subtema = await request(server)
      .post(`/api/v1/temas/${rascunhoTemaId}/subtemas`)
      .set(auth(professorToken))
      .send({ nome: 'TCP/IP', ordem: 1 })
      .expect(201);
    rascunhoSubtemaId = subtema.body.subtema.id;

    await request(server)
      .put(`/api/v1/planos/${rascunhoId}/pesos`)
      .set(auth(professorToken))
      .send({ pesos: [{ disciplinaId: rascunhoDisciplinaId, pesoPercentual: 100 }] })
      .expect(200);
  });

  it('derivar de OFICIAL não publicado → 422 (CA-08/CB-05)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/planos/${rascunhoId}/derivar`)
      .set(auth(aluno1Token))
      .send({})
      .expect(422);
    expectErrorEnvelope(res, 'VALIDATION_ERROR');
  });

  it('derivar de plano PESSOAL → 422 (CA-08)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/planos/${pessoalAluno1Id}/derivar`)
      .set(auth(aluno2Token))
      .send({})
      .expect(422);
    expectErrorEnvelope(res, 'VALIDATION_ERROR');
  });

  it('derivar de plano inexistente → 404', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/planos/${randomUUID()}/derivar`)
      .set(auth(aluno1Token))
      .send({})
      .expect(404);
    expectErrorEnvelope(res, 'NOT_FOUND');
  });

  it('professor tenta derivar → 403 (rota exclusiva de ALUNO)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/planos/${oficialId}/derivar`)
      .set(auth(professorToken))
      .send({})
      .expect(403);
    expectErrorEnvelope(res, 'FORBIDDEN');
  });

  it('aluno deriva OFICIAL publicado → 201 PESSOAL com cópia integral e ids novos (CA-06/CA-09, Fluxo B)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/planos/${oficialId}/derivar`)
      .set(auth(aluno1Token))
      .send({})
      .expect(201);

    const plano = res.body.plano;
    expect(plano).toMatchObject({
      tipo: 'PESSOAL',
      autorId: aluno1Id,
      planoOrigemId: oficialId,
      publicado: false,
      titulo: 'Analista TRF (pessoal)',
    });
    derivadoId = plano.id;
    expect(derivadoId).not.toBe(oficialId);

    // Árvore idêntica em conteúdo, ids todos novos
    expect(plano.disciplinas.map((d: { nome: string }) => d.nome)).toEqual([
      'Português',
      'Direito Administrativo',
    ]);
    const idsOficial = new Set([oficialId, discPortuguesId, discDireitoId, temaColocacaoId]);
    const idsDerivado: string[] = plano.disciplinas.flatMap(
      (d: { id: string; temas: Array<{ id: string; subtemas: Array<{ id: string }> }> }) => [
        d.id,
        ...d.temas.flatMap((t) => [t.id, ...t.subtemas.map((s) => s.id)]),
      ],
    );
    expect(idsDerivado.some((id) => idsOficial.has(id))).toBe(false);

    // Subtemas copiados com conteúdo e duração preservados
    const subtemasPt = plano.disciplinas[0].temas[0].subtemas;
    expect(subtemasPt.map((s: { nome: string }) => s.nome)).toEqual(['Próclise', 'Mesóclise']);
    expect(subtemasPt[1].duracaoEstimadaMin).toBe(30);
    derivadoDiscId = plano.disciplinas[0].id;
    derivadoSubtemaId = subtemasPt[0].id;

    // Σ pesos copiados = 100, remapeados para as disciplinas NOVAS (CA-09)
    expect(plano.pesos).toHaveLength(2);
    const somaPesos = plano.pesos.reduce(
      (acc: number, p: { pesoPercentual: number }) => acc + p.pesoPercentual,
      0,
    );
    expect(somaPesos).toBe(100);
    const discIdsDerivado = plano.disciplinas.map((d: { id: string }) => d.id).sort();
    expect(plano.pesos.map((p: { disciplinaId: string }) => p.disciplinaId).sort()).toEqual(
      discIdsDerivado,
    );
  });

  it('CA-07: edições no derivado NÃO alteram nenhum registro do OFICIAL (antes/depois idênticos)', async () => {
    const antes = await snapshotPlano(oficialId);
    const server = app.getHttpServer();

    // Edita título do plano, renomeia disciplina, remove subtema e rebalanceia pesos
    await request(server)
      .patch(`/api/v1/planos/${derivadoId}`)
      .set(auth(aluno1Token))
      .send({ titulo: 'Meu TRF personalizado' })
      .expect(200);
    await request(server)
      .patch(`/api/v1/disciplinas/${derivadoDiscId}`)
      .set(auth(aluno1Token))
      .send({ nome: 'Português (meu jeito)', ordem: 9 })
      .expect(200);
    await request(server)
      .delete(`/api/v1/subtemas/${derivadoSubtemaId}`)
      .set(auth(aluno1Token))
      .expect(204);

    const derivado = await request(server)
      .get(`/api/v1/planos/${derivadoId}`)
      .set(auth(aluno1Token))
      .expect(200);
    const pesosNovos = derivado.body.plano.disciplinas.map((d: { id: string }, i: number) => ({
      disciplinaId: d.id,
      pesoPercentual: i === 0 ? 50 : 50,
    }));
    await request(server)
      .put(`/api/v1/planos/${derivadoId}/pesos`)
      .set(auth(aluno1Token))
      .send({ pesos: pesosNovos })
      .expect(200);

    const depois = await snapshotPlano(oficialId);
    expect(depois).toEqual(antes); // byte-a-byte (RN-04)
  });

  it('derivar duas vezes → dois PESSOAIS independentes (CB-03)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/planos/${oficialId}/derivar`)
      .set(auth(aluno1Token))
      .send({ titulo: 'Segunda derivação' })
      .expect(201);
    expect(res.body.plano.id).not.toBe(derivadoId);
    expect(res.body.plano).toMatchObject({
      titulo: 'Segunda derivação',
      planoOrigemId: oficialId,
      autorId: aluno1Id,
    });
    // Ids das disciplinas não colidem com a primeira derivação
    const derivado1 = await request(app.getHttpServer())
      .get(`/api/v1/planos/${derivadoId}`)
      .set(auth(aluno1Token))
      .expect(200);
    const ids1 = derivado1.body.plano.disciplinas.map((d: { id: string }) => d.id);
    const ids2 = res.body.plano.disciplinas.map((d: { id: string }) => d.id);
    expect(ids2.filter((id: string) => ids1.includes(id))).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Escopo de listagem e autorização cruzada (CA-12)
  // -------------------------------------------------------------------------

  it('setup: aluno2 cria o próprio PESSOAL', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/planos')
      .set(auth(aluno2Token))
      .send({ titulo: 'Plano do aluno 2', tipo: 'PESSOAL' })
      .expect(201);
    pessoalAluno2Id = res.body.plano.id;
  });

  it('GET /planos como aluno1 → vê OFICIAL publicado + seus PESSOAIS; NÃO vê rascunho nem PESSOAL alheio', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/planos?pageSize=50')
      .set(auth(aluno1Token))
      .expect(200);

    expect(res.body).toMatchObject({
      page: 1,
      pageSize: 50,
      total: expect.any(Number),
    });
    const ids = res.body.data.map((p: { id: string }) => p.id);
    expect(ids).toContain(oficialId);
    expect(ids).toContain(pessoalAluno1Id);
    expect(ids).toContain(derivadoId);
    expect(ids).not.toContain(rascunhoId);
    expect(ids).not.toContain(pessoalAluno2Id);
  });

  it('GET /planos?tipo=PESSOAL como aluno1 → apenas os próprios pessoais', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/planos?tipo=PESSOAL&pageSize=50')
      .set(auth(aluno1Token))
      .expect(200);
    const autores = res.body.data.map((p: { autorId: string }) => p.autorId);
    expect(autores.every((a: string) => a === aluno1Id)).toBe(true);
    expect(res.body.data.map((p: { id: string }) => p.id)).not.toContain(pessoalAluno2Id);
  });

  it('GET /planos como interno → vê rascunhos e planos pessoais de alunos', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/planos?pageSize=50')
      .set(auth(professorToken))
      .expect(200);
    const ids = res.body.data.map((p: { id: string }) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining([oficialId, rascunhoId, pessoalAluno1Id, pessoalAluno2Id]),
    );
  });

  it('GET /planos/{rascunho} como aluno → 403; PESSOAL alheio → 403; inexistente → 404; id inválido → 422', async () => {
    const rascunho = await request(app.getHttpServer())
      .get(`/api/v1/planos/${rascunhoId}`)
      .set(auth(aluno1Token))
      .expect(403);
    expectErrorEnvelope(rascunho, 'FORBIDDEN');

    const alheio = await request(app.getHttpServer())
      .get(`/api/v1/planos/${pessoalAluno2Id}`)
      .set(auth(aluno1Token))
      .expect(403);
    expectErrorEnvelope(alheio, 'FORBIDDEN');

    const inexistente = await request(app.getHttpServer())
      .get(`/api/v1/planos/${randomUUID()}`)
      .set(auth(aluno1Token))
      .expect(404);
    expectErrorEnvelope(inexistente, 'NOT_FOUND');

    const invalido = await request(app.getHttpServer())
      .get('/api/v1/planos/nao-e-uuid')
      .set(auth(aluno1Token))
      .expect(422);
    expectErrorEnvelope(invalido, 'VALIDATION_ERROR');
  });

  it('rotas top-level herdam a autorização do plano: acesso cruzado → 403 (CA-12)', async () => {
    const server = app.getHttpServer();

    // aluno edita disciplina de plano OFICIAL
    const oficialDisc = await request(server)
      .patch(`/api/v1/disciplinas/${discPortuguesId}`)
      .set(auth(aluno1Token))
      .send({ nome: 'Hackeada' })
      .expect(403);
    expectErrorEnvelope(oficialDisc, 'FORBIDDEN');

    // aluno2 edita disciplina do plano PESSOAL do aluno1
    const cruzado = await request(server)
      .patch(`/api/v1/disciplinas/${pessoalAluno1DiscId}`)
      .set(auth(aluno2Token))
      .send({ nome: 'Invadida' })
      .expect(403);
    expectErrorEnvelope(cruzado, 'FORBIDDEN');

    // aluno2 cria tema em disciplina do aluno1
    const tema = await request(server)
      .post(`/api/v1/disciplinas/${pessoalAluno1DiscId}/temas`)
      .set(auth(aluno2Token))
      .send({ nome: 'Intruso', ordem: 1 })
      .expect(403);
    expectErrorEnvelope(tema, 'FORBIDDEN');

    // aluno2 tenta apagar o plano do aluno1
    const remove = await request(server)
      .delete(`/api/v1/planos/${pessoalAluno1Id}`)
      .set(auth(aluno2Token))
      .expect(403);
    expectErrorEnvelope(remove, 'FORBIDDEN');

    // aluno2 tenta trocar os pesos do plano do aluno1
    const pesos = await request(server)
      .put(`/api/v1/planos/${pessoalAluno1Id}/pesos`)
      .set(auth(aluno2Token))
      .send({ pesos: [{ disciplinaId: pessoalAluno1DiscId, pesoPercentual: 100 }] })
      .expect(403);
    expectErrorEnvelope(pesos, 'FORBIDDEN');

    // aluno2 lista subtemas de tema do plano PESSOAL do aluno1? (leitura também nega)
    const leitura = await request(server)
      .get(`/api/v1/planos/${pessoalAluno1Id}/disciplinas`)
      .set(auth(aluno2Token))
      .expect(403);
    expectErrorEnvelope(leitura, 'FORBIDDEN');
  });

  // -------------------------------------------------------------------------
  // Cascatas (CA-11, CB-04)
  // -------------------------------------------------------------------------

  it('DELETE disciplina → 204 e soft delete em cascata de tema/subtema/peso (CB-04)', async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/disciplinas/${rascunhoDisciplinaId}`)
      .set(auth(professorToken))
      .expect(204);

    const [disc, tema, subtema, peso] = await Promise.all([
      prisma.disciplina.findUnique({ where: { id: rascunhoDisciplinaId } }),
      prisma.tema.findUnique({ where: { id: rascunhoTemaId } }),
      prisma.subtema.findUnique({ where: { id: rascunhoSubtemaId } }),
      prisma.pesoDisciplina.findFirst({ where: { disciplinaId: rascunhoDisciplinaId } }),
    ]);
    expect(disc?.deletedAt).not.toBeNull();
    expect(tema?.deletedAt).not.toBeNull();
    expect(subtema?.deletedAt).not.toBeNull();
    expect(peso?.deletedAt).not.toBeNull();

    // Plano ficou inconsistente: publicar → 422 (CB-04)
    const publicar = await request(app.getHttpServer())
      .post(`/api/v1/planos/${rascunhoId}/publicar`)
      .set(auth(professorToken))
      .expect(422);
    expectErrorEnvelope(publicar, 'VALIDATION_ERROR');
  });

  it('DELETE /planos/{id} → 204, some da listagem/GET e cascata soft (CA-11); oficial de origem intacto', async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/planos/${derivadoId}`)
      .set(auth(aluno1Token))
      .expect(204);

    const notFound = await request(app.getHttpServer())
      .get(`/api/v1/planos/${derivadoId}`)
      .set(auth(aluno1Token))
      .expect(404);
    expectErrorEnvelope(notFound, 'NOT_FOUND');

    const [plano, disciplinasAtivas, pesosAtivos] = await Promise.all([
      prisma.plano.findUnique({ where: { id: derivadoId } }),
      prisma.disciplina.count({ where: { planoId: derivadoId, deletedAt: null } }),
      prisma.pesoDisciplina.count({ where: { planoId: derivadoId, deletedAt: null } }),
    ]);
    expect(plano?.deletedAt).not.toBeNull();
    expect(disciplinasAtivas).toBe(0);
    expect(pesosAtivos).toBe(0);

    // O OFICIAL de origem segue publicado e íntegro
    const oficial = await request(app.getHttpServer())
      .get(`/api/v1/planos/${oficialId}`)
      .set(auth(aluno1Token))
      .expect(200);
    expect(oficial.body.plano.publicado).toBe(true);
    expect(oficial.body.plano.disciplinas).toHaveLength(2);
  });
});
