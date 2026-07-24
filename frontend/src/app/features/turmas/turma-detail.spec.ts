import { HttpErrorResponse } from '@angular/common/http';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { PlanosService } from '../planos/planos.service';
import { MatriculasService } from './matriculas.service';
import TurmaDetail from './turma-detail';
import { TurmaPlanosService } from './turma-planos.service';
import type { Turma } from './turmas.models';
import { TurmasService } from './turmas.service';

/**
 * Detalhe da turma (visão do professor): código de convite (copiar via
 * navigator.clipboard com feedback e fallback de erro; regenerar com
 * confirmação atualizando o valor exibido) e ativar/desativar (desativar
 * pede confirmação — RN-05; reativar não).
 */

const NOW = '2026-07-07T12:00:00.000Z';

function buildTurma(overrides: Partial<Turma> = {}): Turma {
  return {
    id: 'turma-1',
    nome: 'Turma TRT 2026',
    descricao: 'Preparatório intensivo',
    professorId: 'prof-1',
    ativa: true,
    createdAt: NOW,
    updatedAt: NOW,
    codigoConvite: 'ABCD2345',
    ...overrides,
  };
}

function apiError(status: number, code: string, message: string): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: { error: { code, message } } });
}

interface TurmasServiceMock {
  get: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  regenerarCodigo: ReturnType<typeof vi.fn>;
}

function buildTurmasMock(turma: Turma = buildTurma()): TurmasServiceMock {
  return {
    get: vi.fn(() => of(turma)),
    update: vi.fn((_id: string, payload: Partial<Turma>) => of({ ...turma, ...payload })),
    regenerarCodigo: vi.fn(() => of('ZZZZ9999')),
  };
}

async function createFixture(mock: TurmasServiceMock): Promise<ComponentFixture<TurmaDetail>> {
  TestBed.configureTestingModule({
    imports: [TurmaDetail],
    providers: [
      provideRouter([]),
      { provide: TurmasService, useValue: mock },
      {
        provide: ActivatedRoute,
        useValue: { paramMap: of(convertToParamMap({ id: 'turma-1' })) },
      },
      // services dos painéis filhos (turma-alunos / turma-planos-panel)
      {
        provide: MatriculasService,
        useValue: { listByTurma: vi.fn(() => of({ data: [], page: 1, pageSize: 10, total: 0 })) },
      },
      {
        provide: TurmaPlanosService,
        useValue: { list: vi.fn(() => of({ data: [], page: 1, pageSize: 100, total: 0 })) },
      },
      {
        provide: PlanosService,
        useValue: { list: vi.fn(() => of({ data: [], page: 1, pageSize: 100, total: 0 })) },
      },
    ],
  });
  const fixture = TestBed.createComponent(TurmaDetail);
  await fixture.whenStable();
  return fixture;
}

function el(fixture: ComponentFixture<TurmaDetail>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function codigoEl(fixture: ComponentFixture<TurmaDetail>): HTMLElement {
  return el(fixture).querySelector<HTMLElement>('.turma__codigo')!;
}

function botao(fixture: ComponentFixture<TurmaDetail>, texto: string): HTMLButtonElement {
  const btn = Array.from(el(fixture).querySelectorAll<HTMLButtonElement>('button')).find((b) =>
    b.textContent?.trim().startsWith(texto),
  );
  if (!btn) throw new Error(`Botão "${texto}" não encontrado`);
  return btn;
}

function mockClipboard(writeText: ReturnType<typeof vi.fn>): void {
  Object.defineProperty(window.navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (window.navigator as unknown as Record<string, unknown>)['clipboard'];
});

describe('TurmaDetail — código de convite', () => {
  it('exibe a turma e o código de convite do dono', async () => {
    const fixture = await createFixture(buildTurmasMock());

    expect(el(fixture).querySelector('.turma__title')?.textContent).toContain('Turma TRT 2026');
    expect(codigoEl(fixture).textContent?.trim()).toBe('ABCD2345');
  });

  it('regenerar com confirmação atualiza o código exibido e avisa que o antigo caiu', async () => {
    const mock = buildTurmasMock();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fixture = await createFixture(mock);

    botao(fixture, 'Regenerar código').click();
    await fixture.whenStable();

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(mock.regenerarCodigo).toHaveBeenCalledExactlyOnceWith('turma-1');
    expect(codigoEl(fixture).textContent?.trim()).toBe('ZZZZ9999');
    expect(el(fixture).querySelector('.turma__convite-aviso')?.textContent).toContain(
      'Novo código gerado — o anterior deixou de funcionar.',
    );
  });

  it('regenerar com confirmação negada não chama a API e mantém o código', async () => {
    const mock = buildTurmasMock();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const fixture = await createFixture(mock);

    botao(fixture, 'Regenerar código').click();
    await fixture.whenStable();

    expect(mock.regenerarCodigo).not.toHaveBeenCalled();
    expect(codigoEl(fixture).textContent?.trim()).toBe('ABCD2345');
  });

  it('copiar usa navigator.clipboard e dá feedback "Copiado!"', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);
    const fixture = await createFixture(buildTurmasMock());

    botao(fixture, 'Copiar código').click();
    await fixture.whenStable();

    expect(writeText).toHaveBeenCalledExactlyOnceWith('ABCD2345');
    expect(botao(fixture, 'Copiado!')).toBeTruthy();
    expect(el(fixture).querySelector('.turma__convite .alert--error')).toBeNull();
  });

  it('falha do clipboard mostra erro orientando a cópia manual', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('sem permissão'));
    mockClipboard(writeText);
    const fixture = await createFixture(buildTurmasMock());

    botao(fixture, 'Copiar código').click();
    await fixture.whenStable();

    const alerta = el(fixture).querySelector('.turma__convite .alert--error');
    expect(alerta?.textContent).toContain('Não foi possível copiar');
    expect(() => botao(fixture, 'Copiado!')).toThrow();
  });
});

describe('TurmaDetail — edição de dados', () => {
  it('salva nome/descrição com trim e volta ao modo leitura atualizado', async () => {
    const mock = buildTurmasMock();
    const fixture = await createFixture(mock);

    botao(fixture, 'Editar dados').click();
    await fixture.whenStable();

    const nome = el(fixture).querySelector<HTMLInputElement>('#nome')!;
    expect(nome.value).toBe('Turma TRT 2026'); // form pré-preenchido
    nome.value = '  Turma TRT renomeada  ';
    nome.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    el(fixture)
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await fixture.whenStable();

    expect(mock.update).toHaveBeenCalledExactlyOnceWith('turma-1', {
      nome: 'Turma TRT renomeada',
      descricao: 'Preparatório intensivo',
    });
    expect(el(fixture).querySelector('.turma__title')?.textContent).toContain(
      'Turma TRT renomeada',
    );
    expect(el(fixture).querySelector('#nome')).toBeNull(); // saiu do modo edição
  });

  it('cancelar edição descarta sem chamar a API; 422 vira erro de campo', async () => {
    const mock = buildTurmasMock();
    const fixture = await createFixture(mock);

    botao(fixture, 'Editar dados').click();
    await fixture.whenStable();
    botao(fixture, 'Cancelar').click();
    await fixture.whenStable();
    expect(mock.update).not.toHaveBeenCalled();
    expect(el(fixture).querySelector('.turma__title')?.textContent).toContain('Turma TRT 2026');

    // reabre e recebe 422 com detail de campo
    mock.update.mockReturnValue(
      throwError(() =>
        new HttpErrorResponse({
          status: 422,
          error: {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Verifique os dados informados.',
              details: [{ field: 'nome', issue: 'nome muito curto' }],
            },
          },
        }),
      ),
    );
    botao(fixture, 'Editar dados').click();
    await fixture.whenStable();
    el(fixture)
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await fixture.whenStable();

    expect(el(fixture).querySelector('.field__error')?.textContent).toContain('nome muito curto');
    expect(el(fixture).querySelector('#nome')).not.toBeNull(); // permanece editando
  });
});

describe('TurmaDetail — ativar/desativar (RN-05)', () => {
  it('desativar pede confirmação e faz PATCH ativa=false', async () => {
    const mock = buildTurmasMock();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fixture = await createFixture(mock);

    botao(fixture, 'Desativar turma').click();
    await fixture.whenStable();

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0][0]).toContain('Turma TRT 2026');
    expect(mock.update).toHaveBeenCalledExactlyOnceWith('turma-1', { ativa: false });
    expect(el(fixture).querySelector('.badge--inativo')?.textContent).toContain('Inativa');
    expect(botao(fixture, 'Reativar turma')).toBeTruthy();
  });

  it('desativar com confirmação negada não chama a API', async () => {
    const mock = buildTurmasMock();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const fixture = await createFixture(mock);

    botao(fixture, 'Desativar turma').click();
    await fixture.whenStable();

    expect(mock.update).not.toHaveBeenCalled();
  });

  it('reativar NÃO pede confirmação e faz PATCH ativa=true', async () => {
    const mock = buildTurmasMock(buildTurma({ ativa: false }));
    const confirmSpy = vi.spyOn(window, 'confirm');
    const fixture = await createFixture(mock);

    // turma inativa avisa que matrículas novas estão bloqueadas
    expect(el(fixture).querySelector('.turma__convite-hint')?.textContent).toContain(
      'novas matrículas estão bloqueadas',
    );

    botao(fixture, 'Reativar turma').click();
    await fixture.whenStable();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(mock.update).toHaveBeenCalledExactlyOnceWith('turma-1', { ativa: true });
    expect(el(fixture).querySelector('.badge--ativo')?.textContent).toContain('Ativa');
  });

  it('erro no PATCH mostra a mensagem sem alterar o badge', async () => {
    const mock = buildTurmasMock();
    mock.update.mockReturnValue(
      throwError(() => apiError(403, 'FORBIDDEN', 'Você não tem permissão.')),
    );
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fixture = await createFixture(mock);

    botao(fixture, 'Desativar turma').click();
    await fixture.whenStable();

    expect(el(fixture).querySelector('.turma__header .alert--error')?.textContent).toContain(
      'Você não tem permissão.',
    );
    expect(el(fixture).querySelector('.badge--ativo')?.textContent).toContain('Ativa');
  });
});
