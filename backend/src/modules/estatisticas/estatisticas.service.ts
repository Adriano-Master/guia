import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { PrismaService } from '../../prisma/prisma.service';
import {
  WallDate,
  addDays,
  wallDateNow,
  weekdayOf,
  zonedTimeToUtc,
} from '../cronograma/timezone.util';
import { taxaErro } from '../questoes/registro-questoes-response';
import { DesempenhoQuestoesQueryDto } from './dto/desempenho-questoes-query.dto';
import { HorasPorDisciplinaQueryDto } from './dto/horas-por-disciplina-query.dto';
import { ProgressoEstatisticasQueryDto } from './dto/progresso-estatisticas-query.dto';
import { SerieTemporalQueryDto } from './dto/serie-temporal-query.dto';
import {
  DesempenhoQuestoesItem,
  DesempenhoQuestoesResponse,
  Granularidade,
  HorasPorDisciplinaResponse,
  ProgressoDisciplinaItem,
  ProgressoEstatisticasResponse,
  ProgressoTotais,
  QuestoesTotais,
  ResumoResponse,
  SerieTemporalBucket,
  SerieTemporalResponse,
  minutosParaHoras,
  percentualProgresso,
} from './estatisticas-response';

const TIMEZONE_DEFAULT = 'America/Sao_Paulo';

/** CA-04: janela default da série — 30 dias de calendário terminando hoje. */
const SERIE_JANELA_DIAS = 30;

/**
 * Teto do intervalo da série (rota síncrona sem rate limit): sem limite, um
 * from/to extremo geraria milhões de buckets. Dia ≤ 366 dias; semana ≤ 3660
 * (~10 anos). Estouro → 422.
 */
const SERIE_MAX_DIAS: Record<Granularidade, number> = { dia: 366, semana: 3660 };

const MS_POR_DIA = 24 * 60 * 60_000;

/** Dias de calendário entre duas datas locais, AMBAS inclusivas. */
function diasInclusivos(from: WallDate, to: WallDate): number {
  const fromUtc = Date.UTC(from.year, from.month - 1, from.day);
  const toUtc = Date.UTC(to.year, to.month - 1, to.day);
  return (toUtc - fromUtc) / MS_POR_DIA + 1;
}

type ContextoAluno = { planoId: string | null; timezone: string };

function toISODate(date: WallDate): string {
  const mm = String(date.month).padStart(2, '0');
  const dd = String(date.day).padStart(2, '0');
  return `${date.year}-${mm}-${dd}`;
}

/** Segunda-feira da semana ISO que contém a data (RN-03: semana inicia segunda). */
function segundaDaSemana(date: WallDate): WallDate {
  return addDays(date, -((weekdayOf(date) + 6) % 7));
}

@Injectable()
export class EstatisticasService {
  constructor(private readonly prisma: PrismaService) {}

  /** Cartões do dashboard: tudo all-time, sem filtros (US-01/03/05). */
  async resumo(user: AuthenticatedUser): Promise<ResumoResponse> {
    const contexto = await this.resolverContexto(user.sub);
    const [minutos, progresso, questoes] = await Promise.all([
      this.somarMinutos(user.sub),
      this.agregarProgresso(user.sub, contexto.planoId),
      this.somarQuestoes(user.sub),
    ]);
    return {
      horasTotais: minutosParaHoras(minutos),
      progresso: {
        percentual: progresso.percentual,
        concluidos: progresso.concluidos,
        totalSubtemas: progresso.totalSubtemas,
      },
      questoes,
    };
  }

  /**
   * CA-02: uma linha por disciplina com ≥1 sessão finalizada no recorte;
   * nomes de disciplinas soft-deleted preservados (caso de borda). Ordenação:
   * horas desc, desempate nome asc e disciplinaId asc (estável para a UI).
   */
  async horasPorDisciplina(
    user: AuthenticatedUser,
    query: HorasPorDisciplinaQueryDto,
  ): Promise<HorasPorDisciplinaResponse> {
    let inicioFiltro: Prisma.DateTimeFilter | undefined;
    if (query.from || query.to) {
      // Valida as datas ANTES de resolver o contexto: input inválido não deve
      // custar uma ida ao banco.
      const from = query.from ? this.parseDataFiltro('from', query.from) : undefined;
      const to = query.to ? this.parseDataFiltro('to', query.to) : undefined;
      if (from && to) {
        this.assertIntervalo(toISODate(from), toISODate(to));
      }
      const { timezone } = await this.resolverContexto(user.sub);
      // Dias INCLUSIVOS no TZ efetivo → fronteiras timestamptz sobre `inicio`:
      // [from 00:00 tz, to+1dia 00:00 tz) — mesmo recorte da série temporal.
      inicioFiltro = {
        ...(from ? { gte: zonedTimeToUtc(from, 0, timezone) } : {}),
        ...(to ? { lt: zonedTimeToUtc(addDays(to, 1), 0, timezone) } : {}),
      };
    }

    const grupos = await this.prisma.sessaoEstudo.groupBy({
      by: ['disciplinaId'],
      where: {
        alunoId: user.sub,
        fim: { not: null },
        deletedAt: null,
        ...(inicioFiltro ? { inicio: inicioFiltro } : {}),
      },
      _sum: { duracaoMin: true },
    });

    // Sem filtro de deletedAt: disciplina removida com sessões antigas segue
    // aparecendo com o nome preservado (caso de borda dos requirements).
    const disciplinas = await this.prisma.disciplina.findMany({
      where: { id: { in: grupos.map((g) => g.disciplinaId) } },
      select: { id: true, nome: true },
    });
    const nomePorId = new Map(disciplinas.map((d) => [d.id, d.nome]));

    let totalMin = 0;
    const data = grupos
      .map((grupo) => {
        const minutos = grupo._sum.duracaoMin ?? 0;
        totalMin += minutos;
        return {
          disciplinaId: grupo.disciplinaId,
          disciplina: nomePorId.get(grupo.disciplinaId) ?? '(removida)',
          horas: minutosParaHoras(minutos),
        };
      })
      .sort(
        (a, b) =>
          b.horas - a.horas ||
          a.disciplina.localeCompare(b.disciplina) ||
          a.disciplinaId.localeCompare(b.disciplinaId),
      );

    return { data, totalHoras: minutosParaHoras(totalMin) };
  }

  /**
   * CA-04/RN-03: horas por bucket (dia|semana) no timezone do cronograma
   * ativo, série CONTÍNUA — buckets sem estudo entram com 0. Bucket semanal é
   * rotulado pela segunda-feira (date_trunc('week') é ISO); o primeiro e o
   * último podem ser semanas parciais — só sessões dentro de [from,to] entram.
   */
  async serieTemporal(
    user: AuthenticatedUser,
    query: SerieTemporalQueryDto,
  ): Promise<SerieTemporalResponse> {
    const { timezone } = await this.resolverContexto(user.sub);
    const granularidade = query.granularidade ?? 'dia';

    const to = query.to ? this.parseDataFiltro('to', query.to) : wallDateNow(timezone);
    // Default (precedente D-3 de questões): 30 dias INCLUSIVOS terminando em
    // `to` (from = to − 29), ecoados na resposta.
    const from = query.from
      ? this.parseDataFiltro('from', query.from)
      : addDays(to, -(SERIE_JANELA_DIAS - 1));
    const fromStr = toISODate(from);
    const toStr = toISODate(to);
    this.assertIntervalo(fromStr, toStr);

    const maxDias = SERIE_MAX_DIAS[granularidade];
    if (diasInclusivos(from, to) > maxDias) {
      throw new UnprocessableEntityException({
        message: 'Intervalo da série temporal muito longo.',
        details: [
          {
            field: 'from',
            issue: `intervalo máximo para granularidade ${granularidade} é de ${maxDias} dias`,
          },
        ],
      });
    }

    const fromUtc = zonedTimeToUtc(from, 0, timezone);
    const toExclUtc = zonedTimeToUtc(addDays(to, 1), 0, timezone);
    const gran = granularidade === 'semana' ? 'week' : 'day';

    // Agregação no banco com date_trunc no TZ do aluno; `gran` e `timezone`
    // SEMPRE como bind (nunca interpolados). `inicio AT TIME ZONE tz` converte
    // timestamptz → wall clock local antes do truncamento.
    const linhas = await this.prisma.$queryRaw<{ bucket: string; minutos: number }[]>`
      SELECT to_char(date_trunc(${gran}, inicio AT TIME ZONE ${timezone}), 'YYYY-MM-DD') AS bucket,
             SUM(duracao_min)::int AS minutos
      FROM sessoes_estudo
      WHERE aluno_id = ${user.sub}::uuid
        AND fim IS NOT NULL
        AND deleted_at IS NULL
        AND inicio >= ${fromUtc.toISOString()}::timestamptz
        AND inicio < ${toExclUtc.toISOString()}::timestamptz
      GROUP BY 1`;
    const minutosPorBucket = new Map(linhas.map((l) => [l.bucket, l.minutos]));

    const passoDias = granularidade === 'semana' ? 7 : 1;
    const primeiro = granularidade === 'semana' ? segundaDaSemana(from) : from;
    const ultimoStr = toISODate(granularidade === 'semana' ? segundaDaSemana(to) : to);

    const data: SerieTemporalBucket[] = [];
    for (let cursor = primeiro; toISODate(cursor) <= ultimoStr; cursor = addDays(cursor, passoDias)) {
      const bucket = toISODate(cursor);
      data.push({ bucket, horas: minutosParaHoras(minutosPorBucket.get(bucket) ?? 0) });
    }

    return { granularidade, from: fromStr, to: toStr, timezone, data };
  }

  /** CA-03: % de subtemas concluídos do plano ativo; sem plano ativo → 0/0/0%. */
  async progresso(
    user: AuthenticatedUser,
    query: ProgressoEstatisticasQueryDto,
  ): Promise<ProgressoEstatisticasResponse> {
    const contexto = await this.resolverContexto(user.sub);
    const agregado = await this.agregarProgresso(user.sub, contexto.planoId);
    return {
      percentual: agregado.percentual,
      concluidos: agregado.concluidos,
      totalSubtemas: agregado.totalSubtemas,
      ...(query.porDisciplina === true ? { porDisciplina: agregado.porDisciplina } : {}),
    };
  }

  /**
   * CA-05/RN-04: totais de questões com taxaErro DERIVADA na serialização
   * (nunca persistida; 0 se total=0). `agruparPor=disciplina|tema` adiciona o
   * detalhamento; nomes de dimensões soft-deleted preservados. Ordenação do
   * detalhamento: total desc, desempate nome asc e id asc (estável para a UI).
   */
  async desempenhoQuestoes(
    user: AuthenticatedUser,
    query: DesempenhoQuestoesQueryDto,
  ): Promise<DesempenhoQuestoesResponse> {
    const totais = await this.somarQuestoes(user.sub);
    if (!query.agruparPor) {
      return totais;
    }

    const grupos = await this.prisma.registroQuestoes.groupBy({
      by: ['temaId'],
      where: { alunoId: user.sub, deletedAt: null },
      _sum: { total: true, erros: true },
    });

    // Sem filtro de deletedAt: preserva nomes de temas/disciplinas removidos.
    const temas = await this.prisma.tema.findMany({
      where: { id: { in: grupos.map((g) => g.temaId) } },
      select: { id: true, nome: true, disciplina: { select: { id: true, nome: true } } },
    });
    const temaPorId = new Map(temas.map((t) => [t.id, t]));

    let data: DesempenhoQuestoesItem[];
    if (query.agruparPor === 'tema') {
      data = grupos.map((grupo) => {
        const total = grupo._sum.total ?? 0;
        const erros = grupo._sum.erros ?? 0;
        return {
          temaId: grupo.temaId,
          nome: temaPorId.get(grupo.temaId)?.nome ?? '(removido)',
          total,
          erros,
          taxaErro: taxaErro(erros, total),
        };
      });
    } else {
      // RegistroQuestoes referencia tema; a disciplina vem do tema — agrega os
      // grupos por disciplina em memória (volumes pequenos, sem N+1).
      const porDisciplina = new Map<string, { nome: string; total: number; erros: number }>();
      for (const grupo of grupos) {
        const disciplina = temaPorId.get(grupo.temaId)?.disciplina;
        if (!disciplina) {
          continue;
        }
        const acumulado = porDisciplina.get(disciplina.id) ?? {
          nome: disciplina.nome,
          total: 0,
          erros: 0,
        };
        acumulado.total += grupo._sum.total ?? 0;
        acumulado.erros += grupo._sum.erros ?? 0;
        porDisciplina.set(disciplina.id, acumulado);
      }
      data = [...porDisciplina.entries()].map(([disciplinaId, item]) => ({
        disciplinaId,
        nome: item.nome,
        total: item.total,
        erros: item.erros,
        taxaErro: taxaErro(item.erros, item.total),
      }));
    }

    data.sort(
      (a, b) =>
        b.total - a.total ||
        a.nome.localeCompare(b.nome) ||
        (a.disciplinaId ?? a.temaId ?? '').localeCompare(b.disciplinaId ?? b.temaId ?? ''),
    );

    return { ...totais, data };
  }

  /**
   * PROVISÓRIO (RN-02): `AlunoPlanoAtivo` ainda NÃO existe no data-model — o
   * "plano ativo" é aproximado pelo plano do cronograma ativo do aluno (o
   * próprio data-model garante que o cronograma ativo referencia o mesmo
   * plano_id). Trocar por AlunoPlanoAtivo quando a entidade entrar — mesmo
   * precedente registrado em sessoes/progresso. Timezone (RN-03): o do
   * cronograma ativo; sem cronograma ativo → America/Sao_Paulo.
   */
  private async resolverContexto(alunoId: string): Promise<ContextoAluno> {
    const cronograma = await this.prisma.cronograma.findFirst({
      where: { alunoId, ativo: true, deletedAt: null },
      select: { planoId: true, timezone: true },
    });
    return {
      planoId: cronograma?.planoId ?? null,
      timezone: cronograma?.timezone ?? TIMEZONE_DEFAULT,
    };
  }

  /** CA-01/RN-01: só sessões finalizadas (fim IS NOT NULL) e não removidas. */
  private async somarMinutos(alunoId: string): Promise<number> {
    const agregado = await this.prisma.sessaoEstudo.aggregate({
      where: { alunoId, fim: { not: null }, deletedAt: null },
      _sum: { duracaoMin: true },
    });
    return agregado._sum.duracaoMin ?? 0;
  }

  private async somarQuestoes(alunoId: string): Promise<QuestoesTotais> {
    const agregado = await this.prisma.registroQuestoes.aggregate({
      where: { alunoId, deletedAt: null },
      _sum: { total: true, erros: true },
    });
    const total = agregado._sum.total ?? 0;
    const erros = agregado._sum.erros ?? 0;
    return { total, erros, taxaErro: taxaErro(erros, total) };
  }

  /**
   * Espelha a agregação por folhas do ProgressoService (DT-02 de progresso):
   * duas queries — árvore ativa do plano e conclusões do aluno — e contagem em
   * memória. Numerador conta apenas conclusões de subtemas AINDA ativos na
   * árvore (mapa por folha); denominador = folhas não removidas do plano.
   */
  private async agregarProgresso(
    alunoId: string,
    planoId: string | null,
  ): Promise<ProgressoTotais & { porDisciplina: ProgressoDisciplinaItem[] }> {
    if (!planoId) {
      return { percentual: 0, concluidos: 0, totalSubtemas: 0, porDisciplina: [] };
    }

    const [disciplinas, conclusoes] = await Promise.all([
      this.prisma.disciplina.findMany({
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
      }),
      this.prisma.progressoSubtema.findMany({
        where: {
          alunoId,
          concluido: true,
          deletedAt: null,
          subtema: { tema: { disciplina: { planoId } } },
        },
        select: { subtemaId: true },
      }),
    ]);

    const concluidosSet = new Set(conclusoes.map((c) => c.subtemaId));
    let totalConcluidos = 0;
    let totalSubtemas = 0;

    const porDisciplina = disciplinas.map((disciplina) => {
      let concluidos = 0;
      let subtemas = 0;
      for (const tema of disciplina.temas) {
        for (const subtema of tema.subtemas) {
          subtemas += 1;
          if (concluidosSet.has(subtema.id)) {
            concluidos += 1;
          }
        }
      }
      totalConcluidos += concluidos;
      totalSubtemas += subtemas;
      return {
        disciplinaId: disciplina.id,
        disciplina: disciplina.nome,
        percentual: percentualProgresso(concluidos, subtemas),
        concluidos,
        totalSubtemas: subtemas,
      };
    });

    return {
      percentual: percentualProgresso(totalConcluidos, totalSubtemas),
      concluidos: totalConcluidos,
      totalSubtemas,
      porDisciplina,
    };
  }

  /** Caso de borda dos requirements: `from > to` → 422 VALIDATION_ERROR. */
  private assertIntervalo(from: string, to: string): void {
    if (from > to) {
      throw new UnprocessableEntityException({
        message: 'Intervalo de datas inválido.',
        details: [{ field: 'from', issue: 'from não pode ser posterior a to' }],
      });
    }
  }

  /** Valida calendário (o regex do DTO não pega 2026-02-30) — padrão de questões. */
  private parseDataFiltro(field: string, valor: string): WallDate {
    const parsed = new Date(`${valor}T00:00:00Z`);
    const valida = !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === valor;
    if (!valida) {
      throw new UnprocessableEntityException({
        message: 'Data inválida.',
        details: [{ field, issue: 'deve ser uma data de calendário válida' }],
      });
    }
    return {
      year: parsed.getUTCFullYear(),
      month: parsed.getUTCMonth() + 1,
      day: parsed.getUTCDate(),
    };
  }
}
