import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';

import type { Paginated } from '../../core/auth/auth.models';
import type { RankingEntry } from './gamificacao.models';
import { RankingLista } from './ranking-lista';

/**
 * Lista do ranking: linhas como .card--flat, pódio (top 3) destacado sem
 * depender só de cor (número da posição sempre visível), badge "Você" na
 * linha do próprio aluno e paginação no padrão do app.
 */

function buildEntry(posicao: number, overrides: Partial<RankingEntry> = {}): RankingEntry {
  return {
    posicao,
    alunoId: `a${posicao}`,
    nome: `Aluno ${posicao}`,
    pontos: 1000 - posicao * 10,
    subtemasConcluidos: 20,
    horasEstudadas: 12.5,
    ...overrides,
  };
}

function buildResult(overrides: Partial<Paginated<RankingEntry>> = {}): Paginated<RankingEntry> {
  return {
    data: [buildEntry(1), buildEntry(2), buildEntry(3), buildEntry(4)],
    page: 1,
    pageSize: 20,
    total: 4,
    ...overrides,
  };
}

async function createFixture(
  result: Paginated<RankingEntry>,
  meuAlunoId: string | null = null,
): Promise<ComponentFixture<RankingLista>> {
  TestBed.configureTestingModule({ imports: [RankingLista] });
  const fixture = TestBed.createComponent(RankingLista);
  fixture.componentRef.setInput('result', result);
  fixture.componentRef.setInput('meuAlunoId', meuAlunoId);
  await fixture.whenStable();
  return fixture;
}

function el(fixture: ComponentFixture<RankingLista>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function itens(fixture: ComponentFixture<RankingLista>): HTMLElement[] {
  return Array.from(el(fixture).querySelectorAll<HTMLElement>('.rlista__item'));
}

describe('RankingLista — linhas e pódio', () => {
  it('renderiza cada linha como card--flat com posição, nome, detalhe e pontos', async () => {
    const fixture = await createFixture(buildResult());

    const linhas = itens(fixture);
    expect(linhas).toHaveLength(4);
    for (const linha of linhas) {
      expect(linha.classList).toContain('card--flat');
    }
    expect(linhas[0].querySelector('.rlista__posicao')?.textContent?.trim()).toBe('1º');
    expect(linhas[3].querySelector('.rlista__posicao')?.textContent?.trim()).toBe('4º');
    expect(linhas[0].textContent).toContain('Aluno 1');
    expect(linhas[0].textContent).toContain('20 subtemas');
    expect(linhas[0].textContent).toContain('12.5 h');
    expect(linhas[0].querySelector('.rlista__pontos')?.textContent?.trim()).toBe('990 pts');
  });

  it('destaca só as posições 1–3 como pódio, mantendo o número em todas', async () => {
    const fixture = await createFixture(buildResult());

    const linhas = itens(fixture);
    expect(linhas[0].classList).toContain('rlista__item--podio');
    expect(linhas[1].classList).toContain('rlista__item--podio');
    expect(linhas[2].classList).toContain('rlista__item--podio');
    expect(linhas[3].classList).not.toContain('rlista__item--podio');
    // identidade nunca só por cor: toda linha exibe o número da posição
    for (const linha of linhas) {
      expect(linha.querySelector('.rlista__posicao')?.textContent?.trim()).toMatch(/^\d+º$/);
    }
  });

  it('em páginas seguintes ninguém é pódio (posição vem do backend)', async () => {
    const fixture = await createFixture(
      buildResult({ data: [buildEntry(21), buildEntry(22)], page: 2, total: 25 }),
    );

    for (const linha of itens(fixture)) {
      expect(linha.classList).not.toContain('rlista__item--podio');
    }
    expect(itens(fixture)[0].querySelector('.rlista__posicao')?.textContent?.trim()).toBe('21º');
  });
});

describe('RankingLista — destaque do próprio aluno', () => {
  it('marca a linha do aluno com badge "Você" além do destaque visual', async () => {
    const fixture = await createFixture(buildResult(), 'a2');

    const linhas = itens(fixture);
    expect(linhas[1].classList).toContain('rlista__item--me');
    expect(linhas[1].querySelector('.rlista__voce')?.textContent?.trim()).toBe('Você');
    expect(linhas[0].classList).not.toContain('rlista__item--me');
    expect(linhas[0].querySelector('.rlista__voce')).toBeNull();
  });

  it('sem meuAlunoId (professor) nenhuma linha ganha o badge', async () => {
    const fixture = await createFixture(buildResult(), null);

    expect(el(fixture).querySelector('.rlista__voce')).toBeNull();
    expect(el(fixture).querySelector('.rlista__item--me')).toBeNull();
  });
});

describe('RankingLista — paginação', () => {
  it('uma página só: sem controles de paginação', async () => {
    const fixture = await createFixture(buildResult());

    expect(el(fixture).querySelector('.rlista__pagination')).toBeNull();
  });

  it('múltiplas páginas: mostra contadores e emite pageChange nos botões', async () => {
    const fixture = await createFixture(buildResult({ page: 2, total: 45 }));
    const emitted: number[] = [];
    fixture.componentInstance.pageChange.subscribe((p) => emitted.push(p));

    const paginacao = el(fixture).querySelector('.rlista__pagination')!;
    expect(paginacao.textContent).toContain('Página 2 de 3 · 45 alunos');

    const [anterior, proxima] = Array.from(paginacao.querySelectorAll('button'));
    expect(anterior.disabled).toBe(false);
    expect(proxima.disabled).toBe(false);
    anterior.click();
    proxima.click();
    expect(emitted).toEqual([1, 3]);
  });

  it('desabilita Anterior na primeira página e Próxima na última', async () => {
    const primeira = await createFixture(buildResult({ page: 1, total: 45 }));
    const [anterior1, proxima1] = Array.from(
      el(primeira).querySelectorAll<HTMLButtonElement>('.rlista__pagination button'),
    );
    expect(anterior1.disabled).toBe(true);
    expect(proxima1.disabled).toBe(false);

    TestBed.resetTestingModule();
    const ultima = await createFixture(buildResult({ page: 3, total: 45 }));
    const [anterior2, proxima2] = Array.from(
      el(ultima).querySelectorAll<HTMLButtonElement>('.rlista__pagination button'),
    );
    expect(anterior2.disabled).toBe(false);
    expect(proxima2.disabled).toBe(true);
  });
});
