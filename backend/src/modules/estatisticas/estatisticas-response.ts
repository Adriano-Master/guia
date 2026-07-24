export type Granularidade = 'dia' | 'semana';
export type AgruparPor = 'disciplina' | 'tema';

/** min → horas, half-up a 2 casas (CA-01: SUM(duracao_min)/60). */
export function minutosParaHoras(minutos: number): number {
  return Math.round((minutos / 60) * 100) / 100;
}

/**
 * total = 0 → 0% (CA-03). Uma casa decimal (half-up) por exigência explícita
 * do CA-03 — deliberadamente diferente das 2 casas do módulo progresso.
 */
export function percentualProgresso(concluidos: number, totalSubtemas: number): number {
  if (totalSubtemas === 0) {
    return 0;
  }
  return Math.round((concluidos / totalSubtemas) * 100 * 10) / 10;
}

export interface ProgressoTotais {
  percentual: number;
  concluidos: number;
  totalSubtemas: number;
}

export interface QuestoesTotais {
  total: number;
  erros: number;
  taxaErro: number;
}

export interface ResumoResponse {
  horasTotais: number;
  progresso: ProgressoTotais;
  questoes: QuestoesTotais;
}

export interface HorasDisciplinaItem {
  disciplinaId: string;
  disciplina: string;
  horas: number;
}

export interface HorasPorDisciplinaResponse {
  data: HorasDisciplinaItem[];
  totalHoras: number;
}

export interface SerieTemporalBucket {
  /** Dia de calendário "YYYY-MM-DD"; na granularidade semanal, a segunda-feira. */
  bucket: string;
  horas: number;
}

export interface SerieTemporalResponse {
  granularidade: Granularidade;
  /** Período efetivo aplicado (ecoa o default de 30 dias quando omitido). */
  from: string;
  to: string;
  /** Timezone IANA efetivo usado nos buckets (RN-03). */
  timezone: string;
  data: SerieTemporalBucket[];
}

export interface ProgressoDisciplinaItem {
  disciplinaId: string;
  disciplina: string;
  percentual: number;
  concluidos: number;
  totalSubtemas: number;
}

export interface ProgressoEstatisticasResponse extends ProgressoTotais {
  /** Presente apenas quando `?porDisciplina=true`. */
  porDisciplina?: ProgressoDisciplinaItem[];
}

export interface DesempenhoQuestoesItem {
  disciplinaId?: string;
  temaId?: string;
  nome: string;
  total: number;
  erros: number;
  taxaErro: number;
}

export interface DesempenhoQuestoesResponse extends QuestoesTotais {
  /** Presente apenas quando `?agruparPor` é informado. */
  data?: DesempenhoQuestoesItem[];
}
