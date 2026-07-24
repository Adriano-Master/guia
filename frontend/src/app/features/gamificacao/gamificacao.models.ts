/** Linha de GET /ranking/global e /ranking/turmas/{id} (posição sobre o conjunto completo). */
export interface RankingEntry {
  posicao: number;
  alunoId: string;
  nome: string;
  pontos: number;
  subtemasConcluidos: number;
  horasEstudadas: number;
}

export interface PosicaoTurma {
  turmaId: string;
  nome: string;
  posicao: number;
}

/** Parcelas da fórmula de pontuação (design §fórmula-de-pontuação). */
export interface ComposicaoPontuacao {
  pontosSubtemas: number;
  pontosHoras: number;
  pontosBonus: number;
}

/** GET /ranking/me — posição global e por turma do aluno, com composição (CA-06). */
export interface MinhaPontuacao {
  /** null quando o aluno está fora do ranking (ex.: recém-INATIVO, RN-05). */
  posicaoGlobal: number | null;
  pontos: number;
  subtemasConcluidos: number;
  horasEstudadas: number;
  semanasConsistentes: number;
  composicao: ComposicaoPontuacao;
  turmas: PosicaoTurma[];
}

export interface RankingListParams {
  page?: number;
  pageSize?: number;
}
