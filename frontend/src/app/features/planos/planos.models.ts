export type PlanoTipo = 'OFICIAL' | 'PESSOAL';

export interface Plano {
  id: string;
  titulo: string;
  descricao: string | null;
  tipo: PlanoTipo;
  autorId: string;
  planoOrigemId: string | null;
  publicado: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Disciplina {
  id: string;
  planoId: string;
  nome: string;
  ordem: number;
  createdAt: string;
  updatedAt: string;
}

export interface Tema {
  id: string;
  disciplinaId: string;
  nome: string;
  ordem: number;
  createdAt: string;
  updatedAt: string;
}

export interface Subtema {
  id: string;
  temaId: string;
  nome: string;
  ordem: number;
  duracaoEstimadaMin: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface PesoDisciplina {
  id: string;
  planoId: string;
  disciplinaId: string;
  pesoPercentual: number;
}

export interface TemaTree extends Tema {
  subtemas: Subtema[];
}

export interface DisciplinaTree extends Disciplina {
  temas: TemaTree[];
}

export interface PlanoTree extends Plano {
  disciplinas: DisciplinaTree[];
  pesos: PesoDisciplina[];
}

export interface PlanosListParams {
  page?: number;
  pageSize?: number;
  sort?: string;
  tipo?: PlanoTipo;
  publicado?: boolean;
  autorId?: string;
}

export interface PesoInput {
  disciplinaId: string;
  pesoPercentual: number;
}
