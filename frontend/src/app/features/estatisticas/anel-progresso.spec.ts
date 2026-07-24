import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';

import { AnelProgresso } from './anel-progresso';

/**
 * Anel de progresso SVG: role img com nome acessível, percentual central
 * sempre em texto e arco proporcional ao valor (dasharray sobre a
 * circunferência de r=52), com clamp 0–100.
 */

const CIRCUNFERENCIA = 2 * Math.PI * 52;

async function createFixture(
  percentual: number,
  label = 'Progresso do plano ativo',
): Promise<ComponentFixture<AnelProgresso>> {
  TestBed.configureTestingModule({ imports: [AnelProgresso] });
  const fixture = TestBed.createComponent(AnelProgresso);
  fixture.componentRef.setInput('percentual', percentual);
  fixture.componentRef.setInput('label', label);
  await fixture.whenStable();
  return fixture;
}

function el(fixture: ComponentFixture<AnelProgresso>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function arco(fixture: ComponentFixture<AnelProgresso>): SVGCircleElement {
  return el(fixture).querySelector<SVGCircleElement>('.anel__arco')!;
}

describe('AnelProgresso', () => {
  it('expõe role=img com o label e o percentual central em texto', async () => {
    const fixture = await createFixture(66.67, 'Progresso do plano ativo: 2 de 3 subtemas');

    const anel = el(fixture).querySelector('[role="img"]')!;
    expect(anel.getAttribute('aria-label')).toBe('Progresso do plano ativo: 2 de 3 subtemas');
    expect(el(fixture).querySelector('.anel__valor')?.textContent?.trim()).toBe('66.7%');
  });

  it('arco proporcional: dasharray = fração da circunferência', async () => {
    const fixture = await createFixture(25);

    const esperado = `${(CIRCUNFERENCIA * 0.25).toFixed(2)} ${CIRCUNFERENCIA.toFixed(2)}`;
    expect(arco(fixture).getAttribute('stroke-dasharray')).toBe(esperado);
  });

  it('extremos 0% e 100%', async () => {
    const zero = await createFixture(0);
    expect(arco(zero).getAttribute('stroke-dasharray')).toBe(`0.00 ${CIRCUNFERENCIA.toFixed(2)}`);
    expect(el(zero).querySelector('.anel__valor')?.textContent?.trim()).toBe('0%');

    TestBed.resetTestingModule();

    const cem = await createFixture(100);
    expect(arco(cem).getAttribute('stroke-dasharray')).toBe(
      `${CIRCUNFERENCIA.toFixed(2)} ${CIRCUNFERENCIA.toFixed(2)}`,
    );
  });

  it('clamp: valores fora de 0–100 não estouram o desenho nem o texto', async () => {
    const fixture = await createFixture(140);

    expect(arco(fixture).getAttribute('stroke-dasharray')).toBe(
      `${CIRCUNFERENCIA.toFixed(2)} ${CIRCUNFERENCIA.toFixed(2)}`,
    );
    expect(el(fixture).querySelector('.anel__valor')?.textContent?.trim()).toBe('100%');
  });

  it('atualização do input reflete no arco e no texto', async () => {
    const fixture = await createFixture(25);

    fixture.componentRef.setInput('percentual', 50);
    await fixture.whenStable();

    expect(arco(fixture).getAttribute('stroke-dasharray')).toBe(
      `${(CIRCUNFERENCIA * 0.5).toFixed(2)} ${CIRCUNFERENCIA.toFixed(2)}`,
    );
    expect(el(fixture).querySelector('.anel__valor')?.textContent?.trim()).toBe('50%');
  });
});
