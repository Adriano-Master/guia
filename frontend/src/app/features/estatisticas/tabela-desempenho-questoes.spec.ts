import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import type { DesempenhoGrupo, DesempenhoQuestoesAgregado } from './estatisticas.models';
import { EstatisticasService } from './estatisticas.service';
import { TabelaDesempenhoQuestoes } from './tabela-desempenho-questoes';

/**
 * Tabela de desempenho em questões (CA-05): agrupamento por disciplina
 * (default) ou tema refazendo a busca, taxa em percentual com 1 casa,
 * linha de total agregado e estado vazio quando total=0.
 */

function grupo(overrides: Partial<DesempenhoGrupo> & { nome: string }): DesempenhoGrupo {
  const total = overrides.total ?? 0;
  const erros = overrides.erros ?? 0;
  return { taxaErro: total > 0 ? erros / total : 0, ...overrides, total, erros };
}

function buildAgregado(data?: DesempenhoGrupo[]): DesempenhoQuestoesAgregado {
  const total = data?.reduce((soma, g) => soma + g.total, 0) ?? 0;
  const erros = data?.reduce((soma, g) => soma + g.erros, 0) ?? 0;
  return { total, erros, taxaErro: total > 0 ? erros / total : 0, data };
}

interface ServiceMock {
  desempenhoQuestoes: ReturnType<typeof vi.fn>;
}

function buildMock(
  res: DesempenhoQuestoesAgregado = buildAgregado([
    grupo({ disciplinaId: 'd1', nome: 'Português', total: 100, erros: 25 }),
    grupo({ disciplinaId: 'd2', nome: 'Direito', total: 40, erros: 10 }),
  ]),
): ServiceMock {
  return { desempenhoQuestoes: vi.fn(() => of(res)) };
}

async function createFixture(
  mock: ServiceMock,
): Promise<ComponentFixture<TabelaDesempenhoQuestoes>> {
  TestBed.configureTestingModule({
    imports: [TabelaDesempenhoQuestoes],
    providers: [{ provide: EstatisticasService, useValue: mock }],
  });
  const fixture = TestBed.createComponent(TabelaDesempenhoQuestoes);
  await fixture.whenStable();
  return fixture;
}

function el(fixture: ComponentFixture<TabelaDesempenhoQuestoes>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function linhas(fixture: ComponentFixture<TabelaDesempenhoQuestoes>): string[][] {
  return Array.from(el(fixture).querySelectorAll('tbody tr')).map((tr) =>
    Array.from(tr.querySelectorAll('td')).map((td) => td.textContent?.trim() ?? ''),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TabelaDesempenhoQuestoes', () => {
  it('boot agrupa por disciplina e lista nome/total/erros/taxa com 1 casa', async () => {
    const mock = buildMock();
    const fixture = await createFixture(mock);

    expect(mock.desempenhoQuestoes).toHaveBeenCalledExactlyOnceWith('disciplina');
    expect(el(fixture).querySelector('thead th')?.textContent?.trim()).toBe('Disciplina');
    expect(linhas(fixture)).toEqual([
      ['Português', '100', '25', '25%'],
      ['Direito', '40', '10', '25%'],
    ]);
  });

  it('taxa fracionária vira percentual com 1 casa (0.2534 → 25.3%)', async () => {
    const fixture = await createFixture(
      buildMock({
        total: 100,
        erros: 25,
        taxaErro: 0.2534,
        data: [
          grupo({ disciplinaId: 'd1', nome: 'Português', total: 100, erros: 25, taxaErro: 0.2534 }),
        ],
      }),
    );

    expect(linhas(fixture)[0][3]).toBe('25.3%');
  });

  it('linha de total agrega o resumo do response', async () => {
    const fixture = await createFixture(buildMock());

    const total = Array.from(el(fixture).querySelectorAll('.tdq__total th, .tdq__total td')).map(
      (celula) => celula.textContent?.trim(),
    );
    expect(total).toEqual(['Total', '140', '35', '25%']);
  });

  it('trocar o agrupamento para tema refaz a busca e muda o cabeçalho', async () => {
    const mock = buildMock();
    const fixture = await createFixture(mock);

    mock.desempenhoQuestoes.mockReturnValueOnce(
      of(buildAgregado([grupo({ temaId: 't1', nome: 'Sintaxe', total: 30, erros: 6 })])),
    );

    const select = el(fixture).querySelector<HTMLSelectElement>('#tdq-agrupar')!;
    select.value = 'tema';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(mock.desempenhoQuestoes).toHaveBeenLastCalledWith('tema');
    expect(el(fixture).querySelector('thead th')?.textContent?.trim()).toBe('Tema');
    expect(linhas(fixture)).toEqual([['Sintaxe', '30', '6', '20%']]);
  });

  it('estado vazio quando total=0 (CA-05: taxa 0, sem tabela)', async () => {
    const fixture = await createFixture(buildMock(buildAgregado([])));

    expect(el(fixture).querySelector('table')).toBeNull();
    expect(el(fixture).textContent).toContain('Nenhuma questão registrada ainda.');
  });
});
