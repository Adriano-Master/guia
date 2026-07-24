import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PlanoTipo, Prisma } from '@prisma/client';
import { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { ErrorDetail } from '../../common/errors/error-codes';
import {
  PaginatedResponse,
  paginated,
  parseSort,
  toSkipTake,
  toStableOrderBy,
} from '../../common/pagination/pagination';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { PlanosAccessService } from '../planos/planos-access.service';
import { VincularPlanoDto } from './dto/vincular-plano.dto';
import { toTurmaPlanoResponse, TurmaPlanoResponse } from './turma-response';
import { TurmasAccessService } from './turmas-access.service';

const SORTABLE_FIELDS = ['createdAt'];

const planoResumoSelect = { select: { id: true, titulo: true, tipo: true, publicado: true } };

@Injectable()
export class TurmaPlanosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly turmasAccess: TurmasAccessService,
    private readonly planosAccess: PlanosAccessService,
  ) {}

  /**
   * RN-06: só Plano OFICIAL e publicado é vinculável — invariante no service,
   * refletida como 422 com details. Autoria do plano não importa (caso de
   * borda da spec). Duplicado cai no unique (turma_id, plano_id) → 409.
   */
  async vincular(
    user: AuthenticatedUser,
    turmaId: string,
    dto: VincularPlanoDto,
  ): Promise<TurmaPlanoResponse> {
    const turma = await this.turmasAccess.loadTurmaOrThrow(turmaId);
    this.turmasAccess.assertDono(turma, user);

    const plano = await this.planosAccess.loadPlanoOrThrow(dto.planoId);
    const details: ErrorDetail[] = [];
    if (plano.tipo !== PlanoTipo.OFICIAL) {
      details.push({ field: 'planoId', issue: 'plano deve ser OFICIAL' });
    }
    if (!plano.publicado) {
      details.push({ field: 'planoId', issue: 'plano deve estar publicado' });
    }
    if (details.length > 0) {
      throw new UnprocessableEntityException({
        message: 'Só é possível vincular planos OFICIAIS publicados à turma.',
        details,
      });
    }

    try {
      const vinculo = await this.prisma.turmaPlano.create({
        data: { turmaId, planoId: dto.planoId },
        include: { plano: planoResumoSelect },
      });
      return toTurmaPlanoResponse(vinculo);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Plano já vinculado a esta turma.');
      }
      throw error;
    }
  }

  /** Planos da turma: dono/moderação OU aluno com matrícula ATIVA (RN-07). */
  async listByTurma(
    user: AuthenticatedUser,
    turmaId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResponse<TurmaPlanoResponse>> {
    const turma = await this.turmasAccess.loadTurmaOrThrow(turmaId);
    await this.turmasAccess.assertCanRead(turma, user);

    const sort = parseSort(query.sort, SORTABLE_FIELDS);
    // Planos soft-deletados após o vínculo saem da listagem; para o aluno,
    // planos despublicados após o vínculo também (RN-06/RN-07 — o GET do
    // plano daria 403, então listar o título vazaria dado inacessível).
    // Gestor segue vendo tudo para poder desvincular.
    const isGestor = this.turmasAccess.isDonoOuModeracao(turma, user);
    const where: Prisma.TurmaPlanoWhereInput = {
      turmaId,
      plano: { deletedAt: null, ...(isGestor ? {} : { publicado: true }) },
    };

    const [vinculos, total] = await this.prisma.$transaction([
      this.prisma.turmaPlano.findMany({
        where,
        include: { plano: planoResumoSelect },
        orderBy: toStableOrderBy(sort, { createdAt: 'asc' }),
        ...toSkipTake(query),
      }),
      this.prisma.turmaPlano.count({ where }),
    ]);

    return paginated(vinculos.map(toTurmaPlanoResponse), query, total);
  }

  /** Desvínculo é HARD delete (design; ver comentário no schema). Já removido → 404. */
  async desvincular(user: AuthenticatedUser, turmaId: string, planoId: string): Promise<void> {
    const turma = await this.turmasAccess.loadTurmaOrThrow(turmaId);
    this.turmasAccess.assertDono(turma, user);

    const removidos = await this.prisma.turmaPlano.deleteMany({ where: { turmaId, planoId } });
    if (removidos.count === 0) {
      throw new NotFoundException('Plano não vinculado a esta turma.');
    }
  }
}
