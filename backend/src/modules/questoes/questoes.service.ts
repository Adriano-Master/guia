import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { ErrorDetail } from '../../common/errors/error-codes';
import {
  PaginatedResponse,
  paginated,
  parseSort,
  toSkipTake,
  toStableOrderBy,
} from '../../common/pagination/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { PlanosAccessService } from '../planos/planos-access.service';
import { CreateRegistroDto } from './dto/create-registro.dto';
import { DesempenhoQueryDto } from './dto/desempenho-query.dto';
import { ListRegistrosQueryDto } from './dto/list-registros-query.dto';
import { UpdateRegistroDto } from './dto/update-registro.dto';
import {
  DesempenhoResponse,
  RegistroQuestoesResponse,
  RegistroQuestoesWithRefs,
  taxaErro,
  toDataISO,
  toRegistroQuestoesResponse,
} from './registro-questoes-response';

const SORTABLE_FIELDS = ['data', 'total', 'erros', 'createdAt'];

/** Nomes de tema/subtema em toda resposta de registro — um join, sem N+1. */
const registroInclude = {
  tema: { select: { nome: true } },
  subtema: { select: { nome: true } },
} satisfies Prisma.RegistroQuestoesInclude;

const MS_POR_DIA = 24 * 60 * 60_000;

/**
 * Folga de timezone para o "hoje" da data do registro (CA-3): mesma decisão
 * do registro manual de sessões — sem TZ de perfil do aluno, `data <= hoje` é
 * avaliado em UTC+14 (o TZ mais adiantado do planeta), então nenhum "hoje"
 * legítimo é rejeitado e datas de fato futuras seguem bloqueadas.
 */
const FOLGA_TZ_MS = 14 * 60 * 60_000;

/** D-3: janela default de desempenho — 30 dias de calendário terminando hoje. */
const DESEMPENHO_JANELA_DIAS = 30;

@Injectable()
export class QuestoesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planosAccess: PlanosAccessService,
  ) {}

  async criar(user: AuthenticatedUser, dto: CreateRegistroDto): Promise<RegistroQuestoesResponse> {
    const data = this.parseDataRegistro(dto.data);
    this.assertErrosNaoExcedemTotal(dto.erros, dto.total);
    await this.assertReferenciasValidas(user, dto.temaId, dto.subtemaId);

    const registro = await this.prisma.registroQuestoes.create({
      data: {
        alunoId: user.sub,
        temaId: dto.temaId,
        subtemaId: dto.subtemaId ?? null,
        data,
        total: dto.total,
        erros: dto.erros,
      },
      include: registroInclude,
    });
    return toRegistroQuestoesResponse(registro);
  }

  async list(
    user: AuthenticatedUser,
    query: ListRegistrosQueryDto,
  ): Promise<PaginatedResponse<RegistroQuestoesResponse>> {
    const sort = parseSort(query.sort, SORTABLE_FIELDS);

    const where: Prisma.RegistroQuestoesWhereInput = {
      alunoId: user.sub,
      deletedAt: null,
      ...(query.temaId ? { temaId: query.temaId } : {}),
      ...(query.subtemaId ? { subtemaId: query.subtemaId } : {}),
      ...(query.from || query.to
        ? {
            // Período de DIAS sobre campo DATE: from e to AMBOS inclusivos
            // (diferente de sessões/blocos, timestamptz com `to` exclusivo).
            data: {
              ...(query.from ? { gte: this.parseDataFiltro('from', query.from) } : {}),
              ...(query.to ? { lte: this.parseDataFiltro('to', query.to) } : {}),
            },
          }
        : {}),
    };

    const [registros, total] = await this.prisma.$transaction([
      this.prisma.registroQuestoes.findMany({
        where,
        include: registroInclude,
        // RN-5 permite vários registros no mesmo tema/dia: sem desempate a
        // paginação por `data` seria instável (linhas flutuando entre páginas).
        orderBy: toStableOrderBy(sort, { data: 'desc' }),
        ...toSkipTake(query),
      }),
      this.prisma.registroQuestoes.count({ where }),
    ]);

    return paginated(registros.map(toRegistroQuestoesResponse), query, total);
  }

  async getById(user: AuthenticatedUser, id: string): Promise<RegistroQuestoesResponse> {
    const registro = await this.loadOwnedOrThrow(user, id);
    return toRegistroQuestoesResponse(registro);
  }

  /**
   * Revalida as invariantes com os valores RESULTANTES: erros ≤ total mistura
   * dto e persistido; subtema novo deve ser filho do tema do registro (o tema
   * não é editável); data nova segue as mesmas regras da criação.
   */
  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateRegistroDto,
  ): Promise<RegistroQuestoesResponse> {
    const registro = await this.loadOwnedOrThrow(user, id);

    const total = dto.total ?? registro.total;
    const erros = dto.erros ?? registro.erros;
    this.assertErrosNaoExcedemTotal(erros, total);

    const data = dto.data !== undefined ? this.parseDataRegistro(dto.data) : undefined;

    if (typeof dto.subtemaId === 'string') {
      const details: ErrorDetail[] = [];
      await this.validarSubtema(dto.subtemaId, registro.temaId, details);
      this.throwIfDetails(details);
    }

    const atualizado = await this.prisma.registroQuestoes.update({
      where: { id: registro.id },
      data: {
        ...(dto.total !== undefined ? { total: dto.total } : {}),
        ...(dto.erros !== undefined ? { erros: dto.erros } : {}),
        // null explícito desvincula o subtema; undefined preserva.
        ...(dto.subtemaId !== undefined ? { subtemaId: dto.subtemaId } : {}),
        ...(data !== undefined ? { data } : {}),
      },
      include: registroInclude,
    });
    return toRegistroQuestoesResponse(atualizado);
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const registro = await this.loadOwnedOrThrow(user, id);
    await this.prisma.registroQuestoes.update({
      where: { id: registro.id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Agregação por tema (CA-8): groupBy + SUM no banco, usando o índice
   * (aluno_id, tema_id, data) — D-4. Sem registros no período → lista vazia,
   * 200 (CB-3). Ordenação estável para a UI: taxaErro desc, desempate por
   * totalErros desc e temaId asc.
   */
  async desempenho(user: AuthenticatedUser, query: DesempenhoQueryDto): Promise<DesempenhoResponse> {
    const hoje = new Date(Date.now() + FOLGA_TZ_MS).toISOString().slice(0, 10);
    const to = query.to ?? hoje;
    const toDate = this.parseDataFiltro('to', to);
    // Janela default (D-3): 30 dias-calendário INCLUSIVOS terminando em `to`
    // (from = to − 29 dias). Aritmética em UTC puro — sem DST no calendário.
    const from = query.from ?? toDataISO(new Date(toDate.getTime() - (DESEMPENHO_JANELA_DIAS - 1) * MS_POR_DIA));
    const fromDate = this.parseDataFiltro('from', from);

    const grupos = await this.prisma.registroQuestoes.groupBy({
      by: ['temaId'],
      where: {
        alunoId: user.sub,
        deletedAt: null,
        data: { gte: fromDate, lte: toDate },
        ...(query.temaId ? { temaId: query.temaId } : {}),
      },
      _sum: { total: true, erros: true },
    });

    const temas = await this.prisma.tema.findMany({
      where: { id: { in: grupos.map((g) => g.temaId) } },
      select: { id: true, nome: true },
    });
    const nomePorTema = new Map(temas.map((t) => [t.id, t.nome]));

    const data = grupos
      .map((grupo) => {
        const totalQuestoes = grupo._sum.total ?? 0;
        const totalErros = grupo._sum.erros ?? 0;
        return {
          temaId: grupo.temaId,
          temaNome: nomePorTema.get(grupo.temaId) ?? '',
          totalQuestoes,
          totalErros,
          taxaErro: taxaErro(totalErros, totalQuestoes),
        };
      })
      .sort(
        (a, b) =>
          b.taxaErro - a.taxaErro ||
          b.totalErros - a.totalErros ||
          a.temaId.localeCompare(b.temaId),
      );

    return { data, from, to };
  }

  /** Registro inexistente/soft-deleted → 404; de outro aluno → 403 (CA-7). */
  private async loadOwnedOrThrow(
    user: AuthenticatedUser,
    id: string,
  ): Promise<RegistroQuestoesWithRefs> {
    const registro = await this.prisma.registroQuestoes.findUnique({
      where: { id },
      include: registroInclude,
    });
    if (!registro || registro.deletedAt !== null) {
      throw new NotFoundException('Registro de questões não encontrado.');
    }
    if (registro.alunoId !== user.sub) {
      throw new ForbiddenException('Acesso negado a este registro de questões.');
    }
    return registro;
  }

  /** RN-2: comparação cruzada no service (CA-2), `details` apontando `erros`. */
  private assertErrosNaoExcedemTotal(erros: number, total: number): void {
    if (erros > total) {
      throw new UnprocessableEntityException({
        message: 'Registro de questões inválido.',
        details: [{ field: 'erros', issue: 'erros não pode ser maior que total' }],
      });
    }
  }

  /**
   * `data` (YYYY-MM-DD) → Date em data@00:00Z (DATE puro no banco); data de
   * calendário inválida (ex.: 2026-02-30) ou futura → 422 (CA-3).
   */
  private parseDataRegistro(data: string): Date {
    const parsed = this.parseDataFiltro('data', data);

    const hojeMax = new Date(Date.now() + FOLGA_TZ_MS).toISOString().slice(0, 10);
    if (data > hojeMax) {
      throw new UnprocessableEntityException({
        message: 'Data do registro de questões no futuro.',
        details: [{ field: 'data', issue: 'data não pode ser futura' }],
      });
    }
    return parsed;
  }

  /** Valida calendário (o regex do DTO não pega 2026-02-30) e converte p/ 00:00Z. */
  private parseDataFiltro(field: string, valor: string): Date {
    const parsed = new Date(`${valor}T00:00:00Z`);
    const valida = !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === valor;
    if (!valida) {
      throw new UnprocessableEntityException({
        message: 'Data inválida.',
        details: [{ field, issue: 'deve ser uma data de calendário válida' }],
      });
    }
    return parsed;
  }

  /**
   * Coerência das referências → 422 com details (CA-3, CA-4, CB-4). O escopo
   * "tema do plano do aluno" é a regra definitiva de leitura do
   * PlanosAccessService, como em sessões/progresso: PESSOAL próprio ou
   * OFICIAL publicado vinculado a turma em que o aluno tem matrícula ATIVA.
   */
  private async assertReferenciasValidas(
    user: AuthenticatedUser,
    temaId: string,
    subtemaId?: string | null,
  ): Promise<void> {
    const details: ErrorDetail[] = [];

    const tema = await this.prisma.tema.findUnique({
      where: { id: temaId },
      include: { disciplina: { include: { plano: true } } },
    });
    if (
      !tema ||
      tema.deletedAt !== null ||
      tema.disciplina.deletedAt !== null ||
      tema.disciplina.plano.deletedAt !== null
    ) {
      details.push({ field: 'temaId', issue: 'tema inexistente' });
    } else {
      // Referência ilegível vira 422 com details (CB-4), não 403 — como em
      // sessões: o 403 fica para acesso cruzado a registro existente (CA-7).
      try {
        await this.planosAccess.assertCanRead(tema.disciplina.plano, user);
      } catch {
        details.push({
          field: 'temaId',
          issue: 'tema deve pertencer a um plano acessível ao aluno',
        });
      }
    }

    // != null: "subtemaId": null explícito no POST equivale a ausente.
    if (subtemaId != null) {
      await this.validarSubtema(subtemaId, temaId, details);
    }

    this.throwIfDetails(details);
  }

  private async validarSubtema(
    subtemaId: string,
    temaId: string,
    details: ErrorDetail[],
  ): Promise<void> {
    const subtema = await this.prisma.subtema.findUnique({
      where: { id: subtemaId },
      include: { tema: true },
    });
    if (!subtema || subtema.deletedAt !== null || subtema.tema.deletedAt !== null) {
      details.push({ field: 'subtemaId', issue: 'subtema inexistente' });
    } else if (subtema.temaId !== temaId) {
      details.push({ field: 'subtemaId', issue: 'subtema deve pertencer ao tema informado' });
    }
  }

  private throwIfDetails(details: ErrorDetail[]): void {
    if (details.length > 0) {
      throw new UnprocessableEntityException({
        message: 'Referências do registro de questões inválidas.',
        details,
      });
    }
  }
}
