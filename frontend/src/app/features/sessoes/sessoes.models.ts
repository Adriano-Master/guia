export type SessaoOrigem = 'CRONOMETRO' | 'MANUAL';

/** Estado lógico do cronômetro (design: máquina de estados). */
export type SessaoEstado = 'RUNNING' | 'PAUSED' | 'STOPPED';

export interface Sessao {
  id: string;
  alunoId: string;
  disciplinaId: string;
  subtemaId: string | null;
  blocoId: string | null;
  origem: SessaoOrigem;
  /** ISO-8601 UTC. */
  inicio: string;
  fim: string | null;
  duracaoMin: number;
  estado: SessaoEstado;
  createdAt: string;
  updatedAt: string;
}

export interface StartCronometroInput {
  disciplinaId: string;
  subtemaId?: string;
  blocoId?: string;
}

export interface ManualSessaoInput {
  disciplinaId: string;
  subtemaId?: string;
  blocoId?: string;
  /** Data local do estudo no formato YYYY-MM-DD. */
  data: string;
  duracaoMin: number;
}

export interface SessoesListParams {
  page?: number;
  pageSize?: number;
  sort?: string;
  disciplinaId?: string;
  /** ISO-8601 UTC; `to` é fronteira exclusiva sobre `inicio`. */
  from?: string;
  to?: string;
}

export interface UpdateSessaoInput {
  duracaoMin?: number;
  subtemaId?: string;
}

/** Pré-preenchimento do cronômetro vindo do calendário (US-7). */
export interface CronometroPrefill {
  disciplinaId?: string;
  subtemaId?: string;
  blocoId?: string;
  /** Plano do cronograma (deep-link /sessoes?planoId=… seleciona o plano). */
  planoId?: string;
}
