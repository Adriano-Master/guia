import { randomUUID } from 'node:crypto';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Plano } from '@prisma/client';
import { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { PrismaService } from '../../prisma/prisma.service';
import { PlanosAccessService } from '../planos/planos-access.service';
import { percentual } from './progresso-response';
import { ProgressoService } from './progresso.service';

/** Instante fixo: transições de concluidoEm usam fake timers. */
const SYSTEM_NOW = new Date('2026-07-07T12:00:00Z');
const NOW = SYSTEM_NOW;
/** Data ORIGINAL de conclusão, anterior ao relógio atual (CB-05). */
const CONCLUIDO_ORIGINAL = new Date('2026-07-01T09:30:00Z');

function buildUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return { sub: randomUUID(), role: 'ALUNO', origem: 'PROPRIO', ...overrides };
}

function buildPlano(overrides: Partial<Plano> = {}): Plano {
  return {
    id: randomUUID(),
    titulo: 'Analista Progresso',
    descricao: null,
    tipo: 'OFICIAL',
    autorId: randomUUID(),
    planoOrigemId: null,
    publicado: true,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

type ModelMock = {
  findUnique: jest.Mock;
  findFirst: jest.Mock;
  findMany: jest.Mock;
  create: jest.Mock;
  update: jest.Mock;
  upsert: jest.Mock;
};

function modelMock(): ModelMock {
  return {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
  };
}

/** Nó de subtema da árvore que calcularPlano/listarSubtemas consomem. */
interface SubtemaArvore {
  id: string;
  nome: string;
  ordem: number;
}

interface TemaArvore {
  id: string;
  nome: string;
  ordem: number;
  subtemas: SubtemaArvore[];
}

interface DisciplinaArvore {
  id: string;
  nome: string;
  ordem: number;
  temas: TemaArvore[];
}

function subtemaNode(nome: string, ordem: number): SubtemaArvore {
  return { id: randomUUID(), nome, ordem };
}

function progressoDe(
  alunoId: string,
  subtemaId: string,
  concluido = true,
  concluidoEm: Date | null = CONCLUIDO_ORIGINAL,
): { subtemaId: string; concluido: boolean; concluidoEm: Date | null } {
  void alunoId; // o select do service não devolve alunoId; mantido p/ legibilidade
  return { subtemaId, concluido, concluidoEm: concluido ? concluidoEm : null };
}

describe('percentual — guarda de divisão por zero e arredondamento (CA-07, DT-02)', () => {
  it('total = 0 → 0 (CA-07, CB-01)', () => {
    expect(percentual(0, 0)).toBe(0);
    expect(percentual(5, 0)).toBe(0); // defensivo: nunca deve ocorrer, mas não explode
  });

  it('2 casas decimais: 2/3 → 66.67, 1/3 → 33.33, 3/4 → 75, 1/8 → 12.5', () => {
    expect(percentual(2, 3)).toBe(66.67);
    expect(percentual(1, 3)).toBe(33.33);
    expect(percentual(3, 4)).toBe(75);
    expect(percentual(1, 8)).toBe(12.5);
  });

  it('half-up na 2ª casa: 1/800 = 0.125% → 0.13', () => {
    expect(percentual(1, 800)).toBe(0.13);
  });

  it('extremos: 0/n → 0 e n/n → 100 (CB-02)', () => {
    expect(percentual(0, 7)).toBe(0);
    expect(percentual(7, 7)).toBe(100);
  });
});

describe('ProgressoService (unit)', () => {
  let prisma: {
    plano: ModelMock;
    disciplina: ModelMock;
    tema: ModelMock;
    subtema: ModelMock;
    progressoSubtema: ModelMock;
    turmaPlano: ModelMock;
  };
  let service: ProgressoService;

  const aluno = buildUser();
  const outroAluno = buildUser();
  const subtemaId = randomUUID();

  function mockSubtemaValido(plano: Plano = buildPlano()): void {
    prisma.subtema.findUnique.mockResolvedValue({
      id: subtemaId,
      nome: 'Próclise',
      ordem: 1,
      deletedAt: null,
      tema: {
        id: randomUUID(),
        deletedAt: null,
        disciplina: { id: randomUUID(), deletedAt: null, plano },
      },
    });
  }

  beforeEach(() => {
    jest.useFakeTimers({ now: SYSTEM_NOW });
    prisma = {
      plano: modelMock(),
      disciplina: modelMock(),
      tema: modelMock(),
      subtema: modelMock(),
      progressoSubtema: modelMock(),
      turmaPlano: modelMock(),
    };
    service = new ProgressoService(
      prisma as unknown as PrismaService,
      new PlanosAccessService(prisma as unknown as PrismaService),
    );

    // Defaults do caminho feliz (cada teste sobrescreve o que precisar):
    // OFICIAL publicado legível pelo aluno via vínculo TurmaPlano + matrícula
    // ATIVA (regra de matrícula do PlanosAccessService).
    mockSubtemaValido();
    prisma.turmaPlano.findFirst.mockResolvedValue({ id: randomUUID() });
    prisma.progressoSubtema.findUnique.mockResolvedValue(null);
    prisma.progressoSubtema.findMany.mockResolvedValue([]);
    prisma.progressoSubtema.upsert.mockImplementation(
      ({ update }: { update: Record<string, unknown> }) =>
        Promise.resolve({
          id: randomUUID(),
          alunoId: aluno.sub,
          subtemaId,
          concluido: update.concluido,
          concluidoEm: update.concluidoEm,
          createdAt: NOW,
          updatedAt: NOW,
          deletedAt: null,
        }),
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // setConcluido — CA-01..03, CB-05, CB-06, RN-05, DT-04
  // ---------------------------------------------------------------------------

  describe('setConcluido', () => {
    it('marca subtema SEM registro prévio: upsert com concluidoEm = agora UTC (CA-01)', async () => {
      const result = await service.setConcluido(aluno, subtemaId, { concluido: true });

      expect(prisma.progressoSubtema.upsert).toHaveBeenCalledWith({
        where: { alunoId_subtemaId: { alunoId: aluno.sub, subtemaId } },
        create: { alunoId: aluno.sub, subtemaId, concluido: true, concluidoEm: SYSTEM_NOW },
        update: { concluido: true, concluidoEm: SYSTEM_NOW, deletedAt: null },
      });
      expect(result).toEqual({
        subtemaId,
        concluido: true,
        concluidoEm: SYSTEM_NOW.toISOString(),
      });
    });

    it('remarcar já concluído PRESERVA o concluidoEm original mesmo com o relógio adiantado (CB-05, RN-05)', async () => {
      prisma.progressoSubtema.findUnique.mockResolvedValue({
        id: randomUUID(),
        alunoId: aluno.sub,
        subtemaId,
        concluido: true,
        concluidoEm: CONCLUIDO_ORIGINAL,
        deletedAt: null,
      });
      // Relógio avança 3 dias entre a conclusão original e a remarcação
      jest.setSystemTime(new Date('2026-07-10T18:00:00Z'));

      const result = await service.setConcluido(aluno, subtemaId, { concluido: true });

      expect(prisma.progressoSubtema.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { concluido: true, concluidoEm: CONCLUIDO_ORIGINAL, deletedAt: null },
        }),
      );
      expect(result).toEqual({
        subtemaId,
        concluido: true,
        concluidoEm: CONCLUIDO_ORIGINAL.toISOString(),
      });
    });

    it('desmarcar concluído zera concluidoEm (CA-02)', async () => {
      prisma.progressoSubtema.findUnique.mockResolvedValue({
        id: randomUUID(),
        alunoId: aluno.sub,
        subtemaId,
        concluido: true,
        concluidoEm: CONCLUIDO_ORIGINAL,
        deletedAt: null,
      });

      const result = await service.setConcluido(aluno, subtemaId, { concluido: false });

      expect(prisma.progressoSubtema.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { concluido: false, concluidoEm: null, deletedAt: null },
        }),
      );
      expect(result).toEqual({ subtemaId, concluido: false, concluidoEm: null });
    });

    it('desmarcar subtema NUNCA marcado cria registro concluido=false sem erro (CB-06)', async () => {
      const result = await service.setConcluido(aluno, subtemaId, { concluido: false });

      expect(prisma.progressoSubtema.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: { alunoId: aluno.sub, subtemaId, concluido: false, concluidoEm: null },
        }),
      );
      expect(result).toEqual({ subtemaId, concluido: false, concluidoEm: null });
    });

    it('repetir desmarcação é idempotente: mantém false/null (RN-05)', async () => {
      prisma.progressoSubtema.findUnique.mockResolvedValue({
        id: randomUUID(),
        alunoId: aluno.sub,
        subtemaId,
        concluido: false,
        concluidoEm: null,
        deletedAt: null,
      });

      const result = await service.setConcluido(aluno, subtemaId, { concluido: false });
      expect(result).toEqual({ subtemaId, concluido: false, concluidoEm: null });
    });

    it('upsert sempre usa a chave única (alunoId, subtemaId) — CA-03', async () => {
      await service.setConcluido(aluno, subtemaId, { concluido: true });
      await service.setConcluido(aluno, subtemaId, { concluido: true });

      for (const call of prisma.progressoSubtema.upsert.mock.calls) {
        expect(call[0].where).toEqual({
          alunoId_subtemaId: { alunoId: aluno.sub, subtemaId },
        });
      }
      expect(prisma.progressoSubtema.create).not.toHaveBeenCalled();
    });

    it('registro SOFT-DELETED concluido=true é tratado como não concluído: revive com concluidoEm NOVO e deletedAt null', async () => {
      prisma.progressoSubtema.findUnique.mockResolvedValue({
        id: randomUUID(),
        alunoId: aluno.sub,
        subtemaId,
        concluido: true,
        concluidoEm: CONCLUIDO_ORIGINAL,
        deletedAt: new Date('2026-07-05T00:00:00Z'),
      });

      const result = await service.setConcluido(aluno, subtemaId, { concluido: true });

      // NÃO preserva a data antiga do registro morto: transição "de novo" para true
      expect(prisma.progressoSubtema.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { concluido: true, concluidoEm: SYSTEM_NOW, deletedAt: null },
        }),
      );
      expect(result.concluidoEm).toBe(SYSTEM_NOW.toISOString());
    });

    it('subtema inexistente → 404 e upsert NÃO é chamado (CA-09)', async () => {
      prisma.subtema.findUnique.mockResolvedValue(null);

      await expect(service.setConcluido(aluno, subtemaId, { concluido: true })).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.progressoSubtema.upsert).not.toHaveBeenCalled();
    });

    it('subtema/tema/disciplina/plano soft-deleted na cadeia → 404 (CA-09)', async () => {
      const casos = [
        { deletedAt: NOW, tema: { deletedAt: null, disciplina: { deletedAt: null, plano: buildPlano() } } },
        { deletedAt: null, tema: { deletedAt: NOW, disciplina: { deletedAt: null, plano: buildPlano() } } },
        { deletedAt: null, tema: { deletedAt: null, disciplina: { deletedAt: NOW, plano: buildPlano() } } },
        {
          deletedAt: null,
          tema: { deletedAt: null, disciplina: { deletedAt: null, plano: buildPlano({ deletedAt: NOW }) } },
        },
      ];
      for (const caso of casos) {
        prisma.subtema.findUnique.mockResolvedValue({
          id: subtemaId,
          nome: 'x',
          ordem: 1,
          ...caso,
        });
        await expect(
          service.setConcluido(aluno, subtemaId, { concluido: true }),
        ).rejects.toThrow(NotFoundException);
      }
      expect(prisma.progressoSubtema.upsert).not.toHaveBeenCalled();
    });

    it('subtema de plano PESSOAL de OUTRO aluno → 403, nada gravado (CA-08, DT-05)', async () => {
      mockSubtemaValido(buildPlano({ tipo: 'PESSOAL', publicado: false, autorId: outroAluno.sub }));

      await expect(service.setConcluido(aluno, subtemaId, { concluido: true })).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.progressoSubtema.upsert).not.toHaveBeenCalled();
    });

    it('subtema de plano OFICIAL NÃO publicado → 403 (regra de leitura por matrícula)', async () => {
      mockSubtemaValido(buildPlano({ publicado: false }));

      await expect(service.setConcluido(aluno, subtemaId, { concluido: true })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('dono do plano PESSOAL consegue marcar o próprio subtema', async () => {
      mockSubtemaValido(buildPlano({ tipo: 'PESSOAL', publicado: false, autorId: aluno.sub }));

      await expect(
        service.setConcluido(aluno, subtemaId, { concluido: true }),
      ).resolves.toMatchObject({ concluido: true });
    });
  });

  // ---------------------------------------------------------------------------
  // calcularPlano — CA-04..07, CA-10, CB-01, CB-02, DT-02, RN-04
  // ---------------------------------------------------------------------------

  describe('calcularPlano', () => {
    function mockArvore(plano: Plano, disciplinas: DisciplinaArvore[]): void {
      prisma.plano.findUnique.mockResolvedValue(plano);
      prisma.disciplina.findMany.mockResolvedValue(disciplinas);
    }

    it('exemplo completo do design: Português 2/3 + 1/1 → tema 66.67, tema 100, disciplina 75, plano 75', async () => {
      const plano = buildPlano();
      const proclise = subtemaNode('Próclise', 1);
      const mesoclise = subtemaNode('Mesóclise', 2);
      const enclise = subtemaNode('Ênclise', 3);
      const regraGeral = subtemaNode('Regra geral', 1);
      mockArvore(plano, [
        {
          id: randomUUID(),
          nome: 'Português',
          ordem: 1,
          temas: [
            {
              id: randomUUID(),
              nome: 'Colocação pronominal',
              ordem: 1,
              subtemas: [proclise, mesoclise, enclise],
            },
            { id: randomUUID(), nome: 'Crase', ordem: 2, subtemas: [regraGeral] },
          ],
        },
      ]);
      prisma.progressoSubtema.findMany.mockResolvedValue([
        progressoDe(aluno.sub, proclise.id),
        progressoDe(aluno.sub, enclise.id),
        progressoDe(aluno.sub, regraGeral.id),
        // Mesóclise ✗: desmarcada explicitamente não conta no numerador
        progressoDe(aluno.sub, mesoclise.id, false),
      ]);

      const result = await service.calcularPlano(aluno, plano.id);

      expect(result).toMatchObject({
        planoId: plano.id,
        progressoPercentual: 75,
        subtemasConcluidos: 3,
        subtemasTotais: 4,
      });
      const portugues = result.disciplinas[0];
      expect(portugues).toMatchObject({ progressoPercentual: 75, concluidos: 3, totais: 4 });
      expect(portugues.temas[0]).toMatchObject({
        nome: 'Colocação pronominal',
        progressoPercentual: 66.67,
        concluidos: 2,
        totais: 3,
      });
      expect(portugues.temas[1]).toMatchObject({
        nome: 'Crase',
        progressoPercentual: 100,
        concluidos: 1,
        totais: 1,
      });
      // Estado por folha (CA-04) e datas ISO
      expect(portugues.temas[0].subtemas.map((s) => s.concluido)).toEqual([true, false, true]);
      expect(portugues.temas[0].subtemas[0].concluidoEm).toBe(CONCLUIDO_ORIGINAL.toISOString());
      expect(portugues.temas[0].subtemas[1].concluidoEm).toBeNull();
    });

    it('DT-02: agrega por FOLHAS, não média de médias — Tema A 1/1 + Tema B 0/3 → disciplina 25, NÃO 50', async () => {
      const plano = buildPlano();
      const soloA = subtemaNode('Único de A', 1);
      mockArvore(plano, [
        {
          id: randomUUID(),
          nome: 'Raciocínio',
          ordem: 1,
          temas: [
            { id: randomUUID(), nome: 'Tema A', ordem: 1, subtemas: [soloA] },
            {
              id: randomUUID(),
              nome: 'Tema B',
              ordem: 2,
              subtemas: [subtemaNode('B1', 1), subtemaNode('B2', 2), subtemaNode('B3', 3)],
            },
          ],
        },
      ]);
      prisma.progressoSubtema.findMany.mockResolvedValue([progressoDe(aluno.sub, soloA.id)]);

      const result = await service.calcularPlano(aluno, plano.id);

      expect(result.disciplinas[0].progressoPercentual).toBe(25);
      expect(result.disciplinas[0]).toMatchObject({ concluidos: 1, totais: 4 });
      expect(result.progressoPercentual).toBe(25);
      // Percentuais dos filhos continuam certos (100 e 0) — a média deles seria 50
      expect(result.disciplinas[0].temas.map((t) => t.progressoPercentual)).toEqual([100, 0]);
    });

    it('tema SEM subtemas → 0%, e não conta como 100 na disciplina (CA-07, CB-01)', async () => {
      const plano = buildPlano();
      const s1 = subtemaNode('S1', 1);
      mockArvore(plano, [
        {
          id: randomUUID(),
          nome: 'Direito',
          ordem: 1,
          temas: [
            { id: randomUUID(), nome: 'Vazio', ordem: 1, subtemas: [] },
            { id: randomUUID(), nome: 'Cheio', ordem: 2, subtemas: [s1] },
          ],
        },
      ]);
      prisma.progressoSubtema.findMany.mockResolvedValue([progressoDe(aluno.sub, s1.id)]);

      const result = await service.calcularPlano(aluno, plano.id);

      const temaVazio = result.disciplinas[0].temas[0];
      expect(temaVazio).toMatchObject({ progressoPercentual: 0, concluidos: 0, totais: 0 });
      // Disciplina: 1/1 = 100 (o tema vazio não entra em nenhum lado da razão)
      expect(result.disciplinas[0]).toMatchObject({
        progressoPercentual: 100,
        concluidos: 1,
        totais: 1,
      });
    });

    it('plano sem disciplinas → 0% sem divisão por zero (CA-07)', async () => {
      const plano = buildPlano();
      mockArvore(plano, []);

      const result = await service.calcularPlano(aluno, plano.id);

      expect(result).toEqual({
        planoId: plano.id,
        progressoPercentual: 0,
        subtemasConcluidos: 0,
        subtemasTotais: 0,
        disciplinas: [],
      });
    });

    it('todos os subtemas concluídos → 100 em tema, disciplina e plano (CB-02)', async () => {
      const plano = buildPlano();
      const subtemas = [subtemaNode('A', 1), subtemaNode('B', 2), subtemaNode('C', 3)];
      mockArvore(plano, [
        {
          id: randomUUID(),
          nome: 'Português',
          ordem: 1,
          temas: [{ id: randomUUID(), nome: 'Tudo', ordem: 1, subtemas }],
        },
      ]);
      prisma.progressoSubtema.findMany.mockResolvedValue(
        subtemas.map((s) => progressoDe(aluno.sub, s.id)),
      );

      const result = await service.calcularPlano(aluno, plano.id);

      expect(result.progressoPercentual).toBe(100);
      expect(result.disciplinas[0].progressoPercentual).toBe(100);
      expect(result.disciplinas[0].temas[0].progressoPercentual).toBe(100);
    });

    it('progresso de subtema FORA da árvore ativa (soft-deleted) não infla numerador nem denominador (RN-04)', async () => {
      const plano = buildPlano();
      const ativo = subtemaNode('Ativo', 1);
      const deletadoId = randomUUID(); // concluído, mas o subtema saiu da árvore
      mockArvore(plano, [
        {
          id: randomUUID(),
          nome: 'Português',
          ordem: 1,
          temas: [{ id: randomUUID(), nome: 'T', ordem: 1, subtemas: [ativo] }],
        },
      ]);
      prisma.progressoSubtema.findMany.mockResolvedValue([
        progressoDe(aluno.sub, deletadoId),
      ]);

      const result = await service.calcularPlano(aluno, plano.id);

      expect(result).toMatchObject({
        progressoPercentual: 0,
        subtemasConcluidos: 0,
        subtemasTotais: 1,
      });
    });

    it('consulta os progressos escopados ao aluno autenticado e ao plano (RN-03, CA-10)', async () => {
      const plano = buildPlano();
      mockArvore(plano, []);

      await service.calcularPlano(aluno, plano.id);

      expect(prisma.progressoSubtema.findMany).toHaveBeenCalledWith({
        where: {
          alunoId: aluno.sub,
          deletedAt: null,
          subtema: { tema: { disciplina: { planoId: plano.id } } },
        },
        select: { subtemaId: true, concluido: true, concluidoEm: true },
      });
      // Árvore só com nós ativos (RN-04)
      expect(prisma.disciplina.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { planoId: plano.id, deletedAt: null },
        }),
      );
    });

    it('plano inexistente ou soft-deleted → 404', async () => {
      prisma.plano.findUnique.mockResolvedValue(null);
      await expect(service.calcularPlano(aluno, randomUUID())).rejects.toThrow(NotFoundException);

      prisma.plano.findUnique.mockResolvedValue(buildPlano({ deletedAt: NOW }));
      await expect(service.calcularPlano(aluno, randomUUID())).rejects.toThrow(NotFoundException);
      expect(prisma.disciplina.findMany).not.toHaveBeenCalled();
    });

    it('plano PESSOAL de outro aluno → 403 (CA-08)', async () => {
      prisma.plano.findUnique.mockResolvedValue(
        buildPlano({ tipo: 'PESSOAL', publicado: false, autorId: outroAluno.sub }),
      );
      await expect(service.calcularPlano(aluno, randomUUID())).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.disciplina.findMany).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // listarSubtemas — US-04, filtros e ordenação
  // ---------------------------------------------------------------------------

  describe('listarSubtemas', () => {
    const plano = buildPlano();
    const disc1 = randomUUID();
    const disc2 = randomUUID();
    const tema1 = randomUUID(); // disciplina 2 (ordem 2)!
    const tema2 = randomUUID(); // disciplina 1 (ordem 1)

    // Desordenado de propósito: a ordenação é responsabilidade do service.
    // Recriado a cada teste (o service ordena o array retornado in place) e
    // referenciado por NOME, nunca por índice.
    type Row = {
      id: string;
      nome: string;
      ordem: number;
      temaId: string;
      tema: { ordem: number; disciplinaId: string; disciplina: { ordem: number } };
    };
    let rows: Row[];
    const byNome = (nome: string): Row => rows.find((r) => r.nome === nome)!;

    beforeEach(() => {
      rows = [
        {
          id: randomUUID(),
          nome: 'D2-T1-S2',
          ordem: 2,
          temaId: tema1,
          tema: { ordem: 1, disciplinaId: disc2, disciplina: { ordem: 2 } },
        },
        {
          id: randomUUID(),
          nome: 'D1-T1-S1',
          ordem: 1,
          temaId: tema2,
          tema: { ordem: 1, disciplinaId: disc1, disciplina: { ordem: 1 } },
        },
        {
          id: randomUUID(),
          nome: 'D2-T1-S1',
          ordem: 1,
          temaId: tema1,
          tema: { ordem: 1, disciplinaId: disc2, disciplina: { ordem: 2 } },
        },
        {
          id: randomUUID(),
          nome: 'D1-T1-S2',
          ordem: 2,
          temaId: tema2,
          tema: { ordem: 1, disciplinaId: disc1, disciplina: { ordem: 1 } },
        },
      ];
      prisma.plano.findUnique.mockResolvedValue(plano);
      prisma.subtema.findMany.mockResolvedValue(rows);
    });

    it('ordena por disciplina.ordem → tema.ordem → subtema.ordem e mapeia flags', async () => {
      const concluida = byNome('D1-T1-S1');
      prisma.progressoSubtema.findMany.mockResolvedValue([
        progressoDe(aluno.sub, concluida.id), // D1-T1-S1 concluído
      ]);

      const result = await service.listarSubtemas(aluno, { planoId: plano.id });

      expect(result.map((s) => s.nome)).toEqual([
        'D1-T1-S1',
        'D1-T1-S2',
        'D2-T1-S1',
        'D2-T1-S2',
      ]);
      expect(result[0]).toMatchObject({
        subtemaId: concluida.id,
        temaId: tema2,
        disciplinaId: disc1,
        concluido: true,
        concluidoEm: CONCLUIDO_ORIGINAL.toISOString(),
      });
      expect(result[1]).toMatchObject({ concluido: false, concluidoEm: null });
    });

    it('filtro concluido=false devolve só pendentes; concluido=true só concluídos', async () => {
      const concluida = byNome('D1-T1-S1');
      prisma.progressoSubtema.findMany.mockResolvedValue([progressoDe(aluno.sub, concluida.id)]);

      const pendentes = await service.listarSubtemas(aluno, {
        planoId: plano.id,
        concluido: false,
      });
      expect(pendentes).toHaveLength(3);
      expect(pendentes.every((s) => !s.concluido)).toBe(true);

      const concluidos = await service.listarSubtemas(aluno, {
        planoId: plano.id,
        concluido: true,
      });
      expect(concluidos.map((s) => s.subtemaId)).toEqual([concluida.id]);
    });

    it('filtro temaId restringe a query ao tema informado', async () => {
      // O service valida o tema (existe, ativo e do plano) antes de listar.
      prisma.tema.findUnique.mockResolvedValue({
        id: tema1,
        deletedAt: null,
        disciplina: { id: disc2, planoId: plano.id, deletedAt: null, plano },
      });

      await service.listarSubtemas(aluno, { planoId: plano.id, temaId: tema1 });

      expect(prisma.subtema.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            deletedAt: null,
            tema: {
              deletedAt: null,
              id: tema1,
              disciplina: { planoId: plano.id, deletedAt: null },
            },
          },
        }),
      );
    });

    it('REGRESSÃO review: temaId inexistente ou soft-deleted na cadeia → 404, sem listar', async () => {
      prisma.tema.findUnique.mockResolvedValue(null);
      await expect(
        service.listarSubtemas(aluno, { planoId: plano.id, temaId: tema1 }),
      ).rejects.toThrow(NotFoundException);

      // Tema soft-deleted
      prisma.tema.findUnique.mockResolvedValue({
        id: tema1,
        deletedAt: NOW,
        disciplina: { id: disc2, planoId: plano.id, deletedAt: null, plano },
      });
      await expect(
        service.listarSubtemas(aluno, { planoId: plano.id, temaId: tema1 }),
      ).rejects.toThrow(NotFoundException);

      // Disciplina do tema soft-deleted
      prisma.tema.findUnique.mockResolvedValue({
        id: tema1,
        deletedAt: null,
        disciplina: { id: disc2, planoId: plano.id, deletedAt: NOW, plano },
      });
      await expect(
        service.listarSubtemas(aluno, { planoId: plano.id, temaId: tema1 }),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.subtema.findMany).not.toHaveBeenCalled();
    });

    it('REGRESSÃO review: temaId VÁLIDO mas de OUTRO plano → 404 (não 200 [] silencioso)', async () => {
      prisma.tema.findUnique.mockResolvedValue({
        id: tema1,
        deletedAt: null,
        disciplina: { id: disc2, planoId: randomUUID(), deletedAt: null, plano: buildPlano() },
      });

      await expect(
        service.listarSubtemas(aluno, { planoId: plano.id, temaId: tema1 }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.subtema.findMany).not.toHaveBeenCalled();
    });

    it('plano inexistente → 404; plano PESSOAL alheio → 403; nada consultado', async () => {
      prisma.plano.findUnique.mockResolvedValue(null);
      await expect(service.listarSubtemas(aluno, { planoId: plano.id })).rejects.toThrow(
        NotFoundException,
      );

      prisma.plano.findUnique.mockResolvedValue(
        buildPlano({ tipo: 'PESSOAL', publicado: false, autorId: outroAluno.sub }),
      );
      await expect(service.listarSubtemas(aluno, { planoId: plano.id })).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.subtema.findMany).not.toHaveBeenCalled();
    });
  });
});
