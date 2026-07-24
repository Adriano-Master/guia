import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Plano, Prisma } from '@prisma/client';
import { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { PrismaService } from '../../prisma/prisma.service';
import { PlanosAccessService } from '../planos/planos-access.service';
import { CronogramaService } from './cronograma.service';
import { GerarCronogramaDto } from './dto/gerar-cronograma.dto';

/**
 * Instante fixo dos testes de geração: 2026-07-06T12:00:00Z = segunda-feira,
 * 09:00 em America/Sao_Paulo. Com diasSemana [1,3,5], as primeiras ocorrências
 * são seg 06/07 (offset 0), qua 08/07 (+2) e sex 10/07 (+4).
 */
const SYSTEM_NOW = new Date('2026-07-06T12:00:00Z');
const NOW = SYSTEM_NOW;

// Ids legíveis (a ordem lexicográfica só desempata após resto/peso/ordem)
const PORTUGUES = 'disc-a-portugues';
const MATEMATICA = 'disc-b-matematica';
const INFORMATICA = 'disc-c-informatica';
const DIREITO = 'disc-d-direito';

const TZ = 'America/Sao_Paulo';
const CRONOGRAMA_ID = 'cronograma-1';

interface AlocacaoT {
  disciplinaId: string;
  ordem: number;
  peso: Prisma.Decimal;
  minutos: number;
  resto: Prisma.Decimal;
}

interface BlocoCriado {
  disciplinaId: string;
  subtemaId: string | null;
  inicio: Date;
  fim: Date;
  duracaoMin: number;
}

function decimal(value: string | number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function aloc(disciplinaId: string, peso: string | number, ordem: number): AlocacaoT {
  return { disciplinaId, ordem, peso: decimal(peso), minutos: 0, resto: decimal(0) };
}

/** n slots uniformes e contíguos de `dur` minutos (para os testes do Passo 3). */
function uniformSlots(
  n: number,
  dur = 60,
): Array<{ dia: number; inicioMin: number; fimMin: number; offsetDias: number }> {
  return Array.from({ length: n }, (_, i) => ({
    dia: 1,
    inicioMin: 480 + i * dur,
    fimMin: 480 + (i + 1) * dur,
    offsetDias: 0,
  }));
}

function buildUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return { sub: randomUUID(), role: 'ALUNO', origem: 'PROPRIO', ...overrides };
}

function buildPlano(overrides: Partial<Plano> = {}): Plano {
  return {
    id: randomUUID(),
    titulo: 'Analista TRF',
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

function buildPesoRow(disciplinaId: string, peso: string | number, ordem: number) {
  return {
    id: randomUUID(),
    planoId: randomUUID(),
    disciplinaId,
    pesoPercentual: decimal(peso),
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    disciplina: { id: disciplinaId, ordem, deletedAt: null },
  };
}

function getDetails(caught: unknown): Array<{ field: string; issue: string }> {
  expect(caught).toBeInstanceOf(UnprocessableEntityException);
  const body = (caught as UnprocessableEntityException).getResponse() as {
    details: Array<{ field: string; issue: string }>;
  };
  return body.details;
}

/** minutos desde 00:00 UTC do instante */
function minutesOfUtcDay(d: Date): number {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

type ModelMock = {
  findUnique: jest.Mock;
  findUniqueOrThrow: jest.Mock;
  findFirst: jest.Mock;
  findMany: jest.Mock;
  create: jest.Mock;
  createMany: jest.Mock;
  update: jest.Mock;
  updateMany: jest.Mock;
};

function modelMock(): ModelMock {
  return {
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    createMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  };
}

describe('CronogramaService (unit)', () => {
  let prisma: {
    plano: ModelMock;
    pesoDisciplina: ModelMock;
    subtema: ModelMock;
    progressoSubtema: ModelMock;
    cronograma: ModelMock;
    blocoCronograma: ModelMock;
    turmaPlano: ModelMock;
    $transaction: jest.Mock;
  };
  let service: CronogramaService;
  let cronogramaCriado: Record<string, unknown> | undefined;
  let blocosCriados: Array<Record<string, unknown>>;

  const aluno = buildUser();
  const outroAluno = buildUser();

  const DIAS = [1, 3, 5];
  function janelasCanonicas() {
    return DIAS.flatMap((dia) => [
      { dia, inicio: '08:00', fim: '10:00' },
      { dia, inicio: '14:00', fim: '16:00' },
    ]);
  }
  function dtoCanonico(overrides: Partial<GerarCronogramaDto> = {}): GerarCronogramaDto {
    return {
      planoId: randomUUID(),
      diasSemana: [...DIAS],
      janelas: janelasCanonicas(),
      granularidadeMin: 60,
      timezone: TZ,
      ...overrides,
    };
  }

  /** Pesos do exemplo numérico do design: 30/20/20/30, Σ = 100. */
  function mockPesosCanonicos(): void {
    prisma.pesoDisciplina.findMany.mockResolvedValue([
      buildPesoRow(PORTUGUES, '30.00', 1),
      buildPesoRow(MATEMATICA, '20.00', 2),
      buildPesoRow(INFORMATICA, '20.00', 3),
      buildPesoRow(DIREITO, '30.00', 4),
    ]);
  }

  function blocosData(callIndex = 0): BlocoCriado[] {
    return prisma.blocoCronograma.createMany.mock.calls[callIndex][0].data as BlocoCriado[];
  }

  function minutosDe(blocos: BlocoCriado[], disciplinaId: string): number {
    return blocos
      .filter((b) => b.disciplinaId === disciplinaId)
      .reduce((acc, b) => acc + b.duracaoMin, 0);
  }

  beforeEach(() => {
    prisma = {
      plano: modelMock(),
      pesoDisciplina: modelMock(),
      subtema: modelMock(),
      progressoSubtema: modelMock(),
      cronograma: modelMock(),
      blocoCronograma: modelMock(),
      turmaPlano: modelMock(),
      $transaction: jest.fn(
        (arg: unknown): Promise<unknown> =>
          Array.isArray(arg)
            ? Promise.all(arg)
            : (arg as (tx: unknown) => Promise<unknown>)(prisma),
      ),
    };
    service = new CronogramaService(
      prisma as unknown as PrismaService,
      new PlanosAccessService(prisma as unknown as PrismaService),
    );

    // Defaults do caminho feliz (cada teste sobrescreve o que precisar):
    // OFICIAL publicado legível pelo aluno via vínculo TurmaPlano + matrícula
    // ATIVA (regra de matrícula do PlanosAccessService).
    prisma.plano.findUnique.mockResolvedValue(buildPlano());
    prisma.turmaPlano.findFirst.mockResolvedValue({ id: randomUUID() });
    prisma.subtema.findMany.mockResolvedValue([]);
    prisma.progressoSubtema.findMany.mockResolvedValue([]);
    prisma.cronograma.updateMany.mockResolvedValue({ count: 0 });

    cronogramaCriado = undefined;
    blocosCriados = [];
    prisma.cronograma.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => {
        cronogramaCriado = {
          id: CRONOGRAMA_ID,
          geradoEm: NOW,
          createdAt: NOW,
          updatedAt: NOW,
          deletedAt: null,
          ...data,
        };
        return Promise.resolve(cronogramaCriado);
      },
    );
    prisma.blocoCronograma.createMany.mockImplementation(
      ({ data }: { data: Array<Record<string, unknown>> }) => {
        blocosCriados = data.map((b, i) => ({
          id: `bloco-${i}`,
          status: 'PLANEJADO',
          createdAt: NOW,
          updatedAt: NOW,
          deletedAt: null,
          ...b,
        }));
        return Promise.resolve({ count: data.length });
      },
    );
    prisma.cronograma.findUniqueOrThrow.mockImplementation(() =>
      Promise.resolve({
        ...cronogramaCriado,
        blocos: [...blocosCriados].sort(
          (a, b) => (a.inicio as Date).getTime() - (b.inicio as Date).getTime(),
        ),
      }),
    );
  });

  // ---------------------------------------------------------------------------
  // Passo 2 — largest remainder (unit direto no método privado)
  // ---------------------------------------------------------------------------

  // Ajustado na correção do item 1 do review: o Passo 2 agora aloca MINUTOS
  // (design.md: base_d = floor(bruto_d/g)×g) via `alocarMinutos`, não contagem
  // de slots via `alocarSlots` — a versão antiga tratava o slot-resto (< g)
  // como slot cheio e violava a proporcionalidade. Os cenários (uniformes)
  // foram convertidos 1:1 para minutos (slots × 60).
  describe('alocarMinutos — largest remainder sobre minutos', () => {
    it('exemplo do design: 30/20/20/30 em 720 min (12 slots de 60) → [240,120,120,240]', () => {
      const alocacoes = [
        aloc(PORTUGUES, '30.00', 1),
        aloc(MATEMATICA, '20.00', 2),
        aloc(INFORMATICA, '20.00', 3),
        aloc(DIREITO, '30.00', 4),
      ];
      service['alocarMinutos'](alocacoes, 720, 60, 12);

      expect(alocacoes.map((a) => a.minutos)).toEqual([240, 120, 120, 240]);
      expect(alocacoes.reduce((acc, a) => acc + a.minutos, 0)).toBe(720);
    });

    it('pesos indivisíveis 33.33/33.33/33.34 em 7 slots (420 min) → Σ fecha exatamente 420', () => {
      const alocacoes = [
        aloc('disc-a', '33.33', 1),
        aloc('disc-b', '33.33', 2),
        aloc('disc-c', '33.34', 3),
      ];
      service['alocarMinutos'](alocacoes, 420, 60, 7);

      expect(alocacoes.reduce((acc, a) => acc + a.minutos, 0)).toBe(420);
      // bases = [120,120,120]; o slot que sobra vai ao maior resto (33.34)
      expect(alocacoes.map((a) => a.minutos)).toEqual([120, 120, 180]);
    });

    it('pesos 33/33/34 em 10 slots (600 min) → Σ = 600 e diferença máxima de 1 slot entre pesos ~iguais', () => {
      const alocacoes = [
        aloc('disc-a', '33.00', 1),
        aloc('disc-b', '33.00', 2),
        aloc('disc-c', '34.00', 3),
      ];
      service['alocarMinutos'](alocacoes, 600, 60, 10);

      expect(alocacoes.reduce((acc, a) => acc + a.minutos, 0)).toBe(600);
      // brutos = [198,198,204]; a parcela restante vai ao maior resto (34)
      expect(alocacoes.map((a) => a.minutos)).toEqual([180, 180, 240]);
    });

    it('peso muito baixo (1%) recebe ≥ 1 slot (60 min) quando há espaço, doado pela maior', () => {
      const alocacoes = [aloc('disc-baixa', '1.00', 1), aloc('disc-alta', '99.00', 2)];
      service['alocarMinutos'](alocacoes, 720, 60, 12);

      expect(alocacoes[0].minutos).toBeGreaterThanOrEqual(60);
      expect(alocacoes.map((a) => a.minutos)).toEqual([60, 660]);
      expect(alocacoes.reduce((acc, a) => acc + a.minutos, 0)).toBe(720);
    });

    it('sem espaço para todas (2 slots, 3 disciplinas) → Σ = 120 e ninguém fica negativo', () => {
      const alocacoes = [
        aloc('disc-a', '40.00', 1),
        aloc('disc-b', '30.00', 2),
        aloc('disc-c', '30.00', 3),
      ];
      service['alocarMinutos'](alocacoes, 120, 60, 2);

      expect(alocacoes.reduce((acc, a) => acc + a.minutos, 0)).toBe(120);
      expect(alocacoes.every((a) => a.minutos >= 0)).toBe(true);
      // maior resto (48) → disc-a; empate 36/36 desempata por ordem → disc-b
      expect(alocacoes.map((a) => a.minutos)).toEqual([60, 60, 0]);
    });

    it('é determinístico: mesma entrada produz a mesma alocação', () => {
      const run = () => {
        const alocacoes = [
          aloc('disc-a', '17.00', 1),
          aloc('disc-b', '23.00', 2),
          aloc('disc-c', '29.00', 3),
          aloc('disc-d', '31.00', 4),
        ];
        service['alocarMinutos'](alocacoes, 660, 60, 11);
        return alocacoes.map((a) => a.minutos);
      };
      const primeira = run();
      expect(run()).toEqual(primeira);
      expect(primeira.reduce((acc, m) => acc + m, 0)).toBe(660);
    });

    // Regressão do achado crítico do review: com minutosTotais NÃO múltiplo da
    // granularidade (slot-resto), a versão antiga (contagem de slots) tratava o
    // slot de 30 min como slot cheio e dava 300/150 para pesos 50/50.
    it('REGRESSÃO review: 450 min (5×[60+30]), g=60, 50/50 → [240,210], desvio ≤ 1 granularidade', () => {
      const alocacoes = [aloc('disc-a', '50.00', 1), aloc('disc-b', '50.00', 2)];
      service['alocarMinutos'](alocacoes, 450, 60, 10);

      expect(alocacoes.reduce((acc, a) => acc + a.minutos, 0)).toBe(450);
      expect(alocacoes.map((a) => a.minutos)).toEqual([240, 210]);
      for (const a of alocacoes) {
        expect(Math.abs(a.minutos - 225)).toBeLessThanOrEqual(60); // ideal 225/225
      }
    });

    it('REGRESSÃO review: 270 min (3×[60+30]), g=60, 40/35/25 → Σ = 270 e desvio ≤ 1 granularidade', () => {
      const alocacoes = [
        aloc('disc-a', '40.00', 1),
        aloc('disc-b', '35.00', 2),
        aloc('disc-c', '25.00', 3),
      ];
      service['alocarMinutos'](alocacoes, 270, 60, 6);

      expect(alocacoes.reduce((acc, a) => acc + a.minutos, 0)).toBe(270);
      const ideais = [108, 94.5, 67.5]; // peso% × 270
      alocacoes.forEach((a, i) => {
        expect(Math.abs(a.minutos - ideais[i])).toBeLessThanOrEqual(60);
      });
      expect(alocacoes.map((a) => a.minutos)).toEqual([120, 90, 60]);
    });
  });

  // ---------------------------------------------------------------------------
  // Passo 3 — round-robin ponderado
  // ---------------------------------------------------------------------------

  // Ajustado na correção do item 1 do review: o Passo 3 agora pondera o
  // crédito pela DURAÇÃO real de cada slot — assinatura
  // sequenciarDisciplinas(alocacoes, slots, minutosTotais) e alocação em
  // minutos. Cenários uniformes convertidos 1:1 (slots × 60 min).
  describe('sequenciarDisciplinas — round-robin ponderado', () => {
    it('contagem na sequência = slots alocados por disciplina (invariante da spec)', () => {
      const alocacoes = [
        aloc(PORTUGUES, '30.00', 1),
        aloc(MATEMATICA, '20.00', 2),
        aloc(INFORMATICA, '20.00', 3),
        aloc(DIREITO, '30.00', 4),
      ];
      alocacoes[0].minutos = 240;
      alocacoes[1].minutos = 120;
      alocacoes[2].minutos = 120;
      alocacoes[3].minutos = 240;

      const sequencia: string[] = service['sequenciarDisciplinas'](
        alocacoes,
        uniformSlots(12),
        720,
      );

      expect(sequencia).toHaveLength(12);
      const count = (id: string) => sequencia.filter((s) => s === id).length;
      expect(count(PORTUGUES)).toBe(4);
      expect(count(DIREITO)).toBe(4);
      expect(count(MATEMATICA)).toBe(2);
      expect(count(INFORMATICA)).toBe(2);
    });

    it('espalha em vez de amontoar: nenhuma disciplina com ≤ 1/3 dos slots aparece 2x seguidas', () => {
      const alocacoes = [
        aloc(PORTUGUES, '30.00', 1),
        aloc(MATEMATICA, '20.00', 2),
        aloc(INFORMATICA, '20.00', 3),
        aloc(DIREITO, '30.00', 4),
      ];
      alocacoes[0].minutos = 240;
      alocacoes[1].minutos = 120;
      alocacoes[2].minutos = 120;
      alocacoes[3].minutos = 240;

      const sequencia: string[] = service['sequenciarDisciplinas'](
        alocacoes,
        uniformSlots(12),
        720,
      );
      for (let i = 1; i < sequencia.length; i += 1) {
        expect(sequencia[i]).not.toBe(sequencia[i - 1]);
      }
    });

    it('é determinístico entre execuções', () => {
      const build = () => {
        const alocacoes = [
          aloc('disc-a', '50.00', 1),
          aloc('disc-b', '30.00', 2),
          aloc('disc-c', '20.00', 3),
        ];
        alocacoes[0].minutos = 300;
        alocacoes[1].minutos = 180;
        alocacoes[2].minutos = 120;
        return service['sequenciarDisciplinas'](alocacoes, uniformSlots(10), 600) as string[];
      };
      expect(build()).toEqual(build());
    });

    it('disciplina com 0 minutos nunca entra na sequência', () => {
      const alocacoes = [aloc('disc-a', '99.00', 1), aloc('disc-b', '1.00', 2)];
      alocacoes[0].minutos = 300;
      alocacoes[1].minutos = 0;
      const sequencia: string[] = service['sequenciarDisciplinas'](
        alocacoes,
        uniformSlots(5),
        300,
      );
      expect(sequencia).toEqual(['disc-a', 'disc-a', 'disc-a', 'disc-a', 'disc-a']);
    });
  });

  // ---------------------------------------------------------------------------
  // Passo 1/4 — enumeração de slots (resto de janela) e agrupamento
  // ---------------------------------------------------------------------------

  describe('enumerarSlots — resto da janela vira slot menor no final', () => {
    it('08:00–09:10 com granularidade 30 → slots de 30/30/10 min, dentro da janela', () => {
      const slots = service['enumerarSlots'](
        [{ dia: 1, inicio: '08:00', fim: '09:10' }],
        30,
        new Map([[1, 0]]),
      );
      expect(
        slots.map((s: { inicioMin: number; fimMin: number }) => [s.inicioMin, s.fimMin]),
      ).toEqual([
        [480, 510],
        [510, 540],
        [540, 550],
      ]);
    });

    it('ordena por cronologia real da semana (offsetDias), não pelo número do dia', () => {
      // Hoje é qua(3): sex(5) vem antes de seg(1) na semana corrente
      const slots = service['enumerarSlots'](
        [
          { dia: 1, inicio: '08:00', fim: '09:00' },
          { dia: 5, inicio: '08:00', fim: '09:00' },
        ],
        60,
        new Map([
          [1, 5],
          [5, 2],
        ]),
      );
      expect(slots.map((s: { dia: number }) => s.dia)).toEqual([5, 1]);
    });
  });

  describe('agruparBlocos — funde slots contíguos da mesma disciplina', () => {
    it('slots contíguos da mesma disciplina viram um único bloco', () => {
      const slots = [
        { dia: 1, inicioMin: 480, fimMin: 510, offsetDias: 0 },
        { dia: 1, inicioMin: 510, fimMin: 540, offsetDias: 0 },
        { dia: 1, inicioMin: 540, fimMin: 550, offsetDias: 0 },
      ];
      const blocos = service['agruparBlocos'](slots, ['disc-a', 'disc-a', 'disc-a']);
      expect(blocos).toEqual([
        { dia: 1, offsetDias: 0, inicioMin: 480, fimMin: 550, disciplinaId: 'disc-a' },
      ]);
    });

    it('não funde através de janelas não contíguas nem entre disciplinas diferentes', () => {
      const slots = [
        { dia: 1, inicioMin: 480, fimMin: 540, offsetDias: 0 },
        { dia: 1, inicioMin: 540, fimMin: 600, offsetDias: 0 },
        { dia: 1, inicioMin: 840, fimMin: 900, offsetDias: 0 }, // janela da tarde (gap)
      ];
      const blocos = service['agruparBlocos'](slots, ['disc-a', 'disc-b', 'disc-b']);
      expect(
        blocos.map((b: { inicioMin: number; fimMin: number; disciplinaId: string }) => [
          b.disciplinaId,
          b.inicioMin,
          b.fimMin,
        ]),
      ).toEqual([
        ['disc-a', 480, 540],
        ['disc-b', 540, 600],
        ['disc-b', 840, 900],
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  // gerar — exemplo numérico canônico do design + invariantes
  // ---------------------------------------------------------------------------

  describe('gerar — exemplo numérico do design (30/20/20/30, 12h/semana, g=60)', () => {
    beforeEach(() => {
      jest.useFakeTimers({ now: SYSTEM_NOW });
      mockPesosCanonicos();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('conta slots [4,4,2,2] e fecha Σ = 720 min por semana', async () => {
      await service.gerar(aluno, dtoCanonico());

      const blocos = blocosData();
      // 4 semanas materializadas (ADR do service)
      const semana0 = blocos.filter((b) => b.inicio < new Date('2026-07-13T00:00:00Z'));

      expect(minutosDe(semana0, PORTUGUES)).toBe(240); // 4 slots
      expect(minutosDe(semana0, DIREITO)).toBe(240); // 4 slots
      expect(minutosDe(semana0, MATEMATICA)).toBe(120); // 2 slots
      expect(minutosDe(semana0, INFORMATICA)).toBe(120); // 2 slots
      expect(semana0.reduce((acc, b) => acc + b.duracaoMin, 0)).toBe(720);

      // Nas 4 semanas o padrão se repete: 4 × 720 = 2880
      expect(blocos.reduce((acc, b) => acc + b.duracaoMin, 0)).toBe(2880);
      expect(minutosDe(blocos, PORTUGUES)).toBe(960);
      expect(minutosDe(blocos, DIREITO)).toBe(960);
      expect(minutosDe(blocos, MATEMATICA)).toBe(480);
      expect(minutosDe(blocos, INFORMATICA)).toBe(480);
    });

    it('todos os blocos caem nas janelas informadas (em UTC: 11–13h e 17–19h) e nos dias seg/qua/sex', () => {
      return service.gerar(aluno, dtoCanonico()).then(() => {
        const blocos = blocosData();
        expect(blocos.length).toBeGreaterThan(0);
        for (const b of blocos) {
          const inicioMin = minutesOfUtcDay(b.inicio);
          const fimMin = minutesOfUtcDay(b.fim);
          const manha = inicioMin >= 11 * 60 && fimMin <= 13 * 60;
          const tarde = inicioMin >= 17 * 60 && fimMin <= 19 * 60;
          expect(manha || tarde).toBe(true);
          // UTC-3 fixo: dia local = dia UTC nas janelas usadas
          expect([1, 3, 5]).toContain(b.inicio.getUTCDay());
          expect(b.duracaoMin).toBe((b.fim.getTime() - b.inicio.getTime()) / 60_000);
        }
      });
    });

    it('nenhum bloco se sobrepõe (ordenados, fim ≤ próximo início)', async () => {
      await service.gerar(aluno, dtoCanonico());

      const blocos = [...blocosData()].sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
      for (let i = 1; i < blocos.length; i += 1) {
        expect(blocos[i - 1].fim.getTime()).toBeLessThanOrEqual(blocos[i].inicio.getTime());
      }
    });

    it('converte 08:00 America/Sao_Paulo → 11:00Z (ADR-03) no primeiro bloco de segunda', async () => {
      await service.gerar(aluno, dtoCanonico());

      const blocos = [...blocosData()].sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
      expect(blocos[0].inicio.toISOString()).toBe('2026-07-06T11:00:00.000Z');
      expect(blocos[0].fim.toISOString()).toBe('2026-07-06T12:00:00.000Z');
    });

    it('persiste em transação: desativa o cronograma anterior e cria o novo com ativo=true', async () => {
      const result = await service.gerar(aluno, dtoCanonico());

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.cronograma.updateMany).toHaveBeenCalledWith({
        where: { alunoId: aluno.sub, ativo: true, deletedAt: null },
        data: { ativo: false },
      });
      expect(prisma.cronograma.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          alunoId: aluno.sub,
          diasSemana: [1, 3, 5],
          granularidadeMin: 60,
          timezone: TZ,
          ativo: true,
        }),
      });
      const data = prisma.cronograma.create.mock.calls[0][0].data as {
        horasSemanaTotal: Prisma.Decimal;
      };
      expect(data.horasSemanaTotal.equals(decimal(12))).toBe(true);
      expect(result).toMatchObject({ ativo: true, horasSemanaTotal: 12, granularidadeMin: 60 });
      expect(result.blocos).toHaveLength(blocosData().length);
    });

    it('é determinístico: gerar duas vezes com o mesmo estado produz os mesmos blocos', async () => {
      await service.gerar(aluno, dtoCanonico());
      await service.gerar(aluno, dtoCanonico());

      const primeira = blocosData(0).map((b) => ({
        disciplinaId: b.disciplinaId,
        subtemaId: b.subtemaId,
        inicio: b.inicio.toISOString(),
        fim: b.fim.toISOString(),
      }));
      const segunda = blocosData(1).map((b) => ({
        disciplinaId: b.disciplinaId,
        subtemaId: b.subtemaId,
        inicio: b.inicio.toISOString(),
        fim: b.fim.toISOString(),
      }));
      expect(segunda).toEqual(primeira);
    });

    it('peso baixo (1%/99%) na semana canônica: disciplina de 1% recebe exatamente 1 slot', async () => {
      prisma.pesoDisciplina.findMany.mockResolvedValue([
        buildPesoRow('disc-baixa', '1.00', 1),
        buildPesoRow('disc-alta', '99.00', 2),
      ]);

      await service.gerar(aluno, dtoCanonico());

      const semana0 = blocosData().filter((b) => b.inicio < new Date('2026-07-13T00:00:00Z'));
      expect(minutosDe(semana0, 'disc-baixa')).toBe(60);
      expect(minutosDe(semana0, 'disc-alta')).toBe(660);
    });
  });

  // ---------------------------------------------------------------------------
  // gerar — resto de janela + agrupamento ponta a ponta
  // ---------------------------------------------------------------------------

  describe('gerar — janela com resto (08:00–09:10, g=30)', () => {
    beforeEach(() => {
      jest.useFakeTimers({ now: SYSTEM_NOW });
      prisma.pesoDisciplina.findMany.mockResolvedValue([buildPesoRow('disc-unica', '100.00', 1)]);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('slots 30/30/10 fundem em 1 bloco de 70 min por semana, dentro da janela', async () => {
      await service.gerar(aluno, {
        planoId: randomUUID(),
        diasSemana: [1],
        janelas: [{ dia: 1, inicio: '08:00', fim: '09:10' }],
        granularidadeMin: 30,
        timezone: TZ,
      });

      const blocos = blocosData();
      expect(blocos).toHaveLength(4); // 1 bloco × 4 semanas
      expect(blocos[0].inicio.toISOString()).toBe('2026-07-06T11:00:00.000Z');
      expect(blocos[0].fim.toISOString()).toBe('2026-07-06T12:10:00.000Z');
      expect(blocos.every((b) => b.duracaoMin === 70)).toBe(true);

      const data = prisma.cronograma.create.mock.calls[0][0].data as {
        horasSemanaTotal: Prisma.Decimal;
      };
      expect(data.horasSemanaTotal.equals(decimal('1.17'))).toBe(true); // 70/60 em 2 casas
    });
  });

  // ---------------------------------------------------------------------------
  // REGRESSÃO review item 1 — proporcionalidade com slot-resto, fim a fim
  // ---------------------------------------------------------------------------

  describe('gerar — REGRESSÃO review: proporcionalidade com janela não múltipla da granularidade', () => {
    beforeEach(() => {
      jest.useFakeTimers({ now: SYSTEM_NOW });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('5 dias 08:00–09:30, g=60, 50/50 → desvio ≤ 60 min do ideal 225/225 e Σ = 450/semana', async () => {
      prisma.pesoDisciplina.findMany.mockResolvedValue([
        buildPesoRow('disc-a', '50.00', 1),
        buildPesoRow('disc-b', '50.00', 2),
      ]);
      const dias = [1, 2, 3, 4, 5];
      await service.gerar(aluno, {
        planoId: randomUUID(),
        diasSemana: dias,
        janelas: dias.map((dia) => ({ dia, inicio: '08:00', fim: '09:30' })),
        granularidadeMin: 60,
        timezone: TZ,
      });

      const semana0 = blocosData().filter((b) => b.inicio < new Date('2026-07-13T00:00:00Z'));
      const minA = minutosDe(semana0, 'disc-a');
      const minB = minutosDe(semana0, 'disc-b');
      expect(minA + minB).toBe(450);
      // Bug antigo: 300/150 (desvio 75 > granularidade). Critério de aceitação:
      // proporcional ao peso com tolerância de 1 granularidade (60 min).
      expect(Math.abs(minA - 225)).toBeLessThanOrEqual(60);
      expect(Math.abs(minB - 225)).toBeLessThanOrEqual(60);
      // Nas 4 semanas o padrão se repete
      expect(blocosData().reduce((acc, b) => acc + b.duracaoMin, 0)).toBe(1800);
    });

    it('3 disciplinas 40/35/25 em 3 dias 08:00–09:30, g=60 → Σ = 270/semana e desvio ≤ 60 por disciplina', async () => {
      prisma.pesoDisciplina.findMany.mockResolvedValue([
        buildPesoRow('disc-a', '40.00', 1),
        buildPesoRow('disc-b', '35.00', 2),
        buildPesoRow('disc-c', '25.00', 3),
      ]);
      const dias = [1, 3, 5];
      await service.gerar(aluno, {
        planoId: randomUUID(),
        diasSemana: dias,
        janelas: dias.map((dia) => ({ dia, inicio: '08:00', fim: '09:30' })),
        granularidadeMin: 60,
        timezone: TZ,
      });

      const semana0 = blocosData().filter((b) => b.inicio < new Date('2026-07-13T00:00:00Z'));
      expect(semana0.reduce((acc, b) => acc + b.duracaoMin, 0)).toBe(270);
      const ideais: Array<[string, number]> = [
        ['disc-a', 108],
        ['disc-b', 94.5],
        ['disc-c', 67.5],
      ];
      for (const [id, ideal] of ideais) {
        expect(Math.abs(minutosDe(semana0, id) - ideal)).toBeLessThanOrEqual(60);
      }
      // Invariantes gerais continuam: dentro das janelas e sem sobreposição
      const ordenados = [...blocosData()].sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
      for (let i = 1; i < ordenados.length; i += 1) {
        expect(ordenados[i - 1].fim.getTime()).toBeLessThanOrEqual(ordenados[i].inicio.getTime());
      }
      for (const b of ordenados) {
        const inicioMin = minutesOfUtcDay(b.inicio);
        const fimMin = minutesOfUtcDay(b.fim);
        expect(inicioMin).toBeGreaterThanOrEqual(11 * 60); // 08:00 SP
        expect(fimMin).toBeLessThanOrEqual(12 * 60 + 30); // 09:30 SP
      }
    });
  });

  // ---------------------------------------------------------------------------
  // REGRESSÃO review item 3 — janelas de hoje já encerradas não materializam
  // ---------------------------------------------------------------------------

  describe('gerar — REGRESSÃO review: janela de hoje já encerrada não gera bloco', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('agora = 22:00 local, janela 08:00–10:00 de hoje → sem bloco hoje; semanas seguintes têm', async () => {
      // 2026-07-07T01:00:00Z = seg 06/07 22:00 em São Paulo
      jest.useFakeTimers({ now: new Date('2026-07-07T01:00:00Z') });
      prisma.pesoDisciplina.findMany.mockResolvedValue([buildPesoRow('disc-unica', '100.00', 1)]);

      await service.gerar(aluno, {
        planoId: randomUUID(),
        diasSemana: [1],
        janelas: [{ dia: 1, inicio: '08:00', fim: '10:00' }],
        granularidadeMin: 60,
        timezone: TZ,
      });

      const blocos = [...blocosData()].sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
      // Semana 0 (seg 06/07) suprimida; ficam as semanas 1–3
      expect(blocos).toHaveLength(3);
      expect(blocos.every((b) => b.inicio.toISOString() !== '2026-07-06T11:00:00.000Z')).toBe(true);
      expect(blocos[0].inicio.toISOString()).toBe('2026-07-13T11:00:00.000Z');
      expect(blocos.map((b) => b.duracaoMin)).toEqual([120, 120, 120]);
    });

    it('agora = 15:00 local: janela da manhã de hoje some, janela da tarde em curso é mantida por inteiro', async () => {
      // 2026-07-06T18:00:00Z = seg 06/07 15:00 em São Paulo
      jest.useFakeTimers({ now: new Date('2026-07-06T18:00:00Z') });
      prisma.pesoDisciplina.findMany.mockResolvedValue([buildPesoRow('disc-unica', '100.00', 1)]);

      await service.gerar(aluno, {
        planoId: randomUUID(),
        diasSemana: [1],
        janelas: [
          { dia: 1, inicio: '08:00', fim: '10:00' },
          { dia: 1, inicio: '14:00', fim: '16:00' },
        ],
        granularidadeMin: 60,
        timezone: TZ,
      });

      const blocos = [...blocosData()].sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
      // Hoje: só a tarde (em curso, 14:00–16:00 > 15:00); semanas 1–3: manhã + tarde
      expect(blocos).toHaveLength(7);
      expect(blocos.some((b) => b.inicio.toISOString() === '2026-07-06T11:00:00.000Z')).toBe(false);
      expect(blocos[0].inicio.toISOString()).toBe('2026-07-06T17:00:00.000Z');
      expect(blocos[0].duracaoMin).toBe(120); // janela em curso mantida inteira
      const semanasSeguintes = blocos.filter((b) => b.inicio >= new Date('2026-07-13T00:00:00Z'));
      expect(semanasSeguintes).toHaveLength(6); // 2 blocos × 3 semanas
    });
  });

  // ---------------------------------------------------------------------------
  // Review item 2 — corrida na regeneração (índice único parcial + retry)
  // ---------------------------------------------------------------------------

  describe('gerar — corrida na regeneração (P2002 do índice único parcial)', () => {
    const p2002 = () =>
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      });

    beforeEach(() => {
      jest.useFakeTimers({ now: SYSTEM_NOW });
      mockPesosCanonicos();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('P2002 na primeira tentativa → retry único bem-sucedido (transação chamada 2x)', async () => {
      prisma.$transaction.mockRejectedValueOnce(p2002());

      const result = await service.gerar(aluno, dtoCanonico());

      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(result).toMatchObject({ ativo: true, horasSemanaTotal: 12 });
    });

    it('P2002 persistente nas duas tentativas → ConflictException 409', async () => {
      prisma.$transaction.mockRejectedValueOnce(p2002()).mockRejectedValueOnce(p2002());

      await expect(service.gerar(aluno, dtoCanonico())).rejects.toThrow(ConflictException);
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it('erro que não é P2002 → propaga sem retry (transação chamada 1x)', async () => {
      const outro = new Error('conexão caiu');
      prisma.$transaction.mockRejectedValueOnce(outro);

      await expect(service.gerar(aluno, dtoCanonico())).rejects.toThrow('conexão caiu');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('P2002 na primeira e erro diferente no retry → propaga o erro do retry (não vira 409)', async () => {
      prisma.$transaction
        .mockRejectedValueOnce(p2002())
        .mockRejectedValueOnce(new Error('deadlock detectado'));

      await expect(service.gerar(aluno, dtoCanonico())).rejects.toThrow('deadlock detectado');
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Passo 5 — fila de subtemas pendentes
  // ---------------------------------------------------------------------------

  describe('gerar — fila de subtemas (próximo não concluído por tema.ordem, subtema.ordem)', () => {
    beforeEach(() => {
      jest.useFakeTimers({ now: SYSTEM_NOW });
      mockPesosCanonicos();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('pula concluídos, segue a ordem tema/subtema e esgota em null (revisão)', async () => {
      // Devolvidos embaralhados de propósito: o service deve ordenar
      prisma.subtema.findMany.mockResolvedValue([
        { id: 'sub-3', ordem: 1, tema: { id: 'tema-2', ordem: 2, disciplinaId: PORTUGUES } },
        { id: 'sub-2', ordem: 2, tema: { id: 'tema-1', ordem: 1, disciplinaId: PORTUGUES } },
        { id: 'sub-1', ordem: 1, tema: { id: 'tema-1', ordem: 1, disciplinaId: PORTUGUES } },
      ]);
      // sub-1 já concluído → fila pendente = [sub-2, sub-3]
      prisma.progressoSubtema.findMany.mockResolvedValue([{ subtemaId: 'sub-1' }]);

      await service.gerar(aluno, dtoCanonico());

      const portugues = blocosData()
        .filter((b) => b.disciplinaId === PORTUGUES)
        .sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
      expect(portugues).toHaveLength(16); // 4 blocos/semana × 4 semanas

      expect(portugues[0].subtemaId).toBe('sub-2');
      expect(portugues[1].subtemaId).toBe('sub-3');
      expect(portugues.slice(2).every((b) => b.subtemaId === null)).toBe(true);

      // consulta de progresso escopada ao aluno e a concluido=true
      expect(prisma.progressoSubtema.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ alunoId: aluno.sub, concluido: true, deletedAt: null }),
        }),
      );
    });

    it('a fila avança sequencialmente através das semanas (sem reiniciar a cada semana)', async () => {
      // 6 pendentes; Português tem 4 blocos/semana → semana 0 consome 4, semana 1 consome 2
      prisma.subtema.findMany.mockResolvedValue(
        [1, 2, 3, 4, 5, 6].map((n) => ({
          id: `sub-${n}`,
          ordem: n,
          tema: { id: 'tema-1', ordem: 1, disciplinaId: PORTUGUES },
        })),
      );

      await service.gerar(aluno, dtoCanonico());

      const portugues = blocosData()
        .filter((b) => b.disciplinaId === PORTUGUES)
        .sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
      expect(portugues.map((b) => b.subtemaId)).toEqual([
        'sub-1',
        'sub-2',
        'sub-3',
        'sub-4',
        'sub-5',
        'sub-6',
        ...Array<null>(10).fill(null),
      ]);
    });

    it('disciplina sem subtemas pendentes → todos os blocos com subtemaId null (revisão)', async () => {
      await service.gerar(aluno, dtoCanonico());
      expect(blocosData().every((b) => b.subtemaId === null)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // gerar — validações 422 / 404 / 403
  // ---------------------------------------------------------------------------

  describe('gerar — validações de negócio (422)', () => {
    beforeEach(() => {
      jest.useFakeTimers({ now: SYSTEM_NOW });
      mockPesosCanonicos();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    async function esperarDetalhe(
      dto: GerarCronogramaDto,
      detalhe: { field: string; issue: string | RegExp },
    ): Promise<void> {
      let caught: unknown;
      try {
        await service.gerar(aluno, dto);
      } catch (error) {
        caught = error;
      }
      const details = getDetails(caught);
      expect(details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: detalhe.field,
            issue:
              detalhe.issue instanceof RegExp
                ? expect.stringMatching(detalhe.issue)
                : detalhe.issue,
          }),
        ]),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    }

    it('janela menor que a granularidade → 422', async () => {
      await esperarDetalhe(
        dtoCanonico({
          janelas: [{ dia: 1, inicio: '08:00', fim: '08:30' }],
          diasSemana: [1],
          granularidadeMin: 60,
        }),
        { field: 'janelas.0', issue: /granularidade/ },
      );
    });

    it('fim ≤ início → 422', async () => {
      await esperarDetalhe(
        dtoCanonico({ janelas: [{ dia: 1, inicio: '10:00', fim: '08:00' }], diasSemana: [1] }),
        { field: 'janelas.0', issue: 'fim deve ser maior que inicio' },
      );
      await esperarDetalhe(
        dtoCanonico({ janelas: [{ dia: 1, inicio: '08:00', fim: '08:00' }], diasSemana: [1] }),
        { field: 'janelas.0', issue: 'fim deve ser maior que inicio' },
      );
    });

    it('janelas sobrepostas no mesmo dia → 422', async () => {
      await esperarDetalhe(
        dtoCanonico({
          diasSemana: [1],
          janelas: [
            { dia: 1, inicio: '08:00', fim: '10:00' },
            { dia: 1, inicio: '09:00', fim: '11:00' },
          ],
        }),
        { field: 'janelas.1', issue: 'janelas do mesmo dia não podem se sobrepor' },
      );
    });

    it('janelas encostadas (fim == início da próxima) NÃO são sobreposição', async () => {
      await expect(
        service.gerar(
          aluno,
          dtoCanonico({
            diasSemana: [1],
            janelas: [
              { dia: 1, inicio: '08:00', fim: '10:00' },
              { dia: 1, inicio: '10:00', fim: '12:00' },
            ],
          }),
        ),
      ).resolves.toBeDefined();
    });

    it('dia de janela fora de diasSemana → 422', async () => {
      await esperarDetalhe(
        dtoCanonico({
          diasSemana: [1, 3],
          janelas: [
            { dia: 1, inicio: '08:00', fim: '10:00' },
            { dia: 6, inicio: '08:00', fim: '10:00' },
          ],
        }),
        { field: 'janelas.1.dia', issue: 'dia da janela deve estar em diasSemana' },
      );
    });

    it('Σ pesos ≠ 100 (99.99) → 422 "soma deve ser 100"', async () => {
      prisma.pesoDisciplina.findMany.mockResolvedValue([
        buildPesoRow(PORTUGUES, '30.00', 1),
        buildPesoRow(MATEMATICA, '20.00', 2),
        buildPesoRow(INFORMATICA, '20.00', 3),
        buildPesoRow(DIREITO, '29.99', 4),
      ]);
      await esperarDetalhe(dtoCanonico(), { field: 'pesoPercentual', issue: 'soma deve ser 100' });
    });

    it('Σ pesos ≠ 100 (100.01) → 422', async () => {
      prisma.pesoDisciplina.findMany.mockResolvedValue([
        buildPesoRow(PORTUGUES, '50.00', 1),
        buildPesoRow(DIREITO, '50.01', 2),
      ]);
      await esperarDetalhe(dtoCanonico(), { field: 'pesoPercentual', issue: 'soma deve ser 100' });
    });

    it('plano sem disciplinas/pesos → 422', async () => {
      prisma.pesoDisciplina.findMany.mockResolvedValue([]);
      await esperarDetalhe(dtoCanonico(), {
        field: 'planoId',
        issue: 'plano deve ter disciplinas com pesos definidos',
      });
    });

    it('disciplina soft-deletada não conta: Σ dos ativos ≠ 100 → 422', async () => {
      prisma.pesoDisciplina.findMany.mockResolvedValue([
        buildPesoRow(PORTUGUES, '60.00', 1),
        { ...buildPesoRow(DIREITO, '40.00', 2), disciplina: { id: DIREITO, ordem: 2, deletedAt: NOW } },
      ]);
      await esperarDetalhe(dtoCanonico(), { field: 'pesoPercentual', issue: 'soma deve ser 100' });
    });

    it('granularidade default é 30 quando omitida (janela de 20 min → 422)', async () => {
      await esperarDetalhe(
        dtoCanonico({
          diasSemana: [1],
          janelas: [{ dia: 1, inicio: '08:00', fim: '08:20' }],
          granularidadeMin: undefined,
        }),
        { field: 'janelas.0', issue: /ao menos 30 minutos/ },
      );
    });
  });

  describe('gerar — escopo do plano (404/403)', () => {
    beforeEach(() => {
      jest.useFakeTimers({ now: SYSTEM_NOW });
      mockPesosCanonicos();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('plano inexistente → NotFoundException 404', async () => {
      prisma.plano.findUnique.mockResolvedValue(null);
      await expect(service.gerar(aluno, dtoCanonico())).rejects.toThrow(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('plano PESSOAL de outro aluno → ForbiddenException 403', async () => {
      prisma.plano.findUnique.mockResolvedValue(
        buildPlano({ tipo: 'PESSOAL', publicado: false, autorId: outroAluno.sub }),
      );
      await expect(service.gerar(aluno, dtoCanonico())).rejects.toThrow(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('plano OFICIAL não publicado → 403 para aluno', async () => {
      prisma.plano.findUnique.mockResolvedValue(buildPlano({ publicado: false }));
      await expect(service.gerar(aluno, dtoCanonico())).rejects.toThrow(ForbiddenException);
    });
  });

  // ---------------------------------------------------------------------------
  // getAtivo / listBlocos / updateBlocoStatus — escopo por dono
  // ---------------------------------------------------------------------------

  function buildCronogramaRecord(overrides: Record<string, unknown> = {}) {
    return {
      id: CRONOGRAMA_ID,
      alunoId: aluno.sub,
      planoId: randomUUID(),
      diasSemana: [1, 3, 5],
      janelas: janelasCanonicas(),
      horasSemanaTotal: decimal(12),
      granularidadeMin: 60,
      timezone: TZ,
      ativo: true,
      geradoEm: NOW,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
      ...overrides,
    };
  }

  function buildBlocoRecord(overrides: Record<string, unknown> = {}) {
    return {
      id: randomUUID(),
      cronogramaId: CRONOGRAMA_ID,
      disciplinaId: PORTUGUES,
      subtemaId: null,
      inicio: new Date('2026-07-06T11:00:00Z'),
      fim: new Date('2026-07-06T12:00:00Z'),
      duracaoMin: 60,
      status: 'PLANEJADO',
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
      ...overrides,
    };
  }

  describe('getAtivo', () => {
    it('sem cronograma ativo → NotFoundException 404', async () => {
      prisma.cronograma.findFirst.mockResolvedValue(null);
      await expect(service.getAtivo(aluno)).rejects.toThrow(NotFoundException);
      // Ajustado na correção do item 2 do review: orderBy geradoEm desc como
      // defesa adicional ao invariante "1 ativo por aluno".
      expect(prisma.cronograma.findFirst).toHaveBeenCalledWith({
        where: { alunoId: aluno.sub, ativo: true, deletedAt: null },
        orderBy: { geradoEm: 'desc' },
      });
    });

    it('retorna o cronograma ativo do próprio aluno', async () => {
      prisma.cronograma.findFirst.mockResolvedValue(buildCronogramaRecord());
      const result = await service.getAtivo(aluno);
      expect(result).toMatchObject({ id: CRONOGRAMA_ID, ativo: true, horasSemanaTotal: 12 });
    });
  });

  describe('listBlocos', () => {
    it('cronograma inexistente ou soft-deletado → 404', async () => {
      prisma.cronograma.findUnique.mockResolvedValue(null);
      await expect(service.listBlocos(aluno, CRONOGRAMA_ID, {})).rejects.toThrow(
        NotFoundException,
      );

      prisma.cronograma.findUnique.mockResolvedValue(buildCronogramaRecord({ deletedAt: NOW }));
      await expect(service.listBlocos(aluno, CRONOGRAMA_ID, {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('cronograma de outro aluno → ForbiddenException 403 (escopo por dono)', async () => {
      prisma.cronograma.findUnique.mockResolvedValue(
        buildCronogramaRecord({ alunoId: outroAluno.sub }),
      );
      await expect(service.listBlocos(aluno, CRONOGRAMA_ID, {})).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.blocoCronograma.findMany).not.toHaveBeenCalled();
    });

    it('aplica filtro from/to sobre inicio e ordena por inicio asc', async () => {
      prisma.cronograma.findUnique.mockResolvedValue(buildCronogramaRecord());
      prisma.blocoCronograma.findMany.mockResolvedValue([buildBlocoRecord()]);

      const result = await service.listBlocos(aluno, CRONOGRAMA_ID, {
        from: '2026-07-06T00:00:00Z',
        to: '2026-07-13T00:00:00Z',
      });

      // Ajustado na correção do item 4 do review: `to` é fronteira EXCLUSIVA
      // (lt, não lte) — o cliente envia a meia-noite do período seguinte.
      expect(prisma.blocoCronograma.findMany).toHaveBeenCalledWith({
        where: {
          cronogramaId: CRONOGRAMA_ID,
          deletedAt: null,
          inicio: {
            gte: new Date('2026-07-06T00:00:00Z'),
            lt: new Date('2026-07-13T00:00:00Z'),
          },
        },
        orderBy: { inicio: 'asc' },
      });
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ duracaoMin: 60, status: 'PLANEJADO' });
    });

    it('sem from/to não aplica cláusula de intervalo', async () => {
      prisma.cronograma.findUnique.mockResolvedValue(buildCronogramaRecord());
      prisma.blocoCronograma.findMany.mockResolvedValue([]);

      await service.listBlocos(aluno, CRONOGRAMA_ID, {});
      const where = prisma.blocoCronograma.findMany.mock.calls[0][0].where;
      expect(where.inicio).toBeUndefined();
    });
  });

  describe('updateBlocoStatus', () => {
    const blocoId = randomUUID();

    it('bloco inexistente / soft-deletado / de cronograma deletado → 404', async () => {
      prisma.blocoCronograma.findUnique.mockResolvedValue(null);
      await expect(
        service.updateBlocoStatus(aluno, blocoId, { status: 'CONCLUIDO' }),
      ).rejects.toThrow(NotFoundException);

      prisma.blocoCronograma.findUnique.mockResolvedValue({
        ...buildBlocoRecord({ deletedAt: NOW }),
        cronograma: buildCronogramaRecord(),
      });
      await expect(
        service.updateBlocoStatus(aluno, blocoId, { status: 'CONCLUIDO' }),
      ).rejects.toThrow(NotFoundException);

      prisma.blocoCronograma.findUnique.mockResolvedValue({
        ...buildBlocoRecord(),
        cronograma: buildCronogramaRecord({ deletedAt: NOW }),
      });
      await expect(
        service.updateBlocoStatus(aluno, blocoId, { status: 'CONCLUIDO' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('bloco de outro aluno → 403 e nada é atualizado', async () => {
      prisma.blocoCronograma.findUnique.mockResolvedValue({
        ...buildBlocoRecord(),
        cronograma: buildCronogramaRecord({ alunoId: outroAluno.sub }),
      });
      await expect(
        service.updateBlocoStatus(aluno, blocoId, { status: 'CONCLUIDO' }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.blocoCronograma.update).not.toHaveBeenCalled();
    });

    it('dono marca CONCLUIDO → update com o status e resposta serializada', async () => {
      prisma.blocoCronograma.findUnique.mockResolvedValue({
        ...buildBlocoRecord({ id: blocoId }),
        cronograma: buildCronogramaRecord(),
      });
      prisma.blocoCronograma.update.mockResolvedValue(
        buildBlocoRecord({ id: blocoId, status: 'CONCLUIDO' }),
      );

      const result = await service.updateBlocoStatus(aluno, blocoId, { status: 'CONCLUIDO' });

      expect(prisma.blocoCronograma.update).toHaveBeenCalledWith({
        where: { id: blocoId },
        data: { status: 'CONCLUIDO' },
      });
      expect(result.status).toBe('CONCLUIDO');
    });
  });
});
