import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { ErrorDetail } from '../../common/errors/error-codes';
import { PrismaService } from '../../prisma/prisma.service';
import { PlanosAccessService } from '../planos/planos-access.service';
import {
  BlocoResponse,
  CronogramaResponse,
  toBlocoResponse,
  toCronogramaResponse,
} from './cronograma-response';
import { GerarCronogramaDto, JanelaDto } from './dto/gerar-cronograma.dto';
import { ListBlocosQueryDto } from './dto/list-blocos-query.dto';
import { UpdateBlocoDto } from './dto/update-bloco.dto';
import { addDays, wallDateNow, wallMinutesNow, weekdayOf, zonedTimeToUtc } from './timezone.util';

/**
 * ADR (materialização): o design permite materializar blocos sob demanda no GET
 * por intervalo OU, como alternativa simples de MVP, materializar N semanas à
 * frente. Adotamos a alternativa simples: 4 SEMANAS materializadas na geração,
 * começando na próxima ocorrência de cada dia informado (contando a partir de
 * hoje no timezone do aluno, inclusive) — porém blocos de HOJE cuja JANELA já
 * terminou (fim da janela ≤ agora no timezone do aluno) não são materializados;
 * janelas de hoje ainda em curso são mantidas por inteiro. O padrão semanal se
 * repete nas 4 semanas; a fila de subtemas pendentes avança sequencialmente
 * através delas.
 */
const SEMANAS_MATERIALIZADAS = 4;

const CEM = new Prisma.Decimal('100.00');
const GRANULARIDADE_DEFAULT = 30;

/** Slot do template semanal, em minutos locais desde 00:00 do dia. */
interface SlotTemplate {
  dia: number;
  inicioMin: number;
  fimMin: number;
  /** dias até a primeira ocorrência do dia (ordenação cronológica da semana) */
  offsetDias: number;
  /** fim da janela de origem (decide se a janela de hoje já terminou) */
  janelaFimMin?: number;
}

interface BlocoTemplate {
  dia: number;
  offsetDias: number;
  inicioMin: number;
  fimMin: number;
  disciplinaId: string;
  janelaFimMin?: number;
}

interface Alocacao {
  disciplinaId: string;
  ordem: number;
  peso: Prisma.Decimal;
  /** minutos alocados na semana (Passo 2) */
  minutos: number;
  resto: Prisma.Decimal;
}

function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

@Injectable()
export class CronogramaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planosAccess: PlanosAccessService,
  ) {}

  async gerar(user: AuthenticatedUser, dto: GerarCronogramaDto): Promise<CronogramaResponse> {
    const granularidade = dto.granularidadeMin ?? GRANULARIDADE_DEFAULT;

    this.assertJanelasValidas(dto, granularidade);

    // Plano inexistente → 404; sem acesso de leitura → 403. A legibilidade é
    // a regra de matrícula do PlanosAccessService: plano próprio ou OFICIAL
    // publicado vinculado a turma em que o aluno tem matrícula ATIVA.
    const plano = await this.planosAccess.loadPlanoOrThrow(dto.planoId);
    await this.planosAccess.assertCanRead(plano, user);

    const alocacoes = await this.carregarAlocacoes(dto.planoId);

    // Passo 1 — enumerar slots do template semanal, em ordem cronológica real
    // (a próxima ocorrência de cada dia define a ordem dentro da semana).
    const hoje = wallDateNow(dto.timezone);
    const weekdayHoje = weekdayOf(hoje);
    const offsetDias = new Map<number, number>();
    for (const dia of dto.diasSemana) {
      offsetDias.set(dia, (dia - weekdayHoje + 7) % 7);
    }

    const janelas = [...dto.janelas].sort(
      (a, b) => a.dia - b.dia || hhmmToMin(a.inicio) - hhmmToMin(b.inicio),
    );
    const slots = this.enumerarSlots(janelas, granularidade, offsetDias);
    const minutosTotais = slots.reduce((acc, s) => acc + (s.fimMin - s.inicioMin), 0);

    // Passo 2 — minutos por disciplina (largest remainder, mínimo 1 slot se peso > 0).
    this.alocarMinutos(alocacoes, minutosTotais, granularidade, slots.length);

    // Passo 3 — round-robin ponderado; Passo 4 — agrupar contíguos em blocos.
    const sequencia = this.sequenciarDisciplinas(alocacoes, slots, minutosTotais);
    const blocosTemplate = this.agruparBlocos(slots, sequencia);

    // Passo 5 — fila de subtemas pendentes por disciplina (ausência de registro
    // em ProgressoSubtema = não concluído).
    const filas = await this.carregarSubtemasPendentes(
      user.sub,
      alocacoes.filter((a) => a.minutos > 0).map((a) => a.disciplinaId),
    );

    // Passo 6 — materializar 4 semanas em UTC e persistir em transação.
    // Blocos de hoje cujo intervalo já terminou não são materializados (ADR acima).
    const minutosAgora = wallMinutesNow(dto.timezone);
    const blocosData: Omit<Prisma.BlocoCronogramaCreateManyInput, 'cronogramaId'>[] = [];
    const indiceFila = new Map<string, number>();
    for (let semana = 0; semana < SEMANAS_MATERIALIZADAS; semana += 1) {
      for (const bloco of blocosTemplate) {
        if (
          semana === 0 &&
          bloco.offsetDias === 0 &&
          (bloco.janelaFimMin ?? bloco.fimMin) <= minutosAgora
        ) {
          continue;
        }
        const data = addDays(hoje, bloco.offsetDias + semana * 7);
        const fila = filas.get(bloco.disciplinaId) ?? [];
        const indice = indiceFila.get(bloco.disciplinaId) ?? 0;
        const subtemaId = fila[indice] ?? null;
        if (subtemaId) {
          indiceFila.set(bloco.disciplinaId, indice + 1);
        }
        blocosData.push({
          disciplinaId: bloco.disciplinaId,
          subtemaId,
          inicio: zonedTimeToUtc(data, bloco.inicioMin, dto.timezone),
          fim: zonedTimeToUtc(data, bloco.fimMin, dto.timezone),
          // duracaoMin é a duração "de parede" (planejada no horário local do
          // aluno); se um bloco cruzar transição de DST, o intervalo UTC real
          // (fim − inicio) pode diferir — a semântica escolhida é a de parede.
          duracaoMin: bloco.fimMin - bloco.inicioMin,
        });
      }
    }

    const horasSemanaTotal = new Prisma.Decimal(minutosTotais).div(60).toDecimalPlaces(2);

    const persistir = () =>
      this.prisma.$transaction(async (tx) => {
        await tx.cronograma.updateMany({
          where: { alunoId: user.sub, ativo: true, deletedAt: null },
          data: { ativo: false },
        });
        const criado = await tx.cronograma.create({
          data: {
            alunoId: user.sub,
            planoId: dto.planoId,
            diasSemana: [...dto.diasSemana].sort((a, b) => a - b),
            janelas: janelas.map((j) => ({ dia: j.dia, inicio: j.inicio, fim: j.fim })),
            horasSemanaTotal,
            granularidadeMin: granularidade,
            timezone: dto.timezone,
            ativo: true,
          },
        });
        await tx.blocoCronograma.createMany({
          data: blocosData.map((b) => ({ ...b, cronogramaId: criado.id })),
        });
        return tx.cronograma.findUniqueOrThrow({
          where: { id: criado.id },
          include: { blocos: { orderBy: { inicio: 'asc' } } },
        });
      });

    // O índice único parcial (aluno_id WHERE ativo) protege contra gerações
    // concorrentes: em P2002, uma retentativa (o updateMany desativa o que a
    // corrida criou); persistindo o conflito → 409.
    let cronograma;
    try {
      cronograma = await persistir();
    } catch (error) {
      if (!this.isUniqueViolation(error)) {
        throw error;
      }
      try {
        cronograma = await persistir();
      } catch (retryError) {
        if (this.isUniqueViolation(retryError)) {
          throw new ConflictException('Geração concorrente de cronograma detectada.');
        }
        throw retryError;
      }
    }

    return toCronogramaResponse(cronograma);
  }

  async getAtivo(user: AuthenticatedUser): Promise<CronogramaResponse> {
    const cronograma = await this.prisma.cronograma.findFirst({
      where: { alunoId: user.sub, ativo: true, deletedAt: null },
      orderBy: { geradoEm: 'desc' },
    });
    if (!cronograma) {
      throw new NotFoundException('Nenhum cronograma ativo encontrado.');
    }
    return toCronogramaResponse(cronograma);
  }

  async listBlocos(
    user: AuthenticatedUser,
    cronogramaId: string,
    query: ListBlocosQueryDto,
  ): Promise<BlocoResponse[]> {
    const cronograma = await this.prisma.cronograma.findUnique({
      where: { id: cronogramaId },
    });
    if (!cronograma || cronograma.deletedAt !== null) {
      throw new NotFoundException('Cronograma não encontrado.');
    }
    if (cronograma.alunoId !== user.sub) {
      throw new ForbiddenException('Acesso negado a este cronograma.');
    }

    const blocos = await this.prisma.blocoCronograma.findMany({
      where: {
        cronogramaId,
        deletedAt: null,
        ...(query.from || query.to
          ? {
              // `to` é fronteira exclusiva (o cliente envia a meia-noite do
              // período seguinte).
              inicio: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lt: new Date(query.to) } : {}),
              },
            }
          : {}),
      },
      orderBy: { inicio: 'asc' },
    });
    return blocos.map(toBlocoResponse);
  }

  async updateBlocoStatus(
    user: AuthenticatedUser,
    blocoId: string,
    dto: UpdateBlocoDto,
  ): Promise<BlocoResponse> {
    const bloco = await this.prisma.blocoCronograma.findUnique({
      where: { id: blocoId },
      include: { cronograma: true },
    });
    if (!bloco || bloco.deletedAt !== null || bloco.cronograma.deletedAt !== null) {
      throw new NotFoundException('Bloco não encontrado.');
    }
    if (bloco.cronograma.alunoId !== user.sub) {
      throw new ForbiddenException('Acesso negado a este bloco.');
    }

    const atualizado = await this.prisma.blocoCronograma.update({
      where: { id: blocoId },
      data: { status: dto.status },
    });
    return toBlocoResponse(atualizado);
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  /** Regras de negócio das janelas (422): duração, dia fora de diasSemana, sobreposição. */
  private assertJanelasValidas(dto: GerarCronogramaDto, granularidade: number): void {
    const details: ErrorDetail[] = [];
    const dias = new Set(dto.diasSemana);

    dto.janelas.forEach((janela, i) => {
      const inicio = hhmmToMin(janela.inicio);
      const fim = hhmmToMin(janela.fim);
      if (fim <= inicio) {
        details.push({ field: `janelas.${i}`, issue: 'fim deve ser maior que inicio' });
      } else if (fim - inicio < granularidade) {
        details.push({
          field: `janelas.${i}`,
          issue: `janela deve ter ao menos ${granularidade} minutos (granularidade)`,
        });
      }
      if (!dias.has(janela.dia)) {
        details.push({ field: `janelas.${i}.dia`, issue: 'dia da janela deve estar em diasSemana' });
      }
    });

    // Sobreposição no mesmo dia quebraria o invariante "blocos não se sobrepõem".
    const porDia = new Map<number, { inicio: number; fim: number; index: number }[]>();
    dto.janelas.forEach((janela, index) => {
      const lista = porDia.get(janela.dia) ?? [];
      lista.push({ inicio: hhmmToMin(janela.inicio), fim: hhmmToMin(janela.fim), index });
      porDia.set(janela.dia, lista);
    });
    for (const lista of porDia.values()) {
      lista.sort((a, b) => a.inicio - b.inicio);
      for (let i = 1; i < lista.length; i += 1) {
        if (lista[i].inicio < lista[i - 1].fim) {
          details.push({
            field: `janelas.${lista[i].index}`,
            issue: 'janelas do mesmo dia não podem se sobrepor',
          });
        }
      }
    }

    if (details.length > 0) {
      throw new UnprocessableEntityException({
        message: 'Janelas de estudo inválidas.',
        details,
      });
    }
  }

  /** Carrega pesos ativos do plano e valida consistência (Σ = 100, disciplinas ativas). */
  private async carregarAlocacoes(planoId: string): Promise<Alocacao[]> {
    const pesos = await this.prisma.pesoDisciplina.findMany({
      where: { planoId, deletedAt: null },
      include: { disciplina: { select: { id: true, ordem: true, deletedAt: true } } },
    });

    const ativos = pesos.filter((p) => p.disciplina.deletedAt === null);
    if (ativos.length === 0) {
      throw new UnprocessableEntityException({
        message: 'Plano sem disciplinas com pesos definidos.',
        details: [{ field: 'planoId', issue: 'plano deve ter disciplinas com pesos definidos' }],
      });
    }

    const soma = ativos.reduce((acc, p) => acc.plus(p.pesoPercentual), new Prisma.Decimal(0));
    if (!soma.equals(CEM)) {
      throw new UnprocessableEntityException({
        message: 'A soma dos pesos do plano deve ser 100.',
        details: [{ field: 'pesoPercentual', issue: 'soma deve ser 100' }],
      });
    }

    return ativos.map((p) => ({
      disciplinaId: p.disciplinaId,
      ordem: p.disciplina.ordem,
      peso: p.pesoPercentual,
      minutos: 0,
      resto: new Prisma.Decimal(0),
    }));
  }

  /**
   * Passo 1 — fatia cada janela em slots de `granularidade`; o resto não
   * divisível vira um slot menor NO FINAL da janela (caso de borda dos
   * requirements: "encaixa o resto no último slot"). Ordena por cronologia
   * real da semana (offsetDias, horário).
   */
  private enumerarSlots(
    janelas: JanelaDto[],
    granularidade: number,
    offsetDias: Map<number, number>,
  ): SlotTemplate[] {
    const slots: SlotTemplate[] = [];
    for (const janela of janelas) {
      const inicio = hhmmToMin(janela.inicio);
      const fim = hhmmToMin(janela.fim);
      const offset = offsetDias.get(janela.dia) ?? 0;
      let cursor = inicio;
      while (cursor + granularidade <= fim) {
        slots.push({
          dia: janela.dia,
          inicioMin: cursor,
          fimMin: cursor + granularidade,
          offsetDias: offset,
          janelaFimMin: fim,
        });
        cursor += granularidade;
      }
      if (cursor < fim) {
        slots.push({
          dia: janela.dia,
          inicioMin: cursor,
          fimMin: fim,
          offsetDias: offset,
          janelaFimMin: fim,
        });
      }
    }
    return slots.sort((a, b) => a.offsetDias - b.offsetDias || a.inicioMin - b.inicioMin);
  }

  /**
   * Passo 2 — largest remainder sobre MINUTOS, como prescreve o design:
   * bruto_d = peso% × minutosTotais; base_d = floor(bruto_d/g) × g; a diferença
   * até minutosTotais é distribuída em parcelas de até 1 slot (g minutos) às
   * disciplinas de maior resto fracionário (bruto_d − base_d). Assim o slot-
   * -resto (menor que g) não conta como slot cheio e Σ minutos_d =
   * minutosTotais exatamente.
   * Desempate determinístico: maior resto → maior peso → menor ordem → menor id.
   * Mínimo: disciplina com peso > 0 recebe ≥ 1 slot (g minutos) se houver
   * espaço, doado pela disciplina com mais minutos (desempate: maior peso →
   * maior ordem).
   */
  private alocarMinutos(
    alocacoes: Alocacao[],
    minutosTotais: number,
    granularidade: number,
    slotsTotais: number,
  ): void {
    let distribuidos = 0;
    for (const a of alocacoes) {
      const bruto = a.peso.mul(minutosTotais).div(CEM);
      const base = bruto.div(granularidade).floor().mul(granularidade);
      a.minutos = base.toNumber();
      a.resto = bruto.minus(base);
      distribuidos += a.minutos;
    }

    const porResto = [...alocacoes].sort(
      (a, b) =>
        b.resto.comparedTo(a.resto) ||
        b.peso.comparedTo(a.peso) ||
        a.ordem - b.ordem ||
        a.disciplinaId.localeCompare(b.disciplinaId),
    );
    let sobra = minutosTotais - distribuidos;
    for (let i = 0; sobra > 0; i += 1) {
      const parcela = Math.min(granularidade, sobra);
      porResto[i % porResto.length].minutos += parcela;
      sobra -= parcela;
    }

    const comPeso = alocacoes.filter((a) => a.peso.greaterThan(0));
    if (slotsTotais >= comPeso.length) {
      for (const a of [...comPeso].sort((x, y) => x.ordem - y.ordem)) {
        if (a.minutos > 0) continue;
        const doador = alocacoes
          .filter((d) => d.minutos > granularidade)
          .sort(
            (x, y) =>
              y.minutos - x.minutos || y.peso.comparedTo(x.peso) || y.ordem - x.ordem,
          )[0];
        if (!doador) break;
        doador.minutos -= granularidade;
        a.minutos += granularidade;
      }
    }
  }

  /**
   * Passo 3 — round-robin ponderado por crédito incremental (pseudocódigo do
   * design), ponderando cada slot pela sua DURAÇÃO real em minutos — um slot-
   * -resto acumula/debita crédito proporcional ao seu tamanho, preservando o
   * invariante "minutos por disciplina ∝ peso (tolerância 1 granularidade)".
   * Aritmética inteira (crédito escalado por minutosTotais) para determinismo:
   * a cada slot, credito_d += minutos_d × duraçãoSlot; escolhe-se o maior
   * crédito com minutos restantes; debita-se duraçãoSlot × minutosTotais.
   * Desempate: maior crédito → mais minutos alocados (≈ maior peso) → menor
   * ordem da disciplina → menor id.
   */
  private sequenciarDisciplinas(
    alocacoes: Alocacao[],
    slots: SlotTemplate[],
    minutosTotais: number,
  ): string[] {
    const credito = new Map<string, number>();
    const restante = new Map<string, number>();
    for (const a of alocacoes) {
      credito.set(a.disciplinaId, 0);
      restante.set(a.disciplinaId, a.minutos);
    }

    const byPrioridade = (x: Alocacao, y: Alocacao): number =>
      (credito.get(y.disciplinaId) ?? 0) - (credito.get(x.disciplinaId) ?? 0) ||
      y.minutos - x.minutos ||
      x.ordem - y.ordem ||
      x.disciplinaId.localeCompare(y.disciplinaId);

    const sequencia: string[] = [];
    for (const slot of slots) {
      const duracao = slot.fimMin - slot.inicioMin;
      for (const a of alocacoes) {
        credito.set(a.disciplinaId, (credito.get(a.disciplinaId) ?? 0) + a.minutos * duracao);
      }
      const candidatas = alocacoes.filter((a) => (restante.get(a.disciplinaId) ?? 0) > 0);
      // Fallback: o saldo pode se esgotar antes do último slot (slot maior que
      // o restante da escolhida); nesse caso, disputa quem tem minutos > 0.
      const pool = candidatas.length > 0 ? candidatas : alocacoes.filter((a) => a.minutos > 0);
      const escolhida = pool.sort(byPrioridade)[0];
      sequencia.push(escolhida.disciplinaId);
      credito.set(
        escolhida.disciplinaId,
        (credito.get(escolhida.disciplinaId) ?? 0) - duracao * minutosTotais,
      );
      restante.set(escolhida.disciplinaId, (restante.get(escolhida.disciplinaId) ?? 0) - duracao);
    }
    return sequencia;
  }

  /** Passo 4 — funde slots contíguos (mesmo dia, horário contínuo) da mesma disciplina. */
  private agruparBlocos(slots: SlotTemplate[], sequencia: string[]): BlocoTemplate[] {
    const blocos: BlocoTemplate[] = [];
    slots.forEach((slot, i) => {
      const disciplinaId = sequencia[i];
      const anterior = blocos[blocos.length - 1];
      if (
        anterior &&
        anterior.disciplinaId === disciplinaId &&
        anterior.dia === slot.dia &&
        anterior.fimMin === slot.inicioMin
      ) {
        anterior.fimMin = slot.fimMin;
        anterior.janelaFimMin = slot.janelaFimMin;
      } else {
        blocos.push({
          dia: slot.dia,
          offsetDias: slot.offsetDias,
          inicioMin: slot.inicioMin,
          fimMin: slot.fimMin,
          disciplinaId,
          janelaFimMin: slot.janelaFimMin,
        });
      }
    });
    return blocos;
  }

  /**
   * Passo 5 — fila de subtemas pendentes por disciplina, ordenada por
   * (ordem do Tema, ordem do Subtema) com ids como desempate estável.
   * Ausência de registro em ProgressoSubtema = não concluído.
   */
  private async carregarSubtemasPendentes(
    alunoId: string,
    disciplinaIds: string[],
  ): Promise<Map<string, string[]>> {
    const subtemas = await this.prisma.subtema.findMany({
      where: {
        deletedAt: null,
        tema: { deletedAt: null, disciplinaId: { in: disciplinaIds } },
      },
      select: {
        id: true,
        ordem: true,
        tema: { select: { id: true, ordem: true, disciplinaId: true } },
      },
    });

    const concluidos = await this.prisma.progressoSubtema.findMany({
      where: {
        alunoId,
        concluido: true,
        deletedAt: null,
        subtemaId: { in: subtemas.map((s) => s.id) },
      },
      select: { subtemaId: true },
    });
    const concluidosSet = new Set(concluidos.map((p) => p.subtemaId));

    const filas = new Map<string, string[]>();
    const pendentes = subtemas
      .filter((s) => !concluidosSet.has(s.id))
      .sort(
        (a, b) =>
          a.tema.ordem - b.tema.ordem ||
          a.tema.id.localeCompare(b.tema.id) ||
          a.ordem - b.ordem ||
          a.id.localeCompare(b.id),
      );
    for (const s of pendentes) {
      const fila = filas.get(s.tema.disciplinaId) ?? [];
      fila.push(s.id);
      filas.set(s.tema.disciplinaId, fila);
    }
    return filas;
  }
}
