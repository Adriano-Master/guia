import type { PlanoTipo } from '../planos/planos.models';

export type MatriculaStatus = 'ATIVA' | 'INATIVA';

export interface Turma {
  id: string;
  nome: string;
  descricao: string | null;
  professorId: string;
  ativa: boolean;
  createdAt: string;
  updatedAt: string;
  /** Presente apenas para dono/ADMIN/MODERADOR (aluno lê a turma sem ele). */
  codigoConvite?: string;
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

export interface Matricula {
  id: string;
  turmaId: string;
  alunoId: string;
  status: MatriculaStatus;
  createdAt: string;
  updatedAt: string;
  /** Presente em GET /turmas/{id}/matriculas. */
  aluno?: MatriculaAlunoResumo;
  /** Presente em POST /matriculas, GET /matriculas/me e PATCH /matriculas/{id}. */
  turma?: MatriculaTurmaResumo;
}

export interface TurmaPlanoPlanoResumo {
  id: string;
  titulo: string;
  tipo: PlanoTipo;
  publicado: boolean;
}

export interface TurmaPlano {
  id: string;
  turmaId: string;
  planoId: string;
  createdAt: string;
  plano?: TurmaPlanoPlanoResumo;
}

export interface TurmasListParams {
  page?: number;
  pageSize?: number;
  sort?: string;
  ativa?: boolean;
}

export interface MatriculasListParams {
  page?: number;
  pageSize?: number;
  sort?: string;
  status?: MatriculaStatus;
}
