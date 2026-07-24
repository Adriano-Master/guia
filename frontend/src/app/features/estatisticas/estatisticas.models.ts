export type Granularidade = 'dia' | 'semana';

export type AgruparPor = 'disciplina' | 'tema';

/** GET /estatisticas/resumo — cartões do dashboard (US-01/03/05). */
export interface ResumoEstatisticas {
  horasTotais: number;
  progresso: {
    percentual: number;
    concluidos: number;
    totalSubtemas: number;
  };
  questoes: {
    total: number;
    erros: number;
    /** Fração 0..1 derivada pelo backend (RN-04); 0 quando total=0 (CA-05). */
    taxaErro: number;
  };
}

export interface HorasDisciplina {
  disciplinaId: string;
  disciplina: string;
  horas: number;
}

/** GET /estatisticas/horas-por-disciplina — só disciplinas com sessão (CA-02). */
export interface HorasPorDisciplina {
  data: HorasDisciplina[];
  totalHoras: number;
}

export interface PontoSerie {
  /** Dia "YYYY-MM-DD"; na granularidade semanal, a segunda-feira da semana (RN-03). */
  bucket: string;
  horas: number;
}

/** GET /estatisticas/serie-temporal — contínua, buckets sem estudo vêm com 0 (CA-04). */
export interface SerieTemporal {
  granularidade: Granularidade;
  /** Período efetivo aplicado (ecoa o default de 30 dias quando omitido). */
  from: string;
  to: string;
  timezone: string;
  data: PontoSerie[];
}

export interface ProgressoDisciplina {
  disciplinaId: string;
  disciplina: string;
  percentual: number;
  concluidos: number;
  totalSubtemas: number;
}

/** GET /estatisticas/progresso — sobre os subtemas do plano ativo (RN-02). */
export interface ProgressoEstatisticas {
  percentual: number;
  concluidos: number;
  totalSubtemas: number;
  porDisciplina?: ProgressoDisciplina[];
}

export interface DesempenhoGrupo {
  disciplinaId?: string;
  temaId?: string;
  nome: string;
  total: number;
  erros: number;
  taxaErro: number;
}

/** GET /estatisticas/desempenho-questoes — `data` presente só com agruparPor. */
export interface DesempenhoQuestoesAgregado {
  total: number;
  erros: number;
  taxaErro: number;
  data?: DesempenhoGrupo[];
}

/** `from`/`to` são dias de calendário (YYYY-MM-DD), ambos inclusivos. */
export interface PeriodoParams {
  from?: string;
  to?: string;
}

export interface SerieTemporalParams extends PeriodoParams {
  granularidade?: Granularidade;
}
