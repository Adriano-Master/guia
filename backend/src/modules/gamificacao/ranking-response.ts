/** numeric(10,2) do banco (ou ausência de registro) → number com 2 casas. */
export function horasParaNumber(horas: unknown): number {
  return Math.round(Number(horas ?? 0) * 100) / 100;
}

export interface RankingItemResponse {
  posicao: number;
  alunoId: string;
  nome: string;
  pontos: number;
  subtemasConcluidos: number;
  horasEstudadas: number;
}

export interface RankingMeTurmaItem {
  turmaId: string;
  nome: string;
  posicao: number;
}

export interface RankingMeResponse {
  /** null apenas no caso-limite de token válido de aluno já fora do ranking (INATIVO). */
  posicaoGlobal: number | null;
  pontos: number;
  subtemasConcluidos: number;
  horasEstudadas: number;
  semanasConsistentes: number;
  composicao: {
    pontosSubtemas: number;
    pontosHoras: number;
    pontosBonus: number;
  };
  turmas: RankingMeTurmaItem[];
}
