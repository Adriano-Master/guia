import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';

import type { MinhaPontuacao } from './gamificacao.models';
import { MinhaPontuacaoCard } from './minha-pontuacao-card';

/**
 * Card "Minha pontuação" (US-03): total em pontos inteiros, posição global e
 * composição (subtemas, horas, bônus de consistência) sempre em texto.
 */

function buildMe(overrides: Partial<MinhaPontuacao> = {}): MinhaPontuacao {
  return {
    posicaoGlobal: 12,
    pontos: 700,
    subtemasConcluidos: 30,
    horasEstudadas: 40.5,
    semanasConsistentes: 4,
    composicao: { pontosSubtemas: 300, pontosHoras: 200, pontosBonus: 200 },
    turmas: [],
    ...overrides,
  };
}

async function createFixture(me: MinhaPontuacao): Promise<ComponentFixture<MinhaPontuacaoCard>> {
  TestBed.configureTestingModule({ imports: [MinhaPontuacaoCard] });
  const fixture = TestBed.createComponent(MinhaPontuacaoCard);
  fixture.componentRef.setInput('me', me);
  await fixture.whenStable();
  return fixture;
}

function el(fixture: ComponentFixture<MinhaPontuacaoCard>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

/** textContent com o whitespace do template colapsado (interpolações em linhas próprias). */
function texto(fixture: ComponentFixture<MinhaPontuacaoCard>): string {
  return (el(fixture).textContent ?? '').replace(/\s+/g, ' ');
}

describe('MinhaPontuacaoCard', () => {
  it('exibe o total de pontos (inteiro) e a posição global', async () => {
    const fixture = await createFixture(buildMe());

    expect(el(fixture).querySelector('.mpont__hero')?.textContent?.trim()).toBe('700 pts');
    expect(texto(fixture)).toContain('Posição global: 12º');
  });

  it('posicaoGlobal null (aluno fora do ranking): mostra "—" no lugar da posição', async () => {
    const fixture = await createFixture(buildMe({ posicaoGlobal: null }));

    expect(texto(fixture)).toContain('Posição global: —');
    expect(texto(fixture)).not.toContain('º');
  });

  it('detalha a composição: subtemas, horas (1 casa) e bônus de consistência', async () => {
    const fixture = await createFixture(buildMe());

    const conteudo = texto(fixture);
    expect(conteudo).toContain('Subtemas concluídos');
    expect(conteudo).toContain('30 subtemas');
    expect(conteudo).toContain('Horas de estudo');
    expect(conteudo).toContain('40.5 h');
    expect(conteudo).toContain('Bônus de consistência');
    expect(conteudo).toContain('4 semanas consistentes');

    const parcelas = Array.from(el(fixture).querySelectorAll('.mpont__pts')).map((p) =>
      p.textContent?.trim(),
    );
    expect(parcelas).toEqual(['300 pts', '200 pts', '200 pts']);
  });

  it('usa o singular para uma única semana consistente', async () => {
    const fixture = await createFixture(buildMe({ semanasConsistentes: 1 }));

    expect(texto(fixture)).toContain('1 semana consistente');
    expect(texto(fixture)).not.toContain('semanas consistentes');
  });
});
