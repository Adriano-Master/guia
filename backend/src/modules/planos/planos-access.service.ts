import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Disciplina, MatriculaStatus, Plano, PlanoTipo, Role, Subtema, Tema } from '@prisma/client';
import { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { PrismaService } from '../../prisma/prisma.service';

export const INTERNAL_ROLES: Role[] = [Role.ADMIN, Role.MODERADOR, Role.PROFESSOR];

export function isInterno(role: Role): boolean {
  return INTERNAL_ROLES.includes(role);
}

/**
 * Autorização em duas camadas (DT-04): além do guard de role, todo acesso a
 * plano (e a disciplina/tema/subtema, que herdam do plano) passa por aqui.
 * Recurso inexistente ou soft-deleted → 404; acesso cruzado → 403.
 */
@Injectable()
export class PlanosAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async loadPlanoOrThrow(planoId: string): Promise<Plano> {
    const plano = await this.prisma.plano.findUnique({ where: { id: planoId } });
    if (!plano || plano.deletedAt !== null) {
      throw new NotFoundException('Plano não encontrado.');
    }
    return plano;
  }

  /** Carrega a disciplina com a cadeia até o plano ativo (404 se qualquer nível deletado). */
  async loadDisciplinaOrThrow(disciplinaId: string): Promise<Disciplina & { plano: Plano }> {
    const disciplina = await this.prisma.disciplina.findUnique({
      where: { id: disciplinaId },
      include: { plano: true },
    });
    if (!disciplina || disciplina.deletedAt !== null || disciplina.plano.deletedAt !== null) {
      throw new NotFoundException('Disciplina não encontrada.');
    }
    return disciplina;
  }

  async loadTemaOrThrow(temaId: string): Promise<Tema & { disciplina: Disciplina & { plano: Plano } }> {
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
      throw new NotFoundException('Tema não encontrado.');
    }
    return tema;
  }

  async loadSubtemaOrThrow(
    subtemaId: string,
  ): Promise<Subtema & { tema: Tema & { disciplina: Disciplina & { plano: Plano } } }> {
    const subtema = await this.prisma.subtema.findUnique({
      where: { id: subtemaId },
      include: { tema: { include: { disciplina: { include: { plano: true } } } } },
    });
    if (
      !subtema ||
      subtema.deletedAt !== null ||
      subtema.tema.deletedAt !== null ||
      subtema.tema.disciplina.deletedAt !== null ||
      subtema.tema.disciplina.plano.deletedAt !== null
    ) {
      throw new NotFoundException('Subtema não encontrado.');
    }
    return subtema;
  }

  /**
   * Leitura (regra definitiva de matrícula): autor OU interno OU aluno com
   * OFICIAL publicado vinculado (TurmaPlano) a turma não-deletada em que ele
   * tem matrícula ATIVA. OFICIAL publicado sem vínculo com turma do aluno →
   * 403. Propaga para tudo que herda a legibilidade do plano (conteúdo,
   * cronograma, sessões, progresso, questões). AlunoPlanoAtivo segue não
   * existindo — o "plano ativo" é resolvido no frontend pelo cronograma ativo.
   */
  async assertCanRead(plano: Plano, user: AuthenticatedUser): Promise<void> {
    if (isInterno(user.role) || plano.autorId === user.sub) {
      return;
    }
    if (
      plano.tipo === PlanoTipo.OFICIAL &&
      plano.publicado &&
      (await this.alunoTemVinculoAtivo(plano.id, user.sub))
    ) {
      return;
    }
    throw new ForbiddenException('Acesso negado a este plano.');
  }

  /**
   * EXISTS em UMA query (TurmaPlano ⋈ Turma ⋈ Matricula): há vínculo do plano
   * com alguma turma não-deletada em que o aluno tem matrícula ATIVA (não
   * soft-deletada)? Uma ida ao banco, sem carregar coleções.
   */
  private async alunoTemVinculoAtivo(planoId: string, alunoId: string): Promise<boolean> {
    const vinculo = await this.prisma.turmaPlano.findFirst({
      where: {
        planoId,
        turma: {
          deletedAt: null,
          matriculas: { some: { alunoId, status: MatriculaStatus.ATIVA, deletedAt: null } },
        },
      },
      select: { id: true },
    });
    return vinculo !== null;
  }

  /** Edição: autor (PESSOAL) ou qualquer interno (OFICIAL) — RN-06. */
  assertCanEdit(plano: Plano, user: AuthenticatedUser): void {
    if (plano.tipo === PlanoTipo.OFICIAL) {
      if (!isInterno(user.role)) {
        throw new ForbiddenException('Apenas usuários internos podem editar planos oficiais.');
      }
      return;
    }
    if (plano.autorId !== user.sub) {
      throw new ForbiddenException('Apenas o autor pode editar este plano.');
    }
  }
}
