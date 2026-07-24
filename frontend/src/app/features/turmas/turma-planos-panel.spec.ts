import { HttpErrorResponse } from '@angular/common/http';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import type { ApiErrorDetail } from '../../core/http/api-error';
import type { Plano } from '../planos/planos.models';
import { PlanosService } from '../planos/planos.service';
import { TurmaPlanosPanel } from './turma-planos-panel';
import { TurmaPlanosService } from './turma-planos.service';
import type { TurmaPlano } from './turmas.models';

/**
 * Painel de planos OFICIAIS da turma (RN-06): o select oferece apenas
 * oficiais publicados ainda não vinculados; 422 exibe os details do envelope;
 * 409 tem mensagem amigável; desvincular pede confirmação e remove da lista.
 */

const NOW = '2026-07-07T12:00:00.000Z';

function buildPlano(id: string, titulo: string): Plano {
  return {
    id,
    titulo,
    descricao: null,
    tipo: 'OFICIAL',
    autorId: 'prof-1',
    planoOrigemId: null,
    publicado: true,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function buildVinculo(id: string, planoId: string, titulo: string): TurmaPlano {
  return {
    id,
    turmaId: 'turma-1',
    planoId,
    createdAt: NOW,
    plano: { id: planoId, titulo, tipo: 'OFICIAL', publicado: true },
  };
}

function apiError(
  status: number,
  code: string,
  message: string,
  details?: ApiErrorDetail[],
): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: { error: { code, message, details } } });
}

interface Mocks {
  turmaPlanos: {
    list: ReturnType<typeof vi.fn>;
    vincular: ReturnType<typeof vi.fn>;
    desvincular: ReturnType<typeof vi.fn>;
  };
  planos: { list: ReturnType<typeof vi.fn> };
}

function buildMocks(): Mocks {
  return {
    turmaPlanos: {
      list: vi.fn(() =>
        of({
          data: [buildVinculo('tp-1', 'p1', 'Plano A')],
          page: 1,
          pageSize: 100,
          total: 1,
        }),
      ),
      vincular: vi.fn((_turmaId: string, planoId: string) =>
        of(buildVinculo(`tp-${planoId}`, planoId, 'Plano B')),
      ),
      desvincular: vi.fn(() => of(void 0)),
    },
    planos: {
      list: vi.fn(() =>
        of({
          data: [buildPlano('p1', 'Plano A'), buildPlano('p2', 'Plano B'), buildPlano('p3', 'Plano C')],
          page: 1,
          pageSize: 100,
          total: 3,
        }),
      ),
    },
  };
}

async function createFixture(mocks: Mocks): Promise<ComponentFixture<TurmaPlanosPanel>> {
  TestBed.configureTestingModule({
    imports: [TurmaPlanosPanel],
    providers: [
      provideRouter([]),
      { provide: TurmaPlanosService, useValue: mocks.turmaPlanos },
      { provide: PlanosService, useValue: mocks.planos },
    ],
  });
  const fixture = TestBed.createComponent(TurmaPlanosPanel);
  fixture.componentRef.setInput('turmaId', 'turma-1');
  await fixture.whenStable();
  return fixture;
}

function el(fixture: ComponentFixture<TurmaPlanosPanel>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function opcoes(fixture: ComponentFixture<TurmaPlanosPanel>): string[] {
  return Array.from(
    el(fixture).querySelectorAll<HTMLOptionElement>('#tplanos-plano option'),
  ).map((o) => o.textContent?.trim() ?? '');
}

async function selecionarEVincular(
  fixture: ComponentFixture<TurmaPlanosPanel>,
  planoId: string,
): Promise<void> {
  const select = el(fixture).querySelector<HTMLSelectElement>('#tplanos-plano')!;
  select.value = planoId;
  select.dispatchEvent(new Event('change'));
  await fixture.whenStable();
  el(fixture)
    .querySelector('form.tplanos__vincular')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await fixture.whenStable();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TurmaPlanosPanel — select de oficiais', () => {
  it('exclui do select os planos já vinculados', async () => {
    const fixture = await createFixture(buildMocks());

    // Plano A já vinculado: só B e C disponíveis
    expect(opcoes(fixture)).toEqual(['Selecione um plano', 'Plano B', 'Plano C']);
    expect(el(fixture).querySelector('.tplanos__lista')?.textContent).toContain('Plano A');
  });

  it('vincular adiciona à lista e some do select', async () => {
    const mocks = buildMocks();
    const fixture = await createFixture(mocks);

    await selecionarEVincular(fixture, 'p2');

    expect(mocks.turmaPlanos.vincular).toHaveBeenCalledExactlyOnceWith('turma-1', 'p2');
    expect(el(fixture).querySelector('.tplanos__lista')?.textContent).toContain('Plano B');
    expect(opcoes(fixture)).toEqual(['Selecione um plano', 'Plano C']);
  });

  it('sem oficiais restantes → hint de indisponibilidade', async () => {
    const mocks = buildMocks();
    mocks.planos.list.mockReturnValue(
      of({ data: [buildPlano('p1', 'Plano A')], page: 1, pageSize: 100, total: 1 }),
    );
    const fixture = await createFixture(mocks);

    expect(opcoes(fixture)).toEqual(['Selecione um plano']);
    expect(el(fixture).querySelector('.field__hint')?.textContent).toContain(
      'Nenhum plano oficial publicado disponível',
    );
  });
});

describe('TurmaPlanosPanel — erros de vínculo', () => {
  it('422 exibe os details do envelope campo a campo', async () => {
    const mocks = buildMocks();
    mocks.turmaPlanos.vincular.mockReturnValue(
      throwError(() =>
        apiError(422, 'VALIDATION_ERROR', 'Verifique os dados informados.', [
          { field: 'planoId', issue: 'deve ser um plano OFICIAL publicado' },
        ]),
      ),
    );
    const fixture = await createFixture(mocks);

    await selecionarEVincular(fixture, 'p2');

    const details = el(fixture).querySelector('.tplanos__details');
    expect(details?.getAttribute('role')).toBe('alert');
    expect(details?.textContent).toContain('planoId: deve ser um plano OFICIAL publicado');
    expect(el(fixture).querySelector('.alert--error')?.textContent).toContain(
      'Verifique os dados informados.',
    );
    // vínculo não aplicado
    expect(el(fixture).querySelector('.tplanos__lista')?.textContent).not.toContain('Plano B');
  });

  it('409 → mensagem amigável de plano já vinculado', async () => {
    const mocks = buildMocks();
    mocks.turmaPlanos.vincular.mockReturnValue(
      throwError(() => apiError(409, 'CONFLICT', 'Conflito com dados já existentes.')),
    );
    const fixture = await createFixture(mocks);

    await selecionarEVincular(fixture, 'p2');

    expect(el(fixture).querySelector('.alert--error')?.textContent).toContain(
      'Este plano já está vinculado à turma.',
    );
    expect(el(fixture).querySelector('.tplanos__details')).toBeNull();
  });
});

describe('TurmaPlanosPanel — desvincular', () => {
  it('confirma, chama a API e remove o item (volta ao select)', async () => {
    const mocks = buildMocks();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fixture = await createFixture(mocks);

    const remover = el(fixture).querySelector<HTMLButtonElement>('.tplanos__remover')!;
    expect(remover.getAttribute('aria-label')).toBe('Desvincular o plano Plano A');
    remover.click();
    await fixture.whenStable();

    expect(confirmSpy.mock.calls[0][0]).toContain('Plano A');
    expect(mocks.turmaPlanos.desvincular).toHaveBeenCalledExactlyOnceWith('turma-1', 'p1');
    expect(el(fixture).querySelector('.tplanos__state')?.textContent).toContain(
      'Nenhum plano vinculado',
    );
    // desvinculado volta a aparecer no select
    expect(opcoes(fixture)).toEqual(['Selecione um plano', 'Plano A', 'Plano B', 'Plano C']);
  });

  it('confirmação negada → não chama a API e mantém o vínculo', async () => {
    const mocks = buildMocks();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const fixture = await createFixture(mocks);

    el(fixture).querySelector<HTMLButtonElement>('.tplanos__remover')!.click();
    await fixture.whenStable();

    expect(mocks.turmaPlanos.desvincular).not.toHaveBeenCalled();
    expect(el(fixture).querySelector('.tplanos__lista')?.textContent).toContain('Plano A');
  });
});
