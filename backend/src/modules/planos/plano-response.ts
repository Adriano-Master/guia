import { Disciplina, PesoDisciplina, Plano, PlanoTipo, Subtema, Tema } from '@prisma/client';

export interface SubtemaResponse {
  id: string;
  temaId: string;
  nome: string;
  ordem: number;
  duracaoEstimadaMin: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface TemaResponse {
  id: string;
  disciplinaId: string;
  nome: string;
  ordem: number;
  createdAt: string;
  updatedAt: string;
  subtemas?: SubtemaResponse[];
}

export interface DisciplinaResponse {
  id: string;
  planoId: string;
  nome: string;
  ordem: number;
  createdAt: string;
  updatedAt: string;
  temas?: TemaResponse[];
}

export interface PesoDisciplinaResponse {
  id: string;
  planoId: string;
  disciplinaId: string;
  pesoPercentual: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlanoResponse {
  id: string;
  titulo: string;
  descricao: string | null;
  tipo: PlanoTipo;
  autorId: string;
  planoOrigemId: string | null;
  publicado: boolean;
  createdAt: string;
  updatedAt: string;
  disciplinas?: DisciplinaResponse[];
  pesos?: PesoDisciplinaResponse[];
}

export type DisciplinaWithTree = Disciplina & { temas?: TemaWithSubtemas[] };
export type TemaWithSubtemas = Tema & { subtemas?: Subtema[] };
export type PlanoWithTree = Plano & {
  disciplinas?: DisciplinaWithTree[];
  pesos?: PesoDisciplina[];
};

export function toSubtemaResponse(subtema: Subtema): SubtemaResponse {
  return {
    id: subtema.id,
    temaId: subtema.temaId,
    nome: subtema.nome,
    ordem: subtema.ordem,
    duracaoEstimadaMin: subtema.duracaoEstimadaMin,
    createdAt: subtema.createdAt.toISOString(),
    updatedAt: subtema.updatedAt.toISOString(),
  };
}

export function toTemaResponse(tema: TemaWithSubtemas): TemaResponse {
  return {
    id: tema.id,
    disciplinaId: tema.disciplinaId,
    nome: tema.nome,
    ordem: tema.ordem,
    createdAt: tema.createdAt.toISOString(),
    updatedAt: tema.updatedAt.toISOString(),
    ...(tema.subtemas ? { subtemas: tema.subtemas.map(toSubtemaResponse) } : {}),
  };
}

export function toDisciplinaResponse(disciplina: DisciplinaWithTree): DisciplinaResponse {
  return {
    id: disciplina.id,
    planoId: disciplina.planoId,
    nome: disciplina.nome,
    ordem: disciplina.ordem,
    createdAt: disciplina.createdAt.toISOString(),
    updatedAt: disciplina.updatedAt.toISOString(),
    ...(disciplina.temas ? { temas: disciplina.temas.map(toTemaResponse) } : {}),
  };
}

/** pesoPercentual sai como number (2 casas), nunca como string Decimal. */
export function toPesoDisciplinaResponse(peso: PesoDisciplina): PesoDisciplinaResponse {
  return {
    id: peso.id,
    planoId: peso.planoId,
    disciplinaId: peso.disciplinaId,
    pesoPercentual: peso.pesoPercentual.toNumber(),
    createdAt: peso.createdAt.toISOString(),
    updatedAt: peso.updatedAt.toISOString(),
  };
}

export function toPlanoResponse(plano: PlanoWithTree): PlanoResponse {
  return {
    id: plano.id,
    titulo: plano.titulo,
    descricao: plano.descricao,
    tipo: plano.tipo,
    autorId: plano.autorId,
    planoOrigemId: plano.planoOrigemId,
    publicado: plano.publicado,
    createdAt: plano.createdAt.toISOString(),
    updatedAt: plano.updatedAt.toISOString(),
    ...(plano.disciplinas ? { disciplinas: plano.disciplinas.map(toDisciplinaResponse) } : {}),
    ...(plano.pesos ? { pesos: plano.pesos.map(toPesoDisciplinaResponse) } : {}),
  };
}
