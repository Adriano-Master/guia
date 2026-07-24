import { BlocoCronograma, BlocoStatus, Cronograma } from '@prisma/client';

export interface JanelaResponse {
  dia: number;
  inicio: string;
  fim: string;
}

export interface BlocoResponse {
  id: string;
  cronogramaId: string;
  disciplinaId: string;
  subtemaId: string | null;
  inicio: string;
  fim: string;
  duracaoMin: number;
  status: BlocoStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CronogramaResponse {
  id: string;
  alunoId: string;
  planoId: string;
  diasSemana: number[];
  janelas: JanelaResponse[];
  horasSemanaTotal: number;
  granularidadeMin: number;
  timezone: string;
  ativo: boolean;
  geradoEm: string;
  createdAt: string;
  updatedAt: string;
  blocos?: BlocoResponse[];
}

export type CronogramaWithBlocos = Cronograma & { blocos?: BlocoCronograma[] };

export function toBlocoResponse(bloco: BlocoCronograma): BlocoResponse {
  return {
    id: bloco.id,
    cronogramaId: bloco.cronogramaId,
    disciplinaId: bloco.disciplinaId,
    subtemaId: bloco.subtemaId,
    inicio: bloco.inicio.toISOString(),
    fim: bloco.fim.toISOString(),
    duracaoMin: bloco.duracaoMin,
    status: bloco.status,
    createdAt: bloco.createdAt.toISOString(),
    updatedAt: bloco.updatedAt.toISOString(),
  };
}

/** horasSemanaTotal sai como number (2 casas); janelas saem como o array informado. */
export function toCronogramaResponse(cronograma: CronogramaWithBlocos): CronogramaResponse {
  return {
    id: cronograma.id,
    alunoId: cronograma.alunoId,
    planoId: cronograma.planoId,
    diasSemana: cronograma.diasSemana,
    janelas: cronograma.janelas as unknown as JanelaResponse[],
    horasSemanaTotal: cronograma.horasSemanaTotal.toNumber(),
    granularidadeMin: cronograma.granularidadeMin,
    timezone: cronograma.timezone,
    ativo: cronograma.ativo,
    geradoEm: cronograma.geradoEm.toISOString(),
    createdAt: cronograma.createdAt.toISOString(),
    updatedAt: cronograma.updatedAt.toISOString(),
    ...(cronograma.blocos ? { blocos: cronograma.blocos.map(toBlocoResponse) } : {}),
  };
}
