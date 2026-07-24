import { ProgressoSubtema } from '@prisma/client';

export interface ProgressoMarcacaoResponse {
  subtemaId: string;
  concluido: boolean;
  concluidoEm: string | null;
}

/**
 * Extensão ao shape resumido do design: os nós de disciplina/tema carregam
 * `nome` e `ordem` (e o subtema, `ordem` e `concluidoEm`) para o frontend
 * renderizar a árvore sem uma segunda chamada a /planos/{id}/arvore.
 */
export interface ProgressoSubtemaNode {
  subtemaId: string;
  nome: string;
  ordem: number;
  concluido: boolean;
  concluidoEm: string | null;
}

export interface ProgressoTemaNode {
  temaId: string;
  nome: string;
  ordem: number;
  progressoPercentual: number;
  concluidos: number;
  totais: number;
  subtemas: ProgressoSubtemaNode[];
}

export interface ProgressoDisciplinaNode {
  disciplinaId: string;
  nome: string;
  ordem: number;
  progressoPercentual: number;
  concluidos: number;
  totais: number;
  temas: ProgressoTemaNode[];
}

export interface ProgressoPlanoResponse {
  planoId: string;
  progressoPercentual: number;
  subtemasConcluidos: number;
  subtemasTotais: number;
  disciplinas: ProgressoDisciplinaNode[];
}

export interface ProgressoSubtemaFlatItem {
  subtemaId: string;
  nome: string;
  ordem: number;
  temaId: string;
  disciplinaId: string;
  concluido: boolean;
  concluidoEm: string | null;
}

/** total = 0 → 0% (CA-07, CB-01); 2 casas decimais (half-up). */
export function percentual(concluidos: number, totais: number): number {
  if (totais === 0) {
    return 0;
  }
  return Math.round((concluidos / totais) * 100 * 100) / 100;
}

export function toProgressoMarcacaoResponse(
  progresso: ProgressoSubtema,
): ProgressoMarcacaoResponse {
  return {
    subtemaId: progresso.subtemaId,
    concluido: progresso.concluido,
    concluidoEm: progresso.concluidoEm ? progresso.concluidoEm.toISOString() : null,
  };
}
