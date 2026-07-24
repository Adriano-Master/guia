import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';

import { ProgressoBarra } from './progresso-barra';

/**
 * Barra de progresso acessível (pwa-frontend.md §5): role progressbar com
 * aria-valuenow/min/max e nome acessível; a largura do preenchimento
 * reflete o percentual.
 */

async function createFixture(
  valor: number,
  label = 'Progresso do plano',
): Promise<ComponentFixture<ProgressoBarra>> {
  TestBed.configureTestingModule({ imports: [ProgressoBarra] });
  const fixture = TestBed.createComponent(ProgressoBarra);
  fixture.componentRef.setInput('valor', valor);
  fixture.componentRef.setInput('label', label);
  await fixture.whenStable();
  return fixture;
}

function barra(fixture: ComponentFixture<ProgressoBarra>): HTMLElement {
  const el = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
    '[role="progressbar"]',
  );
  if (!el) throw new Error('Elemento com role="progressbar" não encontrado');
  return el;
}

describe('ProgressoBarra', () => {
  it('expõe role=progressbar com aria-valuemin/max e aria-valuenow do valor', async () => {
    const fixture = await createFixture(66.67, 'Progresso do plano: 2 de 3 subtemas concluídos');
    const el = barra(fixture);

    expect(el.getAttribute('aria-valuemin')).toBe('0');
    expect(el.getAttribute('aria-valuemax')).toBe('100');
    expect(el.getAttribute('aria-valuenow')).toBe('66.67');
    expect(el.getAttribute('aria-label')).toBe('Progresso do plano: 2 de 3 subtemas concluídos');
  });

  it('largura do preenchimento reflete o percentual', async () => {
    const fixture = await createFixture(66.67);
    const fill = barra(fixture).querySelector<HTMLElement>('.pbar__fill')!;

    expect(fill.style.width).toBe('66.67%');
  });

  it('0% e 100% (extremos)', async () => {
    const zero = await createFixture(0);
    expect(barra(zero).getAttribute('aria-valuenow')).toBe('0');
    expect(barra(zero).querySelector<HTMLElement>('.pbar__fill')!.style.width).toBe('0%');

    TestBed.resetTestingModule();

    const cem = await createFixture(100);
    expect(barra(cem).getAttribute('aria-valuenow')).toBe('100');
    expect(barra(cem).querySelector<HTMLElement>('.pbar__fill')!.style.width).toBe('100%');
  });

  it('atualização do input reflete em aria-valuenow e na largura', async () => {
    const fixture = await createFixture(25);

    fixture.componentRef.setInput('valor', 50);
    await fixture.whenStable();

    expect(barra(fixture).getAttribute('aria-valuenow')).toBe('50');
    expect(barra(fixture).querySelector<HTMLElement>('.pbar__fill')!.style.width).toBe('50%');
  });
});
