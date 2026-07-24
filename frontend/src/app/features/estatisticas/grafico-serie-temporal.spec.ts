import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';

import type { PontoSerie, SerieTemporal } from './estatisticas.models';
import { EstatisticasService } from './estatisticas.service';
import { GraficoSerieTemporal } from './grafico-serie-temporal';

/**
 * Série temporal de horas (CA-04): busca com granularidade dia por default,
 * toggle dia/semana e from/to refazendo a busca, linha única contínua
 * (buckets zerados incluídos), tooltip por ponto via <title>, alternativa
 * textual no aria-label e staleness de respostas atrasadas.
 */

function buildSerie(data: PontoSerie[], granularidade: 'dia' | 'semana' = 'dia'): SerieTemporal {
  return {
    granularidade,
    from: data[0]?.bucket ?? '2026-07-01',
    to: data.at(-1)?.bucket ?? '2026-07-03',
    timezone: 'America/Sao_Paulo',
    data,
  };
}

const SERIE_PADRAO = buildSerie([
  { bucket: '2026-07-01', horas: 2 },
  { bucket: '2026-07-02', horas: 0 },
  { bucket: '2026-07-03', horas: 1.5 },
]);

interface ServiceMock {
  serieTemporal: ReturnType<typeof vi.fn>;
}

function buildMock(res: SerieTemporal = SERIE_PADRAO): ServiceMock {
  return { serieTemporal: vi.fn(() => of(res)) };
}

async function createFixture(mock: ServiceMock): Promise<ComponentFixture<GraficoSerieTemporal>> {
  TestBed.configureTestingModule({
    imports: [GraficoSerieTemporal],
    providers: [{ provide: EstatisticasService, useValue: mock }],
  });
  const fixture = TestBed.createComponent(GraficoSerieTemporal);
  await fixture.whenStable();
  return fixture;
}

function el(fixture: ComponentFixture<GraficoSerieTemporal>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GraficoSerieTemporal — carga e filtros', () => {
  it('boot busca com granularidade=dia e sem from/to', async () => {
    const mock = buildMock();
    await createFixture(mock);

    expect(mock.serieTemporal).toHaveBeenCalledExactlyOnceWith({
      granularidade: 'dia',
      from: undefined,
      to: undefined,
    });
  });

  it('toggle para semana refaz a busca e marca aria-pressed', async () => {
    const mock = buildMock();
    const fixture = await createFixture(mock);

    const botoes = Array.from(
      el(fixture).querySelectorAll<HTMLButtonElement>('.gserie__toggle button'),
    );
    expect(botoes.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false']);

    mock.serieTemporal.mockReturnValueOnce(
      of(buildSerie([{ bucket: '2026-06-29', horas: 3.5 }], 'semana')),
    );
    botoes[1].click();
    await fixture.whenStable();

    expect(mock.serieTemporal).toHaveBeenLastCalledWith({
      granularidade: 'semana',
      from: undefined,
      to: undefined,
    });
    expect(
      Array.from(el(fixture).querySelectorAll('.gserie__toggle button')).map((b) =>
        b.getAttribute('aria-pressed'),
      ),
    ).toEqual(['false', 'true']);

    // clicar de novo na granularidade já ativa não refaz a busca
    el(fixture).querySelectorAll<HTMLButtonElement>('.gserie__toggle button')[1].click();
    await fixture.whenStable();
    expect(mock.serieTemporal).toHaveBeenCalledTimes(2);
  });

  it('setar from/to refaz a busca com os dias crus', async () => {
    const mock = buildMock();
    const fixture = await createFixture(mock);

    const from = el(fixture).querySelector<HTMLInputElement>('#gserie-from')!;
    from.value = '2026-06-01';
    from.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(mock.serieTemporal).toHaveBeenLastCalledWith({
      granularidade: 'dia',
      from: '2026-06-01',
      to: undefined,
    });

    const to = el(fixture).querySelector<HTMLInputElement>('#gserie-to')!;
    to.value = '2026-06-30';
    to.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(mock.serieTemporal).toHaveBeenLastCalledWith({
      granularidade: 'dia',
      from: '2026-06-01',
      to: '2026-06-30',
    });
  });

  it('staleness: resposta atrasada de filtro antigo é descartada', async () => {
    const mock = buildMock();
    const fixture = await createFixture(mock);

    const antiga$ = new Subject<SerieTemporal>();
    mock.serieTemporal.mockReturnValueOnce(antiga$);
    mock.serieTemporal.mockReturnValueOnce(of(buildSerie([{ bucket: '2026-07-10', horas: 4 }])));

    const from = el(fixture).querySelector<HTMLInputElement>('#gserie-from')!;
    from.value = '2026-01-01'; // segurada
    from.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(el(fixture).textContent).toContain('Carregando série temporal');

    const to = el(fixture).querySelector<HTMLInputElement>('#gserie-to')!;
    to.value = '2026-01-31'; // imediata
    to.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    antiga$.next(buildSerie([{ bucket: '2026-01-01', horas: 9 }]));
    antiga$.complete();
    await fixture.whenStable();

    expect(fixture.componentInstance.result()?.data[0].bucket).toBe('2026-07-10');
  });
});

describe('GraficoSerieTemporal — desenho', () => {
  it('linha única contínua: buckets zerados fazem parte do path e dos pontos', async () => {
    const fixture = await createFixture(buildMock());

    const path = el(fixture).querySelector('.gserie__linha')!;
    const d = path.getAttribute('d')!;
    expect(d.startsWith('M')).toBe(true);
    // 3 buckets (incluindo o zerado) → 1 M + 2 L
    expect(d.match(/L/g)).toHaveLength(2);
    expect(el(fixture).querySelectorAll('.gserie__ponto')).toHaveLength(3);
  });

  it('cada ponto tem alvo de hover maior que a marca e tooltip com valor + data', async () => {
    const fixture = await createFixture(buildMock());

    const pontos = Array.from(el(fixture).querySelectorAll('.gserie__ponto'));
    const hit = pontos[0].querySelector('.gserie__hit')!;
    const dot = pontos[0].querySelector('.gserie__dot')!;
    expect(Number(hit.getAttribute('r'))).toBeGreaterThan(Number(dot.getAttribute('r')));
    expect(pontos[0].querySelector('title')?.textContent).toContain('2 h — 01/07/2026');
    expect(pontos[1].querySelector('title')?.textContent).toContain('0 h — 02/07/2026');
  });

  it('tooltip semanal nomeia a semana do bucket (segunda-feira)', async () => {
    const fixture = await createFixture(
      buildMock(buildSerie([{ bucket: '2026-06-29', horas: 3.5 }], 'semana')),
    );

    expect(el(fixture).querySelector('.gserie__ponto title')?.textContent).toContain(
      '3.5 h — semana de 29/06/2026',
    );
  });

  it('aria-label resume período, granularidade e total (alternativa textual)', async () => {
    const fixture = await createFixture(buildMock());

    const svg = el(fixture).querySelector('.gserie__svg')!;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe(
      'Horas de estudo por dia de 01/07/2026 a 03/07/2026: total de 3.5 h',
    );
  });

  it('rótulos de eixo esparsos: 3 marcas no Y e até 3 no X', async () => {
    const fixture = await createFixture(buildMock());

    const eixos = Array.from(el(fixture).querySelectorAll('.gserie__eixo'));
    expect(eixos.length).toBeLessThanOrEqual(6);
    const textos = eixos.map((t) => t.textContent?.trim());
    expect(textos).toContain('2 h'); // teto do eixo Y = maior valor
    expect(textos).toContain('0 h');
    expect(textos).toContain('01/07');
    expect(textos).toContain('03/07');
  });

  it('estado vazio quando o backend não devolve buckets', async () => {
    const fixture = await createFixture(buildMock(buildSerie([])));

    expect(el(fixture).querySelector('.gserie__svg')).toBeNull();
    expect(el(fixture).textContent).toContain('Nenhum dado no período.');
  });
});

describe('GraficoSerieTemporal — largura responsiva (M1)', () => {
  it('viewBox acompanha a largura medida (1 unidade SVG ≈ 1px CSS → texto dos eixos não escala)', async () => {
    const fixture = await createFixture(buildMock());
    expect(el(fixture).querySelector('.gserie__svg')?.getAttribute('viewBox')).toBe('0 0 640 220');

    fixture.componentInstance.largura.set(320);
    await fixture.whenStable();

    expect(el(fixture).querySelector('.gserie__svg')?.getAttribute('viewBox')).toBe('0 0 320 220');
    // os pontos são reprojetados para a nova área útil (último ≈ largura - pad direito)
    const xs = Array.from(el(fixture).querySelectorAll('.gserie__dot')).map((dot) =>
      Number(dot.getAttribute('cx')),
    );
    expect(Math.max(...xs)).toBe(320 - 16);
  });

  it('container estreito reduz os rótulos do X para primeira e última data', async () => {
    const fixture = await createFixture(buildMock());

    fixture.componentInstance.largura.set(320);
    await fixture.whenStable();

    const datas = Array.from(el(fixture).querySelectorAll('.gserie__eixo'))
      .map((t) => t.textContent?.trim())
      .filter((texto) => texto?.includes('/'));
    expect(datas).toEqual(['01/07', '03/07']);
  });
});
