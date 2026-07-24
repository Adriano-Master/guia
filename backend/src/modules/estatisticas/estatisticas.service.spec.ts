import { randomUUID } from 'node:crypto';
import { UnprocessableEntityException } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { PrismaService } from '../../prisma/prisma.service';
import {
  minutosParaHoras,
  percentualProgresso,
  SerieTemporalResponse,
} from './estatisticas-response';
import { EstatisticasService } from './estatisticas.service';

/**
 * Instante fixo p/ defaults da série (CA-04): 2026-07-07T12:00Z.
 * Em America/Sao_Paulo (UTC-3, sem DST desde 2019) → wall clock 2026-07-07 09:00.
 */
const SYSTEM_NOW = new Date('2026-07-07T12:00:00Z');
const TZ_SP = 'America/Sao_Paulo';

function buildUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return { sub: randomUUID(), role: 'ALUNO', origem: 'PROPRIO', ...overrides };
}

function getDetails(caught: unknown): Array<{ field: string; issue: string }> {
  expect(caught).toBeInstanceOf(UnprocessableEntityException);
  const body = (caught as UnprocessableEntityException).getResponse() as {
    details: Array<{ field: string; issue: string }>;
  };
  return body.details;
}

type PrismaMock = {
  cronograma: { findFirst: jest.Mock };
  sessaoEstudo: { aggregate: jest.Mock; groupBy: jest.Mock };
  disciplina: { findMany: jest.Mock };
  registroQuestoes: { aggregate: jest.Mock; groupBy: jest.Mock };
  tema: { findMany: jest.Mock };
  progressoSubtema: { findMany: jest.Mock };
  $queryRaw: jest.Mock;
};

function prismaMock(): PrismaMock {
  return {
    cronograma: { findFirst: jest.fn() },
    sessaoEstudo: { aggregate: jest.fn(), groupBy: jest.fn() },
    disciplina: { findMany: jest.fn() },
    registroQuestoes: { aggregate: jest.fn(), groupBy: jest.fn() },
    tema: { findMany: jest.fn() },
    progressoSubtema: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Helpers puros de serialização
// ---------------------------------------------------------------------------

describe('minutosParaHoras (helper — CA-01)', () => {
  it('SUM(duracao_min)/60 com 2 casas half-up', () => {
    expect(minutosParaHoras(0)).toBe(0);
    expect(minutosParaHoras(60)).toBe(1);
    expect(minutosParaHoras(90)).toBe(1.5);
    expect(minutosParaHoras(150)).toBe(2.5);
    expect(minutosParaHoras(50)).toBe(0.83); // 0.8333…
    expect(minutosParaHoras(100)).toBe(1.67); // 1.6666… → half-up
    expect(minutosParaHoras(1)).toBe(0.02); // 0.0166… → half-up
  });
});

describe('percentualProgresso (helper — CA-03)', () => {
  it('denominador 0 → 0 (sem divisão por zero, inclusive defensivo)', () => {
    expect(percentualProgresso(0, 0)).toBe(0);
    expect(percentualProgresso(5, 0)).toBe(0);
  });

  it('1 casa decimal half-up (exigência explícita do CA-03)', () => {
    expect(percentualProgresso(1, 3)).toBe(33.3);
    expect(percentualProgresso(2, 3)).toBe(66.7);
    expect(percentualProgresso(1, 16)).toBe(6.3); // 6.25 → half-up na 1ª casa
    expect(percentualProgresso(1, 6)).toBe(16.7); // 16.666…
    expect(percentualProgresso(0, 7)).toBe(0);
    expect(percentualProgresso(7, 7)).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// EstatisticasService
// ---------------------------------------------------------------------------

describe('EstatisticasService (unit)', () => {
  let prisma: PrismaMock;
  let service: EstatisticasService;
  const aluno = buildUser();
  const planoId = randomUUID();

  beforeEach(() => {
    prisma = prismaMock();
    service = new EstatisticasService(prisma as unknown as PrismaService);

    // Defaults do caminho feliz (cada teste sobrescreve o que precisar)
    prisma.cronograma.findFirst.mockResolvedValue({ planoId, timezone: TZ_SP });
    prisma.sessaoEstudo.aggregate.mockResolvedValue({ _sum: { duracaoMin: null } });
    prisma.sessaoEstudo.groupBy.mockResolvedValue([]);
    prisma.registroQuestoes.aggregate.mockResolvedValue({ _sum: { total: null, erros: null } });
    prisma.registroQuestoes.groupBy.mockResolvedValue([]);
    prisma.disciplina.findMany.mockResolvedValue([]);
    prisma.tema.findMany.mockResolvedValue([]);
    prisma.progressoSubtema.findMany.mockResolvedValue([]);
    prisma.$queryRaw.mockResolvedValue([]);
  });

  // -------------------------------------------------------------------------
  // resumo — CA-01 / CA-03 / CA-05
  // -------------------------------------------------------------------------

  describe('resumo', () => {
    it('CA-01: soma minutos APENAS de sessões finalizadas (fim not null) e não removidas', async () => {
      prisma.sessaoEstudo.aggregate.mockResolvedValue({ _sum: { duracaoMin: 150 } });

      const result = await service.resumo(aluno);

      expect(prisma.sessaoEstudo.aggregate).toHaveBeenCalledWith({
        where: { alunoId: aluno.sub, fim: { not: null }, deletedAt: null },
        _sum: { duracaoMin: true },
      });
      expect(result.horasTotais).toBe(2.5);
    });

    it('sem cronograma ativo → progresso 0/0/0 e NENHUMA consulta à árvore do plano (CA-03)', async () => {
      prisma.cronograma.findFirst.mockResolvedValue(null);

      const result = await service.resumo(aluno);

      expect(result).toEqual({
        horasTotais: 0,
        progresso: { percentual: 0, concluidos: 0, totalSubtemas: 0 },
        questoes: { total: 0, erros: 0, taxaErro: 0 },
      });
      expect(prisma.disciplina.findMany).not.toHaveBeenCalled();
      expect(prisma.progressoSubtema.findMany).not.toHaveBeenCalled();
    });

    it('aluno sem nenhum dado (sums nulos) → tudo 0, taxaErro 0 quando total=0 (CA-05)', async () => {
      const result = await service.resumo(aluno);
      expect(result).toEqual({
        horasTotais: 0,
        progresso: { percentual: 0, concluidos: 0, totalSubtemas: 0 },
        questoes: { total: 0, erros: 0, taxaErro: 0 },
      });
    });

    it('integra os três blocos (horas + progresso do plano ativo + questões)', async () => {
      prisma.sessaoEstudo.aggregate.mockResolvedValue({ _sum: { duracaoMin: 90 } });
      const s1 = randomUUID();
      const s2 = randomUUID();
      prisma.disciplina.findMany.mockResolvedValue([
        { id: randomUUID(), nome: 'Português', temas: [{ subtemas: [{ id: s1 }, { id: s2 }] }] },
      ]);
      prisma.progressoSubtema.findMany.mockResolvedValue([{ subtemaId: s1 }]);
      prisma.registroQuestoes.aggregate.mockResolvedValue({ _sum: { total: 20, erros: 8 } });

      const result = await service.resumo(aluno);

      expect(result).toEqual({
        horasTotais: 1.5,
        progresso: { percentual: 50, concluidos: 1, totalSubtemas: 2 },
        questoes: { total: 20, erros: 8, taxaErro: 0.4 },
      });
    });
  });

  // -------------------------------------------------------------------------
  // horasPorDisciplina — CA-02, RN-01, ordenação e totalHoras
  // -------------------------------------------------------------------------

  describe('horasPorDisciplina', () => {
    it('sem filtro: groupBy escopado (fim not null, deletedAt null), SEM filtro de inicio e SEM resolver contexto', async () => {
      await service.horasPorDisciplina(aluno, {});

      expect(prisma.sessaoEstudo.groupBy).toHaveBeenCalledWith({
        by: ['disciplinaId'],
        where: { alunoId: aluno.sub, fim: { not: null }, deletedAt: null },
        _sum: { duracaoMin: true },
      });
      // Sem from/to não há por que consultar o cronograma (timezone)
      expect(prisma.cronograma.findFirst).not.toHaveBeenCalled();
    });

    it('totalHoras vem da soma dos MINUTOS, não das horas arredondadas (3×50min → 0.83 cada, total 2.5)', async () => {
      const ids = [randomUUID(), randomUUID(), randomUUID()];
      prisma.sessaoEstudo.groupBy.mockResolvedValue(
        ids.map((id) => ({ disciplinaId: id, _sum: { duracaoMin: 50 } })),
      );
      prisma.disciplina.findMany.mockResolvedValue(
        ids.map((id, i) => ({ id, nome: `Disciplina ${i}` })),
      );

      const result = await service.horasPorDisciplina(aluno, {});

      expect(result.data.map((d) => d.horas)).toEqual([0.83, 0.83, 0.83]);
      expect(result.totalHoras).toBe(2.5); // 150/60 — NÃO 0.83×3 = 2.49
    });

    it('ordena horas desc, desempate nome asc e id asc (estável)', async () => {
      const idAlfa1 = '11111111-1111-4111-8111-111111111111';
      const idAlfa2 = '22222222-2222-4222-8222-222222222222';
      const idZebra = '33333333-3333-4333-8333-333333333333';
      const idMenor = '44444444-4444-4444-8444-444444444444';
      prisma.sessaoEstudo.groupBy.mockResolvedValue([
        { disciplinaId: idZebra, _sum: { duracaoMin: 120 } },
        { disciplinaId: idAlfa2, _sum: { duracaoMin: 120 } },
        { disciplinaId: idMenor, _sum: { duracaoMin: 60 } },
        { disciplinaId: idAlfa1, _sum: { duracaoMin: 120 } },
      ]);
      prisma.disciplina.findMany.mockResolvedValue([
        { id: idAlfa1, nome: 'Alfa' },
        { id: idAlfa2, nome: 'Alfa' },
        { id: idZebra, nome: 'Zebra' },
        { id: idMenor, nome: 'Direito' },
      ]);

      const result = await service.horasPorDisciplina(aluno, {});

      expect(result.data).toEqual([
        { disciplinaId: idAlfa1, disciplina: 'Alfa', horas: 2 },
        { disciplinaId: idAlfa2, disciplina: 'Alfa', horas: 2 },
        { disciplinaId: idZebra, disciplina: 'Zebra', horas: 2 },
        { disciplinaId: idMenor, disciplina: 'Direito', horas: 1 },
      ]);
      expect(result.totalHoras).toBe(7);
    });

    it('nome de disciplina soft-deleted preservado: lookup SEM filtro de deletedAt (caso de borda)', async () => {
      const id = randomUUID();
      prisma.sessaoEstudo.groupBy.mockResolvedValue([
        { disciplinaId: id, _sum: { duracaoMin: 60 } },
      ]);
      prisma.disciplina.findMany.mockResolvedValue([{ id, nome: 'Removida' }]);

      const result = await service.horasPorDisciplina(aluno, {});

      expect(prisma.disciplina.findMany).toHaveBeenCalledWith({
        where: { id: { in: [id] } }, // sem deletedAt: null
        select: { id: true, nome: true },
      });
      expect(result.data[0]).toEqual({ disciplinaId: id, disciplina: 'Removida', horas: 1 });
    });

    it('from/to viram recorte INCLUSIVO em dias do timezone do cronograma ativo ([from 00:00, to+1 00:00) UTC)', async () => {
      await service.horasPorDisciplina(aluno, { from: '2026-07-01', to: '2026-07-05' });

      expect(prisma.cronograma.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.sessaoEstudo.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            alunoId: aluno.sub,
            fim: { not: null },
            deletedAt: null,
            inicio: {
              gte: new Date('2026-07-01T03:00:00.000Z'), // 00:00 -03
              lt: new Date('2026-07-06T03:00:00.000Z'), // to+1 dia 00:00 -03
            },
          },
        }),
      );
    });

    it('só from → apenas gte; timezone de OUTRO cronograma (America/Manaus, UTC-4) é respeitado', async () => {
      prisma.cronograma.findFirst.mockResolvedValue({ planoId, timezone: 'America/Manaus' });

      await service.horasPorDisciplina(aluno, { from: '2026-07-01' });

      expect(prisma.sessaoEstudo.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            inicio: { gte: new Date('2026-07-01T04:00:00.000Z') },
          }),
        }),
      );
    });

    it('from > to → 422 com details em from; nada consultado', async () => {
      let caught: unknown;
      try {
        await service.horasPorDisciplina(aluno, { from: '2026-07-10', to: '2026-07-09' });
      } catch (error) {
        caught = error;
      }
      expect(getDetails(caught)).toEqual([
        expect.objectContaining({ field: 'from', issue: expect.stringContaining('posterior') }),
      ]);
      expect(prisma.sessaoEstudo.groupBy).not.toHaveBeenCalled();
      // B3: datas são validadas ANTES de resolver o contexto (sem ida ao banco)
      expect(prisma.cronograma.findFirst).not.toHaveBeenCalled();
    });

    it('B3: data de calendário inexistente (2026-02-30) → 422 em from SEM consultar o contexto', async () => {
      let caught: unknown;
      try {
        await service.horasPorDisciplina(aluno, { from: '2026-02-30' });
      } catch (error) {
        caught = error;
      }
      expect(getDetails(caught)).toEqual([
        expect.objectContaining({ field: 'from', issue: expect.stringContaining('calendário') }),
      ]);
      // Input inválido não custa a query do cronograma nem a agregação
      expect(prisma.cronograma.findFirst).not.toHaveBeenCalled();
      expect(prisma.sessaoEstudo.groupBy).not.toHaveBeenCalled();
    });

    it('B1: disciplina ausente do lookup (removida de fato) → nome fallback "(removida)"', async () => {
      const fantasma = randomUUID();
      prisma.sessaoEstudo.groupBy.mockResolvedValue([
        { disciplinaId: fantasma, _sum: { duracaoMin: 60 } },
      ]);
      prisma.disciplina.findMany.mockResolvedValue([]);

      const result = await service.horasPorDisciplina(aluno, {});
      expect(result.data).toEqual([
        { disciplinaId: fantasma, disciplina: '(removida)', horas: 1 },
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // serieTemporal — CA-04 / RN-03
  // -------------------------------------------------------------------------

  describe('serieTemporal', () => {
    beforeEach(() => {
      jest.useFakeTimers({ now: SYSTEM_NOW });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('granularidade=dia: série CONTÍNUA — buckets sem estudo entram com 0 (CA-04)', async () => {
      prisma.$queryRaw.mockResolvedValue([{ bucket: '2026-07-02', minutos: 90 }]);

      const result = await service.serieTemporal(aluno, {
        granularidade: 'dia',
        from: '2026-07-01',
        to: '2026-07-05',
      });

      expect(result).toEqual({
        granularidade: 'dia',
        from: '2026-07-01',
        to: '2026-07-05',
        timezone: TZ_SP,
        data: [
          { bucket: '2026-07-01', horas: 0 },
          { bucket: '2026-07-02', horas: 1.5 },
          { bucket: '2026-07-03', horas: 0 },
          { bucket: '2026-07-04', horas: 0 },
          { bucket: '2026-07-05', horas: 0 },
        ],
      });
    });

    it('RN-03: binds do SQL usam date_trunc(dia) e fronteiras [from 00:00 tz, to+1 00:00 tz) — nunca UTC bruto', async () => {
      await service.serieTemporal(aluno, { from: '2026-07-09', to: '2026-07-09' });

      // Chamada tagged-template: [strings, gran, timezone, alunoId, fromUtc, toExclUtc]
      const bindValues = prisma.$queryRaw.mock.calls[0].slice(1);
      expect(bindValues).toEqual([
        'day',
        TZ_SP,
        aluno.sub,
        '2026-07-09T03:00:00.000Z',
        '2026-07-10T03:00:00.000Z',
      ]);
    });

    it('granularidade=semana: rotula pela SEGUNDA-FEIRA e cobre semanas parciais no início/fim (RN-03)', async () => {
      // 2026-07-01 é quarta → primeira semana rotulada 2026-06-29 (segunda)
      prisma.$queryRaw.mockResolvedValue([
        { bucket: '2026-06-29', minutos: 60 },
        { bucket: '2026-07-13', minutos: 30 },
      ]);

      const result = await service.serieTemporal(aluno, {
        granularidade: 'semana',
        from: '2026-07-01',
        to: '2026-07-15',
      });

      expect(result.data).toEqual([
        { bucket: '2026-06-29', horas: 1 },
        { bucket: '2026-07-06', horas: 0 }, // semana sem estudo → 0 (contínua)
        { bucket: '2026-07-13', horas: 0.5 },
      ]);
      expect(prisma.$queryRaw.mock.calls[0][1]).toBe('week');
    });

    it('defaults: 30 dias-calendário INCLUSIVOS terminando "hoje" local, ecoados com o timezone (CA-04)', async () => {
      // now = 2026-07-07T12:00Z → 2026-07-07 09:00 em America/Sao_Paulo
      const result = await service.serieTemporal(aluno, {});

      expect(result).toMatchObject({
        granularidade: 'dia', // default
        from: '2026-06-08', // to − 29
        to: '2026-07-07',
        timezone: TZ_SP,
      });
      expect(result.data).toHaveLength(30);
      expect(result.data[0]).toEqual({ bucket: '2026-06-08', horas: 0 });
      expect(result.data[29]).toEqual({ bucket: '2026-07-07', horas: 0 });
    });

    it('sem cronograma ativo → timezone default America/Sao_Paulo ecoado', async () => {
      prisma.cronograma.findFirst.mockResolvedValue(null);
      const result = await service.serieTemporal(aluno, {});
      expect(result.timezone).toBe(TZ_SP);
    });

    it('"hoje" local ≠ "hoje" UTC: às 2026-07-08T01:00Z ainda é 07-07 em São Paulo (RN-03)', async () => {
      jest.setSystemTime(new Date('2026-07-08T01:00:00Z')); // 22:00 do dia 07 em SP
      const result = await service.serieTemporal(aluno, {});
      expect(result.to).toBe('2026-07-07');
      expect(result.from).toBe('2026-06-08');
    });

    it('from == to é aceito (1 bucket); from > to → 422', async () => {
      const umDia = await service.serieTemporal(aluno, { from: '2026-07-01', to: '2026-07-01' });
      expect(umDia.data).toEqual([{ bucket: '2026-07-01', horas: 0 }]);

      let caught: unknown;
      try {
        await service.serieTemporal(aluno, { from: '2026-07-02', to: '2026-07-01' });
      } catch (error) {
        caught = error;
      }
      expect(getDetails(caught)).toEqual([expect.objectContaining({ field: 'from' })]);
    });

    it('datas de calendário inválidas (2026-02-30 / 2026-13-01) → 422 sem tocar o banco', async () => {
      let caught: unknown;
      try {
        await service.serieTemporal(aluno, { from: '2026-02-30' });
      } catch (error) {
        caught = error;
      }
      expect(getDetails(caught)).toEqual([expect.objectContaining({ field: 'from' })]);

      caught = undefined;
      try {
        await service.serieTemporal(aluno, { to: '2026-13-01' });
      } catch (error) {
        caught = error;
      }
      expect(getDetails(caught)).toEqual([expect.objectContaining({ field: 'to' })]);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // Teto do intervalo (achado ALTO do review): dia ≤ 366, semana ≤ 3660 dias
    // -----------------------------------------------------------------------

    it('teto (dia): EXATAMENTE 366 dias inclusivos → 200 com 366 buckets', async () => {
      // 2025-07-01..2026-07-01 = 365 de diferença + 1 (inclusivo) = 366
      const result = await service.serieTemporal(aluno, {
        granularidade: 'dia',
        from: '2025-07-01',
        to: '2026-07-01',
      });
      expect(result.data).toHaveLength(366);
      expect(result.data[0].bucket).toBe('2025-07-01');
      expect(result.data[365].bucket).toBe('2026-07-01');
    });

    it('teto (dia): 367 dias → 422 com details em from, SEM tocar o banco', async () => {
      let caught: unknown;
      try {
        await service.serieTemporal(aluno, {
          granularidade: 'dia',
          from: '2025-06-30',
          to: '2026-07-01',
        });
      } catch (error) {
        caught = error;
      }
      expect(getDetails(caught)).toEqual([
        expect.objectContaining({ field: 'from', issue: expect.stringContaining('366') }),
      ]);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('teto (semana): EXATAMENTE 3660 dias inclusivos → 200; 3661 → 422', async () => {
      // 2016-06-24..2026-07-01 = 3659 de diferença + 1 (inclusivo) = 3660
      const ok = await service.serieTemporal(aluno, {
        granularidade: 'semana',
        from: '2016-06-24',
        to: '2026-07-01',
      });
      // Segundas de 2016-06-20 (semana do from) a 2026-06-29 (semana do to)
      expect(ok.data).toHaveLength(524);
      expect(ok.data[0].bucket).toBe('2016-06-20');
      expect(ok.data[523].bucket).toBe('2026-06-29');

      let caught: unknown;
      try {
        await service.serieTemporal(aluno, {
          granularidade: 'semana',
          from: '2016-06-23', // 3661 dias inclusivos
          to: '2026-07-01',
        });
      } catch (error) {
        caught = error;
      }
      expect(getDetails(caught)).toEqual([
        expect.objectContaining({ field: 'from', issue: expect.stringContaining('3660') }),
      ]);
    });

    it('teto: intervalo extremo 0001-01-01..9999-12-31 → 422 imediato sem materializar buckets', async () => {
      for (const granularidade of ['dia', 'semana'] as const) {
        let caught: unknown;
        try {
          await service.serieTemporal(aluno, {
            granularidade,
            from: '0001-01-01',
            to: '9999-12-31',
          });
        } catch (error) {
          caught = error;
        }
        expect(getDetails(caught)).toEqual([expect.objectContaining({ field: 'from' })]);
      }
      // Nenhuma das duas tentativas chegou ao banco (nem materializou série)
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('teto é checado DEPOIS de from<=to: intervalo absurdo INVERTIDO ainda acusa "posterior"', async () => {
      let caught: unknown;
      try {
        await service.serieTemporal(aluno, { from: '9999-12-31', to: '0001-01-01' });
      } catch (error) {
        caught = error;
      }
      expect(getDetails(caught)).toEqual([
        expect.objectContaining({ field: 'from', issue: expect.stringContaining('posterior') }),
      ]);
    });

    it('teto não afeta os defaults: sem from/to (janela de 30 dias) segue 200', async () => {
      const result = await service.serieTemporal(aluno, {});
      expect(result.data).toHaveLength(30);
    });
  });

  // -------------------------------------------------------------------------
  // progresso — CA-03 / RN-02
  // -------------------------------------------------------------------------

  describe('progresso', () => {
    it('sem cronograma/plano ativo → 0/0/0; porDisciplina [] só quando pedido (CA-03)', async () => {
      prisma.cronograma.findFirst.mockResolvedValue(null);

      const semDetalhe = await service.progresso(aluno, {});
      expect(semDetalhe).toEqual({ percentual: 0, concluidos: 0, totalSubtemas: 0 });
      expect(semDetalhe).not.toHaveProperty('porDisciplina');

      const comDetalhe = await service.progresso(aluno, { porDisciplina: true });
      expect(comDetalhe).toEqual({
        percentual: 0,
        concluidos: 0,
        totalSubtemas: 0,
        porDisciplina: [],
      });
    });

    it('agrega por folhas ATIVAS: filtros deletedAt null em disciplina/tema/subtema e na conclusão (RN-02)', async () => {
      await service.progresso(aluno, {});

      expect(prisma.disciplina.findMany).toHaveBeenCalledWith({
        where: { planoId, deletedAt: null },
        orderBy: { ordem: 'asc' },
        select: {
          id: true,
          nome: true,
          temas: {
            where: { deletedAt: null },
            select: { subtemas: { where: { deletedAt: null }, select: { id: true } } },
          },
        },
      });
      expect(prisma.progressoSubtema.findMany).toHaveBeenCalledWith({
        where: {
          alunoId: aluno.sub,
          concluido: true,
          deletedAt: null,
          subtema: { tema: { disciplina: { planoId } } },
        },
        select: { subtemaId: true },
      });
    });

    it('conclusão de subtema FORA da árvore ativa (soft-deleted) não entra no numerador nem no denominador', async () => {
      const s1 = randomUUID();
      const s2 = randomUUID();
      const s3 = randomUUID();
      const s4 = randomUUID();
      const ghost = randomUUID(); // subtema soft-deleted: fora da árvore
      const d1 = randomUUID();
      const d2 = randomUUID();
      prisma.disciplina.findMany.mockResolvedValue([
        { id: d1, nome: 'Português', temas: [{ subtemas: [{ id: s1 }, { id: s2 }, { id: s3 }] }] },
        { id: d2, nome: 'Matemática', temas: [{ subtemas: [{ id: s4 }] }] },
      ]);
      prisma.progressoSubtema.findMany.mockResolvedValue([
        { subtemaId: s1 },
        { subtemaId: s2 },
        { subtemaId: ghost },
      ]);

      const result = await service.progresso(aluno, { porDisciplina: true });

      // ghost não conta: 2/4 = 50 (não 3/5 nem 3/4)
      expect(result).toEqual({
        percentual: 50,
        concluidos: 2,
        totalSubtemas: 4,
        porDisciplina: [
          { disciplinaId: d1, disciplina: 'Português', percentual: 66.7, concluidos: 2, totalSubtemas: 3 },
          { disciplinaId: d2, disciplina: 'Matemática', percentual: 0, concluidos: 0, totalSubtemas: 1 },
        ],
      });
    });

    it('arredondamento a 1 casa half-up no agregado (1/3 → 33.3)', async () => {
      const subtemas = [randomUUID(), randomUUID(), randomUUID()];
      prisma.disciplina.findMany.mockResolvedValue([
        {
          id: randomUUID(),
          nome: 'Única',
          temas: [{ subtemas: subtemas.map((id) => ({ id })) }],
        },
      ]);
      prisma.progressoSubtema.findMany.mockResolvedValue([{ subtemaId: subtemas[0] }]);

      const result = await service.progresso(aluno, {});
      expect(result.percentual).toBe(33.3);
    });

    it('plano ativo sem subtemas → 0 (denominador 0, CA-03)', async () => {
      prisma.disciplina.findMany.mockResolvedValue([
        { id: randomUUID(), nome: 'Vazia', temas: [{ subtemas: [] }] },
      ]);

      const result = await service.progresso(aluno, { porDisciplina: true });
      expect(result).toMatchObject({ percentual: 0, concluidos: 0, totalSubtemas: 0 });
      expect(result.porDisciplina).toEqual([
        expect.objectContaining({ percentual: 0, concluidos: 0, totalSubtemas: 0 }),
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // desempenhoQuestoes — CA-05 / RN-04
  // -------------------------------------------------------------------------

  describe('desempenhoQuestoes', () => {
    it('sem agruparPor: só totais, sem groupBy; taxaErro derivada com 4 casas (1/3 → 0.3333)', async () => {
      prisma.registroQuestoes.aggregate.mockResolvedValue({ _sum: { total: 3, erros: 1 } });

      const result = await service.desempenhoQuestoes(aluno, {});

      expect(result).toEqual({ total: 3, erros: 1, taxaErro: 0.3333 });
      expect(result).not.toHaveProperty('data');
      expect(prisma.registroQuestoes.groupBy).not.toHaveBeenCalled();
      expect(prisma.registroQuestoes.aggregate).toHaveBeenCalledWith({
        where: { alunoId: aluno.sub, deletedAt: null },
        _sum: { total: true, erros: true },
      });
    });

    it('total=0 → taxaErro 0 (divisão segura, CA-05)', async () => {
      const result = await service.desempenhoQuestoes(aluno, {});
      expect(result).toEqual({ total: 0, erros: 0, taxaErro: 0 });
    });

    it('agruparPor=disciplina: soma temas IRMÃOS da mesma disciplina e deriva a taxa do agregado', async () => {
      const temaA = randomUUID();
      const temaB = randomUUID(); // irmão de temaA (mesma disciplina)
      const temaC = randomUUID();
      const discPt = { id: '11111111-1111-4111-8111-111111111111', nome: 'Português' };
      const discMat = { id: '22222222-2222-4222-8222-222222222222', nome: 'Matemática' };
      prisma.registroQuestoes.aggregate.mockResolvedValue({ _sum: { total: 45, erros: 6 } });
      prisma.registroQuestoes.groupBy.mockResolvedValue([
        { temaId: temaA, _sum: { total: 10, erros: 2 } },
        { temaId: temaB, _sum: { total: 5, erros: 1 } },
        { temaId: temaC, _sum: { total: 30, erros: 3 } },
      ]);
      prisma.tema.findMany.mockResolvedValue([
        { id: temaA, nome: 'Crase', disciplina: discPt },
        { id: temaB, nome: 'Concordância', disciplina: discPt },
        { id: temaC, nome: 'Frações', disciplina: discMat },
      ]);

      const result = await service.desempenhoQuestoes(aluno, { agruparPor: 'disciplina' });

      expect(result).toMatchObject({ total: 45, erros: 6, taxaErro: 0.1333 });
      // Ordenação: total desc → Matemática (30) antes de Português (15)
      expect(result.data).toEqual([
        { disciplinaId: discMat.id, nome: 'Matemática', total: 30, erros: 3, taxaErro: 0.1 },
        { disciplinaId: discPt.id, nome: 'Português', total: 15, erros: 3, taxaErro: 0.2 },
      ]);
    });

    it('agruparPor=tema: uma linha por tema; nomes soft-deleted preservados (lookup SEM deletedAt)', async () => {
      const temaA = randomUUID();
      prisma.registroQuestoes.groupBy.mockResolvedValue([
        { temaId: temaA, _sum: { total: 20, erros: 8 } },
      ]);
      prisma.tema.findMany.mockResolvedValue([
        {
          id: temaA,
          nome: 'Tema Removido',
          disciplina: { id: randomUUID(), nome: 'Disciplina Removida' },
        },
      ]);

      const result = await service.desempenhoQuestoes(aluno, { agruparPor: 'tema' });

      expect(prisma.tema.findMany).toHaveBeenCalledWith({
        where: { id: { in: [temaA] } }, // sem deletedAt: null
        select: { id: true, nome: true, disciplina: { select: { id: true, nome: true } } },
      });
      expect(result.data).toEqual([
        { temaId: temaA, nome: 'Tema Removido', total: 20, erros: 8, taxaErro: 0.4 },
      ]);
    });

    it('ordenação do detalhamento por tema: total desc, nome asc, id asc', async () => {
      const t1 = '11111111-1111-4111-8111-111111111111';
      const t2 = '22222222-2222-4222-8222-222222222222';
      const t3 = '33333333-3333-4333-8333-333333333333';
      const disciplina = { id: randomUUID(), nome: 'Português' };
      prisma.registroQuestoes.groupBy.mockResolvedValue([
        { temaId: t3, _sum: { total: 10, erros: 1 } },
        { temaId: t2, _sum: { total: 10, erros: 2 } }, // mesmo total e MESMO nome de t3
        { temaId: t1, _sum: { total: 5, erros: 0 } },
      ]);
      prisma.tema.findMany.mockResolvedValue([
        { id: t1, nome: 'Aaa', disciplina },
        { id: t2, nome: 'Zzz', disciplina },
        { id: t3, nome: 'Zzz', disciplina },
      ]);

      const result = await service.desempenhoQuestoes(aluno, { agruparPor: 'tema' });
      expect(result.data!.map((d) => d.temaId)).toEqual([t2, t3, t1]);
    });

    it('grupo cujo tema não existe mais no lookup: tema → nome "(removido)" ; disciplina → grupo ignorado', async () => {
      const fantasma = randomUUID();
      prisma.registroQuestoes.groupBy.mockResolvedValue([
        { temaId: fantasma, _sum: { total: 10, erros: 5 } },
      ]);
      prisma.tema.findMany.mockResolvedValue([]);

      const porTema = await service.desempenhoQuestoes(aluno, { agruparPor: 'tema' });
      expect(porTema.data).toEqual([
        { temaId: fantasma, nome: '(removido)', total: 10, erros: 5, taxaErro: 0.5 },
      ]);

      const porDisciplina = await service.desempenhoQuestoes(aluno, {
        agruparPor: 'disciplina',
      });
      expect(porDisciplina.data).toEqual([]);
    });

    it('guarda de _sum nulo no groupBy: total/erros 0 e taxaErro 0', async () => {
      const temaA = randomUUID();
      prisma.registroQuestoes.groupBy.mockResolvedValue([
        { temaId: temaA, _sum: { total: null, erros: null } },
      ]);
      prisma.tema.findMany.mockResolvedValue([
        { id: temaA, nome: 'Nulo', disciplina: { id: randomUUID(), nome: 'D' } },
      ]);

      const result = await service.desempenhoQuestoes(aluno, { agruparPor: 'tema' });
      expect(result.data).toEqual([
        { temaId: temaA, nome: 'Nulo', total: 0, erros: 0, taxaErro: 0 },
      ]);
    });

    it('agruparPor sem nenhum registro → data: []', async () => {
      const result = await service.desempenhoQuestoes(aluno, { agruparPor: 'disciplina' });
      expect(result).toEqual({ total: 0, erros: 0, taxaErro: 0, data: [] });
    });
  });

  // Sanidade de tipo: SerieTemporalResponse é o retorno da série (usado acima)
  it('sanidade: serieTemporal devolve o shape tipado da resposta', async () => {
    jest.useFakeTimers({ now: SYSTEM_NOW });
    try {
      const result: SerieTemporalResponse = await service.serieTemporal(aluno, {
        from: '2026-07-01',
        to: '2026-07-01',
      });
      expect(Object.keys(result).sort()).toEqual(
        ['data', 'from', 'granularidade', 'timezone', 'to'].sort(),
      );
    } finally {
      jest.useRealTimers();
    }
  });
});
