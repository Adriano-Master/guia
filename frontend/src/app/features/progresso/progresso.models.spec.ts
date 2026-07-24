import type {
  ProgressoDisciplinaNode,
  ProgressoPlano,
  ProgressoSubtemaNode,
  ProgressoTemaNode,
} from './progresso.models';
import { comSubtema, percentual, recalcularAgregados } from './progresso.models';

/**
 * Funções puras de progresso (mesma regra do backend): percentual com guarda
 * de divisão por zero (CA-07) e 2 casas half-up; agregação por CONTAGEM de
 * folhas (nunca média de médias — DT-02); comSubtema aplica patch imutável
 * e recalcula tema → disciplina → plano.
 */

const QUANDO = '2026-01-05T10:00:00.000Z';

function subtema(id: string, concluido = false, concluidoEm: string | null = null) {
  return { subtemaId: id, nome: `Subtema ${id}`, ordem: 1, concluido, concluidoEm };
}

function tema(id: string, subtemas: ProgressoSubtemaNode[]): ProgressoTemaNode {
  const totais = subtemas.length;
  const concluidos = subtemas.filter((s) => s.concluido).length;
  return {
    temaId: id,
    nome: `Tema ${id}`,
    ordem: 1,
    subtemas,
    concluidos,
    totais,
    progressoPercentual: percentual(concluidos, totais),
  };
}

function disciplina(id: string, temas: ProgressoTemaNode[]): ProgressoDisciplinaNode {
  const totais = temas.reduce((acc, t) => acc + t.totais, 0);
  const concluidos = temas.reduce((acc, t) => acc + t.concluidos, 0);
  return {
    disciplinaId: id,
    nome: `Disciplina ${id}`,
    ordem: 1,
    temas,
    concluidos,
    totais,
    progressoPercentual: percentual(concluidos, totais),
  };
}

function plano(disciplinas: ProgressoDisciplinaNode[]): ProgressoPlano {
  const subtemasTotais = disciplinas.reduce((acc, d) => acc + d.totais, 0);
  const subtemasConcluidos = disciplinas.reduce((acc, d) => acc + d.concluidos, 0);
  return {
    planoId: 'plano-1',
    disciplinas,
    subtemasConcluidos,
    subtemasTotais,
    progressoPercentual: percentual(subtemasConcluidos, subtemasTotais),
  };
}

/** Exemplo canônico: tema A com 1 subtema concluído + tema B com 3 pendentes. */
function planoCanonico(): ProgressoPlano {
  return plano([
    disciplina('d1', [
      tema('a', [subtema('a1', true, QUANDO)]),
      tema('b', [subtema('b1'), subtema('b2'), subtema('b3')]),
    ]),
  ]);
}

describe('percentual', () => {
  it('total = 0 → 0 (guarda de divisão por zero, CA-07)', () => {
    expect(percentual(0, 0)).toBe(0);
    expect(percentual(5, 0)).toBe(0);
  });

  it('2/3 → 66.67 (2 casas)', () => {
    expect(percentual(2, 3)).toBe(66.67);
  });

  it('arredonda half-up na 2ª casa (1/32 = 3.125% → 3.13)', () => {
    expect(percentual(1, 32)).toBe(3.13);
  });

  it('casos exatos: 0%, 25%, 100%', () => {
    expect(percentual(0, 3)).toBe(0);
    expect(percentual(1, 4)).toBe(25);
    expect(percentual(5, 5)).toBe(100);
  });

  it('1/3 → 33.33 (trunca meio-para-baixo corretamente)', () => {
    expect(percentual(1, 3)).toBe(33.33);
  });
});

describe('recalcularAgregados', () => {
  it('exemplo canônico: disciplina = 25% por contagem de folhas, NÃO 50% (média de médias)', () => {
    const resultado = recalcularAgregados(planoCanonico());

    const [d1] = resultado.disciplinas;
    const [temaA, temaB] = d1.temas;

    expect(temaA.progressoPercentual).toBe(100);
    expect(temaB.progressoPercentual).toBe(0);
    // (100 + 0) / 2 daria 50; o correto é 1/4 = 25
    expect(d1.progressoPercentual).toBe(25);
    expect(d1.concluidos).toBe(1);
    expect(d1.totais).toBe(4);

    expect(resultado.progressoPercentual).toBe(25);
    expect(resultado.subtemasConcluidos).toBe(1);
    expect(resultado.subtemasTotais).toBe(4);
  });

  it('corrige agregados inconsistentes vindos de fora (recalcula das folhas)', () => {
    const inconsistente = planoCanonico();
    inconsistente.progressoPercentual = 99;
    inconsistente.disciplinas[0].concluidos = 42;
    inconsistente.disciplinas[0].temas[1].progressoPercentual = 77;

    const resultado = recalcularAgregados(inconsistente);

    expect(resultado.progressoPercentual).toBe(25);
    expect(resultado.disciplinas[0].concluidos).toBe(1);
    expect(resultado.disciplinas[0].temas[1].progressoPercentual).toBe(0);
  });

  it('plano soma contagens entre disciplinas (2 disciplinas: 1/4 e 2/2 → 3/6 = 50%)', () => {
    const resultado = recalcularAgregados(
      plano([
        disciplina('d1', [
          tema('a', [subtema('a1', true, QUANDO)]),
          tema('b', [subtema('b1'), subtema('b2'), subtema('b3')]),
        ]),
        disciplina('d2', [tema('c', [subtema('c1', true, QUANDO), subtema('c2', true, QUANDO)])]),
      ]),
    );

    expect(resultado.disciplinas[0].progressoPercentual).toBe(25);
    expect(resultado.disciplinas[1].progressoPercentual).toBe(100);
    expect(resultado.progressoPercentual).toBe(50);
    expect(resultado.subtemasConcluidos).toBe(3);
    expect(resultado.subtemasTotais).toBe(6);
  });

  it('tema sem subtemas → 0% sem NaN; plano vazio → 0%', () => {
    const resultado = recalcularAgregados(plano([disciplina('d1', [tema('a', [])])]));

    expect(resultado.disciplinas[0].temas[0].progressoPercentual).toBe(0);
    expect(resultado.disciplinas[0].progressoPercentual).toBe(0);
    expect(resultado.progressoPercentual).toBe(0);

    const vazio = recalcularAgregados(plano([]));
    expect(vazio.progressoPercentual).toBe(0);
    expect(vazio.subtemasTotais).toBe(0);
  });
});

describe('comSubtema', () => {
  it('marcar: aplica concluido + concluidoEm no alvo e recalcula os agregados', () => {
    const original = planoCanonico();

    const resultado = comSubtema(original, 'b1', { concluido: true, concluidoEm: QUANDO });

    const temaB = resultado.disciplinas[0].temas[1];
    const b1 = temaB.subtemas.find((s) => s.subtemaId === 'b1')!;
    expect(b1.concluido).toBe(true);
    expect(b1.concluidoEm).toBe(QUANDO);
    expect(temaB.progressoPercentual).toBe(33.33);
    expect(resultado.disciplinas[0].progressoPercentual).toBe(50);
    expect(resultado.progressoPercentual).toBe(50);
  });

  it('desmarcar: zera concluidoEm e os agregados caem', () => {
    const resultado = comSubtema(planoCanonico(), 'a1', { concluido: false, concluidoEm: null });

    const a1 = resultado.disciplinas[0].temas[0].subtemas[0];
    expect(a1.concluido).toBe(false);
    expect(a1.concluidoEm).toBeNull();
    expect(resultado.disciplinas[0].temas[0].progressoPercentual).toBe(0);
    expect(resultado.progressoPercentual).toBe(0);
    expect(resultado.subtemasConcluidos).toBe(0);
  });

  it('não altera os demais subtemas e é imutável (original intacto)', () => {
    const original = planoCanonico();

    const resultado = comSubtema(original, 'b1', { concluido: true, concluidoEm: QUANDO });

    // original não muda (atualização otimista precisa poder reverter)
    expect(original.progressoPercentual).toBe(25);
    expect(original.disciplinas[0].temas[1].subtemas[0].concluido).toBe(false);
    expect(resultado).not.toBe(original);
    // demais folhas preservadas
    expect(resultado.disciplinas[0].temas[0].subtemas[0]).toEqual(
      original.disciplinas[0].temas[0].subtemas[0],
    );
    expect(resultado.disciplinas[0].temas[1].subtemas[1].concluido).toBe(false);
  });

  it('subtemaId inexistente → árvore com agregados iguais (nenhuma folha muda)', () => {
    const resultado = comSubtema(planoCanonico(), 'nao-existe', {
      concluido: true,
      concluidoEm: QUANDO,
    });

    expect(resultado.progressoPercentual).toBe(25);
    expect(resultado.subtemasConcluidos).toBe(1);
  });
});
