import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, SessaoEstudo, SessaoOrigem } from '@prisma/client';
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
import { ListSessoesQueryDto } from './dto/list-sessoes-query.dto';
import { ManualSessaoDto } from './dto/manual-sessao.dto';
import { StartCronometroDto } from './dto/start-cronometro.dto';
import { StopCronometroDto } from './dto/stop-cronometro.dto';
import { UpdateSessaoDto } from './dto/update-sessao.dto';
import { SessaoResponse, toSessaoResponse } from './sessao-response';

const SORTABLE_FIELDS = ['inicio', 'fim', 'duracaoMin', 'createdAt'];

const MS_POR_MIN = 60_000;

/**
 * Folga de timezone para o "hoje" do registro manual (CB-4): sem entidade de
 * perfil com TZ do aluno, aceitamos `data <= hoje` avaliado em UTC+14 (o TZ
 * mais adiantado do planeta). Nenhuma data que seja "hoje" para o aluno é
 * rejeitada; datas de fato futuras em qualquer TZ continuam bloqueadas.
 * Alternativa (usar o TZ do cronograma ativo) foi descartada por acoplar a
 * validação a um recurso opcional.
 */
const FOLGA_TZ_MS = 14 * 60 * MS_POR_MIN;

@Injectable()
export class SessoesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planosAccess: PlanosAccessService,
  ) {}

  /**
   * Estado de pausa EM MEMÓRIA (D-3: nenhuma coluna nova no data-model).
   * Usado APENAS para validar transições pause/resume (CA-4) e reportar
   * `estado` em GET /sessoes/ativa — o cálculo oficial da duração usa o
   * `pausaMin` enviado pelo cliente no stop, nunca este registro.
   * Restart do servidor perde o estado: a sessão volta a reportar RUNNING,
   * mas o `pausaMin` do cliente segue valendo no stop — precedente aceito no
   * projeto (denylist de refresh em memória); trocar por Redis se houver
   * múltiplas instâncias.
   */
  private readonly pausas = new Map<string, Date>();

  async startCronometro(
    user: AuthenticatedUser,
    dto: StartCronometroDto,
  ): Promise<SessaoResponse> {
    try {
      const sessao = await this.prisma.$transaction(async (tx) => {
        // RN-1/CB-5: lock da sessão ativa (se houver) serializa starts
        // concorrentes; o índice único parcial (migration create_sessoes) é a
        // segunda linha de defesa quando não há linha para travar.
        const ativas = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM sessoes_estudo
          WHERE aluno_id = ${user.sub}::uuid
            AND origem = 'CRONOMETRO'
            AND fim IS NULL
            AND deleted_at IS NULL
          FOR UPDATE`;
        if (ativas.length > 0) {
          throw new ConflictException('Já existe um cronômetro em andamento.');
        }

        await this.assertReferenciasValidas(user, dto.disciplinaId, dto.subtemaId, dto.blocoId, tx);

        return tx.sessaoEstudo.create({
          data: {
            alunoId: user.sub,
            disciplinaId: dto.disciplinaId,
            subtemaId: dto.subtemaId ?? null,
            blocoId: dto.blocoId ?? null,
            origem: SessaoOrigem.CRONOMETRO,
            inicio: new Date(),
          },
        });
      });
      return toSessaoResponse(sessao, 'RUNNING');
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Já existe um cronômetro em andamento.');
      }
      throw error;
    }
  }

  /**
   * Reidratação do cliente (CB-3). O design admite "200 ou 204/vazio"; usamos
   * 404 com envelope NOT_FOUND quando não há cronômetro em andamento,
   * consistente com CB-1 (demais operações sobre /ativa) e com o padrão do
   * projeto (GET /cronogramas/ativo).
   */
  async getAtiva(user: AuthenticatedUser): Promise<SessaoResponse> {
    const sessao = await this.findAtivaOrThrow(user.sub);
    return toSessaoResponse(sessao, this.estadoAtivo(sessao.id));
  }

  async pause(user: AuthenticatedUser): Promise<SessaoResponse> {
    const sessao = await this.findAtivaOrThrow(user.sub);
    if (this.pausas.has(sessao.id)) {
      throw new ConflictException('O cronômetro já está pausado.');
    }
    this.pausas.set(sessao.id, new Date());
    return toSessaoResponse(sessao, 'PAUSED');
  }

  async resume(user: AuthenticatedUser): Promise<SessaoResponse> {
    const sessao = await this.findAtivaOrThrow(user.sub);
    if (!this.pausas.has(sessao.id)) {
      throw new ConflictException('O cronômetro não está pausado.');
    }
    this.pausas.delete(sessao.id);
    return toSessaoResponse(sessao, 'RUNNING');
  }

  async stop(user: AuthenticatedUser, dto: StopCronometroDto): Promise<SessaoResponse> {
    const sessao = await this.findAtivaOrThrow(user.sub);
    const pausaMin = dto.pausaMin ?? 0;

    const fim = new Date();
    const brutoMin = (fim.getTime() - sessao.inicio.getTime()) / MS_POR_MIN;
    // RN-2/D-4: round(decorrido − pausaMin); mínimo 1 quando houve tempo
    // bruto > 0, nunca negativo. Clamp: pausaMin >= decorrido → duracaoMin = 1
    // (o cliente reportou mais pausa que o intervalo; houve tempo > 0).
    let duracaoMin = Math.round(brutoMin - pausaMin);
    if (duracaoMin < 1) {
      duracaoMin = brutoMin > 0 ? 1 : 0;
    }

    let atualizada: SessaoEstudo;
    try {
      atualizada = await this.prisma.sessaoEstudo.update({
        where: { id: sessao.id },
        data: { fim, duracaoMin },
      });
    } catch (error) {
      // Corrida stop × discard: um discard concorrente pode ter hard-deletado
      // a linha entre o findFirst e o update (P2025) → 404, não 500.
      if (this.isRecordNotFound(error)) {
        throw new NotFoundException('Nenhum cronômetro em andamento.');
      }
      throw error;
    }
    this.pausas.delete(sessao.id);
    return toSessaoResponse(atualizada);
  }

  async discard(user: AuthenticatedUser): Promise<void> {
    const sessao = await this.findAtivaOrThrow(user.sub);
    // Exceção deliberada ao soft delete do projeto: o descarte (CA-5) remove
    // um cronômetro que nunca virou registro de tempo — manter a linha (mesmo
    // soft-deleted) não tem valor e ocuparia o "slot" semântico do índice.
    await this.prisma.sessaoEstudo.delete({ where: { id: sessao.id } });
    this.pausas.delete(sessao.id);
  }

  async registrarManual(user: AuthenticatedUser, dto: ManualSessaoDto): Promise<SessaoResponse> {
    const inicio = this.parseDataManual(dto.data);
    await this.assertReferenciasValidas(user, dto.disciplinaId, dto.subtemaId, dto.blocoId);

    const sessao = await this.prisma.sessaoEstudo.create({
      data: {
        alunoId: user.sub,
        disciplinaId: dto.disciplinaId,
        subtemaId: dto.subtemaId ?? null,
        blocoId: dto.blocoId ?? null,
        origem: SessaoOrigem.MANUAL,
        inicio,
        fim: new Date(inicio.getTime() + dto.duracaoMin * MS_POR_MIN),
        duracaoMin: dto.duracaoMin,
      },
    });
    return toSessaoResponse(sessao);
  }

  async list(
    user: AuthenticatedUser,
    query: ListSessoesQueryDto,
  ): Promise<PaginatedResponse<SessaoResponse>> {
    const sort = parseSort(query.sort, SORTABLE_FIELDS);

    const where: Prisma.SessaoEstudoWhereInput = {
      alunoId: user.sub,
      deletedAt: null,
      ...(query.disciplinaId ? { disciplinaId: query.disciplinaId } : {}),
      ...(query.from || query.to
        ? {
            // Como no GET de blocos: `to` é fronteira exclusiva sobre `inicio`.
            inicio: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lt: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    const [sessoes, total] = await this.prisma.$transaction([
      this.prisma.sessaoEstudo.findMany({
        where,
        // Sessões manuais do mesmo dia empatam em `inicio` (00:00Z): sem
        // desempate a paginação seria instável (linhas flutuando entre páginas).
        orderBy: toStableOrderBy(sort, { inicio: 'desc' }),
        ...toSkipTake(query),
      }),
      this.prisma.sessaoEstudo.count({ where }),
    ]);

    return paginated(
      sessoes.map((s) => toSessaoResponse(s, this.estadoAtivo(s.id))),
      query,
      total,
    );
  }

  async getById(user: AuthenticatedUser, id: string): Promise<SessaoResponse> {
    const sessao = await this.loadOwnedOrThrow(user, id);
    return toSessaoResponse(sessao, this.estadoAtivo(sessao.id));
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateSessaoDto): Promise<SessaoResponse> {
    const sessao = await this.loadOwnedOrThrow(user, id);
    // RN-7: sessão em andamento não é editável; correções só pós-registro.
    if (sessao.fim === null) {
      throw new ConflictException('Sessão em andamento não pode ser editada.');
    }

    // null explícito desvincula o subtema (coluna nullable); só valida UUID real.
    if (typeof dto.subtemaId === 'string') {
      const details: ErrorDetail[] = [];
      await this.validarSubtema(dto.subtemaId, sessao.disciplinaId, details);
      this.throwIfDetails(details);
    }

    const atualizada = await this.prisma.sessaoEstudo.update({
      where: { id: sessao.id },
      data: {
        ...(dto.duracaoMin !== undefined ? { duracaoMin: dto.duracaoMin } : {}),
        ...(dto.subtemaId !== undefined ? { subtemaId: dto.subtemaId } : {}),
      },
    });
    return toSessaoResponse(atualizada);
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const sessao = await this.loadOwnedOrThrow(user, id);
    // RN-7: cronômetro em andamento não é removível por aqui — soft delete
    // criaria uma linha zumbi (fim=null, duracaoMin=0); o descarte é o
    // DELETE /sessoes/ativa (hard delete). Alinhado com o 409 do PATCH.
    if (sessao.fim === null) {
      throw new ConflictException(
        'Cronômetro em andamento não pode ser removido; use DELETE /sessoes/ativa para descartar.',
      );
    }
    await this.prisma.sessaoEstudo.update({
      where: { id: sessao.id },
      data: { deletedAt: new Date() },
    });
  }

  /** Recurso inexistente/soft-deleted → 404; de outro aluno → 403 (CA-10). */
  private async loadOwnedOrThrow(user: AuthenticatedUser, id: string): Promise<SessaoEstudo> {
    const sessao = await this.prisma.sessaoEstudo.findUnique({ where: { id } });
    if (!sessao || sessao.deletedAt !== null) {
      throw new NotFoundException('Sessão não encontrada.');
    }
    if (sessao.alunoId !== user.sub) {
      throw new ForbiddenException('Acesso negado a esta sessão.');
    }
    return sessao;
  }

  private async findAtivaOrThrow(alunoId: string): Promise<SessaoEstudo> {
    const sessao = await this.prisma.sessaoEstudo.findFirst({
      where: { alunoId, origem: SessaoOrigem.CRONOMETRO, fim: null, deletedAt: null },
    });
    if (!sessao) {
      throw new NotFoundException('Nenhum cronômetro em andamento.');
    }
    return sessao;
  }

  private estadoAtivo(sessaoId: string): 'RUNNING' | 'PAUSED' {
    return this.pausas.has(sessaoId) ? 'PAUSED' : 'RUNNING';
  }

  /** `data` (YYYY-MM-DD) → inicio em data@00:00Z; futuro → 422 (CB-4). */
  private parseDataManual(data: string): Date {
    const inicio = new Date(`${data}T00:00:00Z`);
    const valida =
      !Number.isNaN(inicio.getTime()) && inicio.toISOString().slice(0, 10) === data;
    if (!valida) {
      throw new UnprocessableEntityException({
        message: 'Data de registro manual inválida.',
        details: [{ field: 'data', issue: 'data deve ser uma data de calendário válida' }],
      });
    }

    const hojeMax = new Date(Date.now() + FOLGA_TZ_MS).toISOString().slice(0, 10);
    if (data > hojeMax) {
      throw new UnprocessableEntityException({
        message: 'Data de registro manual no futuro.',
        details: [{ field: 'data', issue: 'data não pode ser futura' }],
      });
    }
    return inicio;
  }

  /**
   * Coerência das referências (422 com details — CA-8, CA-9, CB-6, RN-4).
   * O escopo de RN-4 ("plano de turma matriculada") é a regra definitiva de
   * leitura do PlanosAccessService: PESSOAL próprio ou OFICIAL publicado
   * vinculado a turma em que o aluno tem matrícula ATIVA. AlunoPlanoAtivo
   * segue não existindo — o "plano ativo" é resolvido no frontend pelo
   * cronograma ativo.
   */
  private async assertReferenciasValidas(
    user: AuthenticatedUser,
    disciplinaId: string,
    subtemaId?: string | null,
    blocoId?: string | null,
    // Dentro de transação, as leituras DEVEM usar o client transacional (tx):
    // usar this.prisma disputaria conexões do pool com a própria transação
    // (deadlock de pool sob starts concorrentes) e leria fora do snapshot.
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    const details: ErrorDetail[] = [];

    const disciplina = await db.disciplina.findUnique({
      where: { id: disciplinaId },
      include: { plano: true },
    });
    if (!disciplina || disciplina.deletedAt !== null || disciplina.plano.deletedAt !== null) {
      details.push({ field: 'disciplinaId', issue: 'disciplina inexistente' });
    } else {
      // Regra canônica de leitura do PlanosAccessService; aqui a referência
      // inválida vira 422 com details (CB-6), não 403.
      try {
        await this.planosAccess.assertCanRead(disciplina.plano, user);
      } catch {
        details.push({
          field: 'disciplinaId',
          issue: 'disciplina deve pertencer a um plano acessível ao aluno',
        });
      }
    }

    // != null: null explícito no POST equivale a ausente (referência opcional).
    if (subtemaId != null) {
      await this.validarSubtema(subtemaId, disciplinaId, details, db);
    }

    if (blocoId != null) {
      const bloco = await db.blocoCronograma.findUnique({
        where: { id: blocoId },
        include: { cronograma: true },
      });
      if (!bloco || bloco.deletedAt !== null || bloco.cronograma.deletedAt !== null) {
        details.push({ field: 'blocoId', issue: 'bloco inexistente' });
      } else if (bloco.cronograma.alunoId !== user.sub) {
        details.push({
          field: 'blocoId',
          issue: 'bloco deve pertencer a um cronograma do próprio aluno',
        });
      } else if (bloco.disciplinaId !== disciplinaId) {
        details.push({
          field: 'blocoId',
          issue: 'bloco deve ter a mesma disciplina da sessão',
        });
      }
    }

    this.throwIfDetails(details);
  }

  private async validarSubtema(
    subtemaId: string,
    disciplinaId: string,
    details: ErrorDetail[],
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    const subtema = await db.subtema.findUnique({
      where: { id: subtemaId },
      include: { tema: true },
    });
    if (!subtema || subtema.deletedAt !== null || subtema.tema.deletedAt !== null) {
      details.push({ field: 'subtemaId', issue: 'subtema inexistente' });
    } else if (subtema.tema.disciplinaId !== disciplinaId) {
      details.push({
        field: 'subtemaId',
        issue: 'subtema deve pertencer à disciplina informada',
      });
    }
  }

  private throwIfDetails(details: ErrorDetail[]): void {
    if (details.length > 0) {
      throw new UnprocessableEntityException({
        message: 'Referências da sessão inválidas.',
        details,
      });
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  private isRecordNotFound(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
  }
}
