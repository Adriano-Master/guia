import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';

import { GraficoBarrasHoras } from './grafico-barras-horas';
import type { HorasDisciplina } from './estatisticas.models';

/**
 * Barras horizontais de horas por disciplina: uma linha por disciplina com
 * rótulo e valor em TEXTO junto da barra, larguras relativas ao maior valor
 * (medida única, cor única) e estado vazio.
 */

function item(disciplinaId: string, disciplina: string, horas: number): HorasDisciplina {
  return { disciplinaId, disciplina, horas };
}

async function createFixture(
  data: HorasDisciplina[],
): Promise<ComponentFixture<GraficoBarrasHoras>> {
  TestBed.configureTestingModule({ imports: [GraficoBarrasHoras] });
  const fixture = TestBed.createComponent(GraficoBarrasHoras);
  fixture.componentRef.setInput('data', data);
  await fixture.whenStable();
  return fixture;
}

function el(fixture: ComponentFixture<GraficoBarrasHoras>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function rows(fixture: ComponentFixture<GraficoBarrasHoras>): HTMLElement[] {
  return Array.from(el(fixture).querySelectorAll<HTMLElement>('.gbar__row'));
}

describe('GraficoBarrasHoras', () => {
  it('uma linha por disciplina com rótulo e valor em texto', async () => {
    const fixture = await createFixture([
      item('d1', 'Português', 12.5),
      item('d2', 'Direito Constitucional', 8),
    ]);

    const lista = rows(fixture);
    expect(lista).toHaveLength(2);
    expect(lista[0].querySelector('.gbar__nome')?.textContent?.trim()).toBe('Português');
    expect(lista[0].querySelector('.gbar__valor')?.textContent?.trim()).toBe('12.5 h');
    expect(lista[1].querySelector('.gbar__nome')?.textContent?.trim()).toBe(
      'Direito Constitucional',
    );
    expect(lista[1].querySelector('.gbar__valor')?.textContent?.trim()).toBe('8 h');
  });

  it('larguras proporcionais ao maior valor (base no zero)', async () => {
    const fixture = await createFixture([item('d1', 'Português', 10), item('d2', 'Direito', 5)]);

    const barras = rows(fixture).map((row) => row.querySelector('.gbar__barra')!);
    expect(barras[0].getAttribute('width')).toBe('100%');
    expect(barras[0].getAttribute('x')).toBe('0');
    expect(barras[1].getAttribute('width')).toBe('50%');
  });

  it('barras são decorativas (svg aria-hidden) — a informação está no texto', async () => {
    const fixture = await createFixture([item('d1', 'Português', 10)]);

    const svg = el(fixture).querySelector('.gbar__svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
  });

  it('estado vazio quando não há disciplinas com sessão', async () => {
    const fixture = await createFixture([]);

    expect(rows(fixture)).toHaveLength(0);
    expect(el(fixture).textContent).toContain('Nenhuma sessão de estudo finalizada ainda.');
  });

  it('todas as horas zeradas → barras com largura 0 sem divisão por zero', async () => {
    const fixture = await createFixture([item('d1', 'Português', 0)]);

    expect(rows(fixture)[0].querySelector('.gbar__barra')!.getAttribute('width')).toBe('0%');
    expect(rows(fixture)[0].querySelector('.gbar__valor')?.textContent?.trim()).toBe('0 h');
  });
});
