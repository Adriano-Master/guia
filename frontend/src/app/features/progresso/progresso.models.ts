/** Espelha os contratos de backend/src/modules/progresso/progresso-response.ts. */

export interface ProgressoMarcacao {
  subtemaId: string;
  concluido: boolean;
  /** ISO-8601 UTC. */
  concluidoEm: string | null;
}

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

export interface ProgressoPlano {
  planoId: string;
  progressoPercentual: number;
  subtemasConcluidos: number;
  subtemasTotais: number;
  disciplinas: ProgressoDisciplinaNode[];
}

export interface ProgressoSubtemaFlat {
  subtemaId: string;
  nome: string;
  ordem: number;
  temaId: string;
  disciplinaId: string;
  concluido: boolean;
  concluidoEm: string | null;
}

export interface ProgressoSubtemasListParams {
  planoId: string;
  temaId?: string;
  concluido?: boolean;
}

/** Mesma regra do backend: total = 0 → 0% (CA-07); 2 casas (half-up). */
export function percentual(concluidos: number, totais: number): number {
  if (totais === 0) return 0;
  return Math.round((concluidos / totais) * 100 * 100) / 100;
}

/**
 * Recalcula os agregados de tema/disciplina/plano a partir das folhas
 * (contagem de subtemas, nunca média de médias — DT-02). Usado na atualização
 * otimista para manter a árvore consistente sem nova chamada ao backend.
 */
export function recalcularAgregados(plano: ProgressoPlano): ProgressoPlano {
  let planoConcluidos = 0;
  let planoTotais = 0;
  const disciplinas = plano.disciplinas.map((disciplina) => {
    let discConcluidos = 0;
    let discTotais = 0;
    const temas = disciplina.temas.map((tema) => {
      const totais = tema.subtemas.length;
      const concluidos = tema.subtemas.filter((s) => s.concluido).length;
      discConcluidos += concluidos;
      discTotais += totais;
      return { ...tema, concluidos, totais, progressoPercentual: percentual(concluidos, totais) };
    });
    planoConcluidos += discConcluidos;
    planoTotais += discTotais;
    return {
      ...disciplina,
      temas,
      concluidos: discConcluidos,
      totais: discTotais,
      progressoPercentual: percentual(discConcluidos, discTotais),
    };
  });
  return {
    ...plano,
    disciplinas,
    subtemasConcluidos: planoConcluidos,
    subtemasTotais: planoTotais,
    progressoPercentual: percentual(planoConcluidos, planoTotais),
  };
}

/** Aplica o estado de um subtema (imutável) e recalcula os agregados. */
export function comSubtema(
  plano: ProgressoPlano,
  subtemaId: string,
  patch: { concluido: boolean; concluidoEm: string | null },
): ProgressoPlano {
  return recalcularAgregados({
    ...plano,
    disciplinas: plano.disciplinas.map((disciplina) => ({
      ...disciplina,
      temas: disciplina.temas.map((tema) => ({
        ...tema,
        subtemas: tema.subtemas.map((subtema) =>
          subtema.subtemaId === subtemaId ? { ...subtema, ...patch } : subtema,
        ),
      })),
    })),
  });
}
