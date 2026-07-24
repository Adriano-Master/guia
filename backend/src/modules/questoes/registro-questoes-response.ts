import { RegistroQuestoes } from '@prisma/client';

/**
 * Taxa de erro DERIVADA (RN-3/D-1): nunca persistida, calculada em toda
 * leitura. Arredondada a 4 casas decimais — precisão de sobra para percentuais
 * exibidos (0,01%) sem vazar ruído de ponto flutuante (ex.: 1/3 → 0.3333).
 * Divisão segura (D-5): total 0 → taxa 0 (na prática total ≥ 1 no registro).
 */
export function taxaErro(erros: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Math.round((erros / total) * 10_000) / 10_000;
}

/**
 * `data` é DATE puro (sem hora/TZ): o Prisma a materializa como Date em
 * 00:00Z, então o recorte UTC do ISO devolve o dia de calendário exato —
 * nunca serializar com o TZ local (off-by-one).
 */
export function toDataISO(data: Date): string {
  return data.toISOString().slice(0, 10);
}

export interface RegistroQuestoesResponse {
  id: string;
  alunoId: string;
  temaId: string;
  /** Extensão ao contrato do design: poupa o frontend de resolver nomes. */
  temaNome: string;
  subtemaId: string | null;
  subtemaNome: string | null;
  /** Dia de calendário "YYYY-MM-DD" (campo DATE, não timestamptz). */
  data: string;
  total: number;
  erros: number;
  taxaErro: number;
  createdAt: string;
  updatedAt: string;
}

export type RegistroQuestoesWithRefs = RegistroQuestoes & {
  tema: { nome: string };
  subtema: { nome: string } | null;
};

export function toRegistroQuestoesResponse(
  registro: RegistroQuestoesWithRefs,
): RegistroQuestoesResponse {
  return {
    id: registro.id,
    alunoId: registro.alunoId,
    temaId: registro.temaId,
    temaNome: registro.tema.nome,
    subtemaId: registro.subtemaId,
    subtemaNome: registro.subtema?.nome ?? null,
    data: toDataISO(registro.data),
    total: registro.total,
    erros: registro.erros,
    taxaErro: taxaErro(registro.erros, registro.total),
    createdAt: registro.createdAt.toISOString(),
    updatedAt: registro.updatedAt.toISOString(),
  };
}

export interface DesempenhoTemaItem {
  temaId: string;
  /** Extensão ao contrato do design: poupa o frontend de resolver nomes. */
  temaNome: string;
  totalQuestoes: number;
  totalErros: number;
  taxaErro: number;
}

export interface DesempenhoResponse {
  data: DesempenhoTemaItem[];
  /** Período efetivo aplicado (ecoa o default de 30 dias quando omitido). */
  from: string;
  to: string;
}
