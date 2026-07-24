import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MatriculaStatus, Role, Turma } from '@prisma/client';
import { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { PrismaService } from '../../prisma/prisma.service';

/** ADMIN/MODERADOR moderam qualquer turma (RN-01); PROFESSOR só as suas. */
export function isModeracao(role: Role): boolean {
  return role === Role.ADMIN || role === Role.MODERADOR;
}

/**
 * Autorização em duas camadas, no molde do PlanosAccessService: além do guard
 * de role, todo acesso a turma passa por aqui. Turma inexistente ou
 * soft-deleted → 404; acesso cruzado → 403 (RN-01/RN-07).
 */
@Injectable()
export class TurmasAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async loadTurmaOrThrow(turmaId: string): Promise<Turma> {
    const turma = await this.prisma.turma.findUnique({ where: { id: turmaId } });
    if (!turma || turma.deletedAt !== null) {
      throw new NotFoundException('Turma não encontrada.');
    }
    return turma;
  }

  isDonoOuModeracao(turma: Turma, user: AuthenticatedUser): boolean {
    return isModeracao(user.role) || turma.professorId === user.sub;
  }

  /** Gestão (RN-01): só dono ou ADMIN/MODERADOR; outro professor/aluno → 403. */
  assertDono(turma: Turma, user: AuthenticatedUser): void {
    if (this.isDonoOuModeracao(turma, user)) {
      return;
    }
    throw new ForbiddenException('Apenas o professor dono da turma pode realizar esta operação.');
  }

  /** Leitura (RN-07): dono/moderação OU aluno com matrícula ATIVA na turma. */
  async assertCanRead(turma: Turma, user: AuthenticatedUser): Promise<void> {
    if (this.isDonoOuModeracao(turma, user)) {
      return;
    }
    if (user.role === Role.ALUNO && (await this.hasMatriculaAtiva(turma.id, user.sub))) {
      return;
    }
    throw new ForbiddenException('Acesso negado a esta turma.');
  }

  async hasMatriculaAtiva(turmaId: string, alunoId: string): Promise<boolean> {
    const matricula = await this.prisma.matricula.findUnique({
      where: { turmaId_alunoId: { turmaId, alunoId } },
    });
    return (
      matricula !== null && matricula.deletedAt === null && matricula.status === MatriculaStatus.ATIVA
    );
  }
}
