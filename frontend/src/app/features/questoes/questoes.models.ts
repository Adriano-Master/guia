/** Espelha RegistroQuestoesResponse do backend (envelope { registro } já desembrulhado). */
export interface RegistroQuestoes {
  id: string;
  alunoId: string;
  temaId: string;
  subtemaId: string | null;
  /** Dia de calendário "YYYY-MM-DD" (campo DATE, não timestamptz). */
  data: string;
  total: number;
  erros: number;
  /** Derivada (RN-3): erros/total em 0..1, calculada pelo backend em toda leitura. */
  taxaErro: number;
  /**
   * Nomes resolvidos pelo backend (fonte primária de exibição). Opcionais por
   * tolerância enquanto o contrato é implantado — a UI cai para as árvores de
   * planos carregadas e, por fim, para "—".
   */
  temaNome?: string;
  subtemaNome?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRegistroInput {
  temaId: string;
  subtemaId?: string;
  data: string;
  total: number;
  erros: number;
}

/** `subtemaId: null` explícito desvincula o subtema; ausente preserva. */
export interface UpdateRegistroInput {
  total?: number;
  erros?: number;
  subtemaId?: string | null;
  data?: string;
}

/**
 * `from`/`to` são dias de calendário (YYYY-MM-DD), AMBOS inclusivos —
 * diferente de sessões (timestamptz com `to` exclusivo).
 */
export interface QuestoesListParams {
  page?: number;
  pageSize?: number;
  sort?: string;
  temaId?: string;
  subtemaId?: string;
  from?: string;
  to?: string;
}

export interface DesempenhoTema {
  temaId: string;
  temaNome: string;
  totalQuestoes: number;
  totalErros: number;
  taxaErro: number;
}

export interface DesempenhoParams {
  temaId?: string;
  from?: string;
  to?: string;
}

export interface Desempenho {
  data: DesempenhoTema[];
  /** Período efetivo aplicado (ecoa o default de 30 dias quando omitido). */
  from: string;
  to: string;
}

/** YYYY-MM-DD da data local do aluno (mesmo helper do registro manual de sessões). */
export function hojeLocal(): string {
  const hoje = new Date();
  const mes = String(hoje.getMonth() + 1).padStart(2, '0');
  const dia = String(hoje.getDate()).padStart(2, '0');
  return `${hoje.getFullYear()}-${mes}-${dia}`;
}
