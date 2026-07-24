import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';

import { DesempenhoQuestoes } from './desempenho-questoes';
import type { Desempenho, DesempenhoTema } from './questoes.models';
import { QuestoesService } from './questoes.service';

/**
 * Painel de desempenho por tema (US-4, CA-8, CB-3): agregados com taxa %,
 * período efetivo ecoado pelo backend, estado vazio, thresholds de cor
 * 25%/50% (classe/token certo SEMPRE acompanhado do valor em texto) e
 * staleness no filtro de período.
 */

function tema(
  temaId: string,
  temaNome: string,
  totalQuestoes: number,
  totalErros: number,
): DesempenhoTema {
  return { temaId, temaNome, totalQuestoes, totalErros, taxaErro: totalErros / totalQuestoes };
}

function buildDesempenho(data: DesempenhoTema[]): Desempenho {
  return { data, from: '2026-06-07', to: '2026-07-07' };
}

interface ServiceMock {
  desempenho: ReturnType<typeof vi.fn>;
}

function buildMock(res: Desempenho = buildDesempenho([tema('t1', 'Sintaxe', 100, 60)])): ServiceMock {
  return { desempenho: vi.fn(() => of(res)) };
}

async function createFixture(mock: ServiceMock): Promise<ComponentFixture<DesempenhoQuestoes>> {
  TestBed.configureTestingModule({
    imports: [DesempenhoQuestoes],
    providers: [{ provide: QuestoesService, useValue: mock }],
  });
  const fixture = TestBed.createComponent(DesempenhoQuestoes);
  fixture.componentRef.setInput('refresh', 0);
  await fixture.whenStable();
  return fixture;
}

function el(fixture: ComponentFixture<DesempenhoQuestoes>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function itens(fixture: ComponentFixture<DesempenhoQuestoes>): HTMLElement[] {
  return Array.from(el(fixture).querySelectorAll<HTMLElement>('.qdes__item'));
}

async function setPeriodo(
  fixture: ComponentFixture<DesempenhoQuestoes>,
  id: 'qdes-from' | 'qdes-to',
  valor: string,
): Promise<void> {
  const input = el(fixture).querySelector<HTMLInputElement>(`#${id}`)!;
  input.value = valor;
  input.dispatchEvent(new Event('input'));
  await fixture.whenStable();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DesempenhoQuestoes — renderização', () => {
  it('lista temas com taxa %, contagens e o período efetivo do response', async () => {
    const mock = buildMock(
      buildDesempenho([tema('t1', 'Sintaxe', 100, 60), tema('t2', 'Morfologia', 50, 5)]),
    );
    const fixture = await createFixture(mock);

    expect(mock.desempenho).toHaveBeenCalledExactlyOnceWith({ from: undefined, to: undefined });

    // período efetivo ecoado (default de 30 dias aplicado pelo backend)
    expect(el(fixture).querySelector('.qdes__periodo')?.textContent).toContain(
      '07/06/2026 a 07/07/2026',
    );

    const lista = itens(fixture);
    expect(lista).toHaveLength(2);
    expect(lista[0].querySelector('.qdes__tema')?.textContent?.trim()).toBe('Sintaxe');
    expect(lista[0].querySelector('.qdes__taxa')?.textContent?.trim()).toBe('60%');
    expect(lista[0].querySelector('.qdes__contagem')?.textContent).toContain(
      '60 erros em 100 questões',
    );
    expect(lista[1].querySelector('.qdes__taxa')?.textContent?.trim()).toBe('10%');
  });

  it('estado vazio (CB-3): sem registros no período, mantendo o período visível', async () => {
    const fixture = await createFixture(buildMock(buildDesempenho([])));

    expect(el(fixture).textContent).toContain('Nenhuma questão registrada no período.');
    expect(el(fixture).querySelector('.qdes__periodo')?.textContent).toContain('07/06/2026');
    expect(itens(fixture)).toHaveLength(0);
  });
});

describe('DesempenhoQuestoes — thresholds de cor (25% / 50%)', () => {
  it('aplica alta/media/baixa com o valor em texto SEMPRE presente', async () => {
    const fixture = await createFixture(
      buildMock(
        buildDesempenho([
          tema('t1', 'Alta', 100, 60), // 60% → alta
          tema('t2', 'Média', 100, 30), // 30% → media
          tema('t3', 'Baixa', 100, 10), // 10% → baixa
        ]),
      ),
    );

    const lista = itens(fixture);
    const casos: Array<[number, string, string]> = [
      [0, 'alta', '60%'],
      [1, 'media', '30%'],
      [2, 'baixa', '10%'],
    ];
    for (const [i, nivel, texto] of casos) {
      const taxa = lista[i].querySelector('.qdes__taxa')!;
      expect(taxa.classList, `item ${i}`).toContain(`qdes__taxa--${nivel}`);
      // cor nunca é o único canal: o número está no texto
      expect(taxa.textContent?.trim()).toBe(texto);
      expect(lista[i].querySelector('.qdes__bar-fill')!.classList).toContain(
        `qdes__bar-fill--${nivel}`,
      );
    }
  });

  it('fronteiras exatas: 50% é alta e 25% é média (≥, não >)', async () => {
    const fixture = await createFixture(
      buildMock(
        buildDesempenho([
          tema('t1', 'Meio', 100, 50), // exatamente 50% → alta
          tema('t2', 'Quarto', 100, 25), // exatamente 25% → media
          tema('t3', 'Quase', 1000, 249), // 24.9% → baixa
        ]),
      ),
    );

    const lista = itens(fixture);
    expect(lista[0].querySelector('.qdes__taxa')!.classList).toContain('qdes__taxa--alta');
    expect(lista[1].querySelector('.qdes__taxa')!.classList).toContain('qdes__taxa--media');
    expect(lista[2].querySelector('.qdes__taxa')!.classList).toContain('qdes__taxa--baixa');
    expect(lista[2].querySelector('.qdes__taxa')?.textContent?.trim()).toBe('24.9%');
  });
});

describe('DesempenhoQuestoes — filtros de período', () => {
  it('setar from/to refaz a busca com os dias crus', async () => {
    const mock = buildMock();
    const fixture = await createFixture(mock);

    await setPeriodo(fixture, 'qdes-from', '2026-06-01');
    expect(mock.desempenho).toHaveBeenLastCalledWith({ from: '2026-06-01', to: undefined });

    await setPeriodo(fixture, 'qdes-to', '2026-06-30');
    expect(mock.desempenho).toHaveBeenLastCalledWith({ from: '2026-06-01', to: '2026-06-30' });
  });

  it('staleness: resposta atrasada de período antigo é descartada', async () => {
    const mock = buildMock();
    const fixture = await createFixture(mock);

    const antiga$ = new Subject<Desempenho>();
    mock.desempenho.mockReturnValueOnce(antiga$);
    mock.desempenho.mockReturnValueOnce(
      of(buildDesempenho([tema('t9', 'Novo período', 10, 1)])),
    );

    await setPeriodo(fixture, 'qdes-from', '2026-01-01'); // segurada
    expect(el(fixture).textContent).toContain('Carregando desempenho');

    await setPeriodo(fixture, 'qdes-to', '2026-01-31'); // imediata
    expect(el(fixture).textContent).toContain('Novo período');

    antiga$.next(buildDesempenho([tema('t8', 'Período velho', 10, 9)]));
    antiga$.complete();
    await fixture.whenStable();

    expect(el(fixture).textContent).toContain('Novo período');
    expect(el(fixture).textContent).not.toContain('Período velho');
  });

  it('refresh do pai recarrega mantendo os filtros atuais', async () => {
    const mock = buildMock();
    const fixture = await createFixture(mock);
    await setPeriodo(fixture, 'qdes-from', '2026-06-01');

    fixture.componentRef.setInput('refresh', 1);
    await fixture.whenStable();

    expect(mock.desempenho).toHaveBeenLastCalledWith({ from: '2026-06-01', to: undefined });
    expect(mock.desempenho).toHaveBeenCalledTimes(3); // boot + filtro + refresh
  });
});
