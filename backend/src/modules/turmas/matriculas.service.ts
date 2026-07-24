import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { MatriculaStatus, Prisma, Role } from '@prisma/client';
import { AuthenticatedUser } from '../../common/auth/authenticated-user';
import {
  PaginatedResponse,
  paginated,
  parseSort,
  toSkipTake,
  toStableOrderBy,
} from '../../common/pagination/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { ListMatriculasQueryDto } from './dto/list-matriculas-query.dto';
import { MatricularDto } from './dto/matricular.dto';
import { UpdateMatriculaDto } from './dto/update-matricula.dto';
import { VincularAlunoDto } from './dto/vincular-aluno.dto';
import { MatriculaResponse, toMatriculaResponse } from './turma-response';
import { isModeracao, TurmasAccessService } from './turmas-access.service';

const SORTABLE_FIELDS = ['createdAt', 'status'];

const alunoResumoSelect = { select: { id: true, nome: true, email: true } };
const turmaResumoSelect = { select: { id: true, nome: true, descricao: true, ativa: true } };

export interface MatricularResult {
  matricula: MatriculaResponse;
  /** true = matrícula INATIVA/soft-deleted reativada (200); false = criada (201). */
  reativada: boolean;
}

@Injectable()
export class MatriculasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TurmasAccessService,
  ) {}

  /**
   * Matrícula por código (RN-02..05): turma inexistente/soft-deleted → 404;
   * inativa → 409; já ATIVA → 409; INATIVA (ou soft-deleted) → reativa em vez
   * de duplicar. Corrida entre criações concorrentes cai no unique
   * (turma_id, aluno_id) → P2002 → 409.
   */
  async matricular(user: AuthenticatedUser, dto: MatricularDto): Promise<MatricularResult> {
    const turma = await this.prisma.turma.findUnique({
      where: { codigoConvite: dto.codigoConvite },
    });
    if (!turma || turma.deletedAt !== null) {
      throw new NotFoundException('Código de convite inválido.');
    }
    if (!turma.ativa) {
      throw new ConflictException('Esta turma não está aceitando novas matrículas.');
    }

    const existente = await this.prisma.matricula.findUnique({
      where: { turmaId_alunoId: { turmaId: turma.id, alunoId: user.sub } },
    });

    if (existente && existente.deletedAt === null && existente.status === MatriculaStatus.ATIVA) {
      throw new ConflictException('Você já está matriculado nesta turma.');
    }

    if (existente) {
      // Reativação (RN-03): revive inclusive registro soft-deleted — o unique
      // impede uma linha nova para o mesmo par.
      const reativada = await this.prisma.matricula.update({
        where: { id: existente.id },
        data: { status: MatriculaStatus.ATIVA, deletedAt: null },
        include: { turma: turmaResumoSelect },
      });
      return { matricula: toMatriculaResponse(reativada), reativada: true };
    }

    try {
      const criada = await this.prisma.matricula.create({
        data: { turmaId: turma.id, alunoId: user.sub },
        include: { turma: turmaResumoSelect },
      });
      return { matricula: toMatriculaResponse(criada), reativada: false };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Você já está matriculado nesta turma.');
      }
      throw error;
    }
  }

  /**
   * Vínculo direto pelo professor (dono da turma ou ADMIN/MODERADOR) por
   * email do aluno. Turma soft-deleted → 404; email sem User ALUNO ativo →
   * 422 genérico ("aluno não encontrado", sem vazar se o email existe com
   * outra role); matrícula já ATIVA → 409; INATIVA/soft-deleted → reativa.
   * Diferente do POST /matriculas por código, NÃO exige turma.ativa: o
   * vínculo manual é gesto deliberado do professor — `ativa=false` revoga
   * apenas a autoatribuição por código de convite.
   */
  async vincularAluno(
    user: AuthenticatedUser,
    turmaId: string,
    dto: VincularAlunoDto,
  ): Promise<MatricularResult> {
    const turma = await this.access.loadTurmaOrThrow(turmaId);
    this.access.assertDono(turma, user);

    const aluno = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!aluno || aluno.deletedAt !== null || aluno.role !== Role.ALUNO) {
      throw new UnprocessableEntityException({
        message: 'Aluno não encontrado.',
        details: [{ field: 'email', issue: 'aluno não encontrado' }],
      });
    }

    const existente = await this.prisma.matricula.findUnique({
      where: { turmaId_alunoId: { turmaId: turma.id, alunoId: aluno.id } },
    });

    if (existente && existente.deletedAt === null && existente.status === MatriculaStatus.ATIVA) {
      throw new ConflictException('Aluno já matriculado nesta turma.');
    }

    if (existente) {
      const reativada = await this.prisma.matricula.update({
        where: { id: existente.id },
        data: { status: MatriculaStatus.ATIVA, deletedAt: null },
        include: { aluno: alunoResumoSelect },
      });
      return { matricula: toMatriculaResponse(reativada), reativada: true };
    }

    try {
      const criada = await this.prisma.matricula.create({
        data: { turmaId: turma.id, alunoId: aluno.id },
        include: { aluno: alunoResumoSelect },
      });
      return { matricula: toMatriculaResponse(criada), reativada: false };
    } catch (error) {
      // Corrida entre vínculos concorrentes cai no unique (turma_id, aluno_id).
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Aluno já matriculado nesta turma.');
      }
      throw error;
    }
  }

  /** Alunos da turma (dono/moderação), com dados de User e filtro ?status=. */
  async listByTurma(
    user: AuthenticatedUser,
    turmaId: string,
    query: ListMatriculasQueryDto,
  ): Promise<PaginatedResponse<MatriculaResponse>> {
    const turma = await this.access.loadTurmaOrThrow(turmaId);
    this.access.assertDono(turma, user);

    const sort = parseSort(query.sort, SORTABLE_FIELDS);
    const where: Prisma.MatriculaWhereInput = {
      turmaId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
    };

    const [matriculas, total] = await this.prisma.$transaction([
      this.prisma.matricula.findMany({
        where,
        include: { aluno: alunoResumoSelect },
        orderBy: toStableOrderBy(sort, { createdAt: 'desc' }),
        ...toSkipTake(query),
      }),
      this.prisma.matricula.count({ where }),
    ]);

    return paginated(matriculas.map(toMatriculaResponse), query, total);
  }

  /** Matrículas do próprio aluno, com dados da turma (turmas soft-deleted ficam de fora). */
  async listMe(
    user: AuthenticatedUser,
    query: ListMatriculasQueryDto,
  ): Promise<PaginatedResponse<MatriculaResponse>> {
    const sort = parseSort(query.sort, SORTABLE_FIELDS);
    const where: Prisma.MatriculaWhereInput = {
      alunoId: user.sub,
      deletedAt: null,
      turma: { deletedAt: null },
      ...(query.status ? { status: query.status } : {}),
    };

    const [matriculas, total] = await this.prisma.$transaction([
      this.prisma.matricula.findMany({
        where,
        include: { turma: turmaResumoSelect },
        orderBy: toStableOrderBy(sort, { createdAt: 'desc' }),
        ...toSkipTake(query),
      }),
      this.prisma.matricula.count({ where }),
    ]);

    return paginated(matriculas.map(toMatriculaResponse), query, total);
  }

  /**
   * PATCH de status: dono da turma/moderação (remover ou readmitir) OU o
   * próprio aluno (apenas sair — INATIVA). Outro aluno/professor → 403.
   * Matrícula (ou a turma dela) inexistente/soft-deleted → 404.
   */
  async updateStatus(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateMatriculaDto,
  ): Promise<MatriculaResponse> {
    const matricula = await this.prisma.matricula.findUnique({
      where: { id },
      include: { turma: true },
    });
    if (!matricula || matricula.deletedAt !== null || matricula.turma.deletedAt !== null) {
      throw new NotFoundException('Matrícula não encontrada.');
    }

    const isProprioAluno = matricula.alunoId === user.sub;
    const isGestor = isModeracao(user.role) || matricula.turma.professorId === user.sub;
    if (!isProprioAluno && !isGestor) {
      throw new ForbiddenException('Acesso negado a esta matrícula.');
    }
    // O aluno não se readmite por aqui: PATCH {ATIVA} contornaria as duas
    // revogações do professor (regenerar código e inativar turma). Rematrícula
    // do próprio aluno só via POST /matriculas, que valida código vigente +
    // turma ativa (RN-02/RN-05).
    if (isProprioAluno && !isGestor && dto.status === MatriculaStatus.ATIVA) {
      throw new ForbiddenException(
        'Para se rematricular, use o código de convite da turma em POST /matriculas.',
      );
    }

    const updated = await this.prisma.matricula.update({
      where: { id },
      data: { status: dto.status },
      include: { turma: turmaResumoSelect },
    });
    return toMatriculaResponse(updated);
  }
}
