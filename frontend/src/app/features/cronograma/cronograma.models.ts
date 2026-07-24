export type BlocoStatus = 'PLANEJADO' | 'CONCLUIDO' | 'PULADO';

export const GRANULARIDADES = [15, 30, 60] as const;
export type Granularidade = (typeof GRANULARIDADES)[number];

export interface Janela {
  /** Dia da semana: 0 (domingo) a 6 (sábado). */
  dia: number;
  /** Horário local no formato HH:mm. */
  inicio: string;
  fim: string;
}

export interface Bloco {
  id: string;
  cronogramaId: string;
  disciplinaId: string;
  subtemaId: string | null;
  /** ISO-8601 UTC. */
  inicio: string;
  fim: string;
  duracaoMin: number;
  status: BlocoStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Cronograma {
  id: string;
  alunoId: string;
  planoId: string;
  diasSemana: number[];
  janelas: Janela[];
  horasSemanaTotal: number;
  granularidadeMin: number;
  timezone: string;
  ativo: boolean;
  geradoEm: string;
  createdAt: string;
  updatedAt: string;
  blocos?: Bloco[];
}

export interface GerarCronogramaInput {
  planoId: string;
  diasSemana: number[];
  janelas: Janela[];
  granularidadeMin?: number;
  timezone: string;
}
