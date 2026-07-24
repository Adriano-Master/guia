import { Matricula, MatriculaStatus, PlanoTipo, Turma, TurmaPlano } from '@prisma/client';

export interface TurmaResponse {
  id: string;
  nome: string;
  descricao: string | null;
  professorId: string;
  ativa: boolean;
  createdAt: string;
  updatedAt: string;
  /**
   * Presente apenas para dono/ADMIN/MODERADOR: o código é o mecanismo de
   * convite do professor (RN-02); aluno matriculado lê a turma sem ele.
   */
  codigoConvite?: string;
}

export function toTurmaResponse(turma: Turma, includeCodigoConvite: boolean): TurmaResponse {
  return {
    id: turma.id,
    nome: turma.nome,
    descricao: turma.descricao,
    professorId: turma.professorId,
    ativa: turma.ativa,
    createdAt: turma.createdAt.toISOString(),
    updatedAt: turma.updatedAt.toISOString(),
    ...(includeCodigoConvite ? { codigoConvite: turma.codigoConvite } : {}),
  };
}

export interface MatriculaAlunoResumo {
  id: string;
  nome: string;
  email: string;
}

export interface MatriculaTurmaResumo {
  id: string;
  nome: string;
  descricao: string | null;
  ativa: boolean;
}

export interface MatriculaResponse {
  id: string;
  turmaId: string;
  alunoId: string;
  status: MatriculaStatus;
  createdAt: string;
  updatedAt: string;
  aluno?: MatriculaAlunoResumo;
  turma?: MatriculaTurmaResumo;
}

export type MatriculaWithRefs = Matricula & {
  aluno?: MatriculaAlunoResumo;
  turma?: Pick<Turma, 'id' | 'nome' | 'descricao' | 'ativa'>;
};

export function toMatriculaResponse(matricula: MatriculaWithRefs): MatriculaResponse {
  return {
    id: matricula.id,
    turmaId: matricula.turmaId,
    alunoId: matricula.alunoId,
    status: matricula.status,
    createdAt: matricula.createdAt.toISOString(),
    updatedAt: matricula.updatedAt.toISOString(),
    ...(matricula.aluno
      ? { aluno: { id: matricula.aluno.id, nome: matricula.aluno.nome, email: matricula.aluno.email } }
      : {}),
    ...(matricula.turma
      ? {
          turma: {
            id: matricula.turma.id,
            nome: matricula.turma.nome,
            descricao: matricula.turma.descricao,
            ativa: matricula.turma.ativa,
          },
        }
      : {}),
  };
}

export interface TurmaPlanoPlanoResumo {
  id: string;
  titulo: string;
  tipo: PlanoTipo;
  publicado: boolean;
}

export interface TurmaPlanoResponse {
  id: string;
  turmaId: string;
  planoId: string;
  createdAt: string;
  plano?: TurmaPlanoPlanoResumo;
}

export type TurmaPlanoWithPlano = TurmaPlano & { plano?: TurmaPlanoPlanoResumo };

export function toTurmaPlanoResponse(turmaPlano: TurmaPlanoWithPlano): TurmaPlanoResponse {
  return {
    id: turmaPlano.id,
    turmaId: turmaPlano.turmaId,
    planoId: turmaPlano.planoId,
    createdAt: turmaPlano.createdAt.toISOString(),
    ...(turmaPlano.plano
      ? {
          plano: {
            id: turmaPlano.plano.id,
            titulo: turmaPlano.plano.titulo,
            tipo: turmaPlano.plano.tipo,
            publicado: turmaPlano.plano.publicado,
          },
        }
      : {}),
  };
}
