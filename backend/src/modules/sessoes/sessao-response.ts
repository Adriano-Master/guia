import { SessaoEstudo, SessaoOrigem } from '@prisma/client';

/**
 * Estado lógico do cronômetro (design: máquina de estados). Não é coluna do
 * banco: STOPPED deriva de `fim ≠ null`; RUNNING/PAUSED vêm do registro de
 * pausa em memória do service (D-3).
 */
export type SessaoEstado = 'RUNNING' | 'PAUSED' | 'STOPPED';

export interface SessaoResponse {
  id: string;
  alunoId: string;
  disciplinaId: string;
  subtemaId: string | null;
  blocoId: string | null;
  origem: SessaoOrigem;
  inicio: string;
  fim: string | null;
  duracaoMin: number;
  estado: SessaoEstado;
  createdAt: string;
  updatedAt: string;
}

export function toSessaoResponse(
  sessao: SessaoEstudo,
  estadoAtivo: 'RUNNING' | 'PAUSED' = 'RUNNING',
): SessaoResponse {
  return {
    id: sessao.id,
    alunoId: sessao.alunoId,
    disciplinaId: sessao.disciplinaId,
    subtemaId: sessao.subtemaId,
    blocoId: sessao.blocoId,
    origem: sessao.origem,
    inicio: sessao.inicio.toISOString(),
    fim: sessao.fim ? sessao.fim.toISOString() : null,
    duracaoMin: sessao.duracaoMin,
    estado: sessao.fim !== null ? 'STOPPED' : estadoAtivo,
    createdAt: sessao.createdAt.toISOString(),
    updatedAt: sessao.updatedAt.toISOString(),
  };
}
