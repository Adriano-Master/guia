import { HttpErrorResponse } from '@angular/common/http';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import type { Paginated } from '../../core/auth/auth.models';
import type { ApiErrorDetail } from '../../core/http/api-error';
import TurmasList from './turmas-list';
import type { Turma } from './turmas.models';
import { TurmasService } from './turmas.service';

/**
 * Lista de turmas do professor: criação com navegação ao detalhe, 422 de
 * validação aplicado como erro de campo e filtro de situação (ativa=false)
 * repassado à API com reset de página.
 */

const NOW = '2026-07-07T12:00:00.000Z';

function buildTurma(overrides: Partial<Turma> = {}): Turma {
  return {
    id: 'turma-1',
    nome: 'Turma TRT 2026',
    descricao: null,
    professorId: 'prof-1',
    ativa: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function paginated(data: Turma[], total = data.length): Paginated<Turma> {
  return { data, page: 1, pageSize: 12, total };
}

function apiError(
  status: number,
  code: string,
  message: string,
  details?: ApiErrorDetail[],
): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: { error: { code, message, details } } });
}

interface TurmasServiceMock {
  list: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
}

function buildMock(): TurmasServiceMock {
  return {
    list: vi.fn(() => of(paginated([buildTurma()]))),
    create: vi.fn(() => of(buildTurma({ id: 'turma-9', nome: 'Turma nova' }))),
  };
}

async function createFixture(mock: TurmasServiceMock): Promise<ComponentFixture<TurmasList>> {
  TestBed.configureTestingModule({
    imports: [TurmasList],
    providers: [provideRouter([]), { provide: TurmasService, useValue: mock }],
  });
  const fixture = TestBed.createComponent(TurmasList);
  await fixture.whenStable();
  return fixture;
}

function el(fixture: ComponentFixture<TurmasList>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function botao(fixture: ComponentFixture<TurmasList>, texto: string): HTMLButtonElement {
  const btn = Array.from(el(fixture).querySelectorAll<HTMLButtonElement>('button')).find((b) =>
    b.textContent?.trim().startsWith(texto),
  );
  if (!btn) throw new Error(`Botão "${texto}" não encontrado`);
  return btn;
}

async function preencher(
  fixture: ComponentFixture<TurmasList>,
  seletor: string,
  valor: string,
): Promise<void> {
  const campo = el(fixture).querySelector<HTMLInputElement | HTMLTextAreaElement>(seletor)!;
  campo.value = valor;
  campo.dispatchEvent(new Event('input'));
  await fixture.whenStable();
}

async function abrirECriar(
  fixture: ComponentFixture<TurmasList>,
  nome: string,
  descricao = '',
): Promise<void> {
  botao(fixture, 'Nova turma').click();
  await fixture.whenStable();
  await preencher(fixture, '.turmas__create #nome', nome);
  if (descricao) await preencher(fixture, '.turmas__create #descricao', descricao);
  el(fixture)
    .querySelector('.turmas__create form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await fixture.whenStable();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TurmasList — criação', () => {
  it('cria a turma e navega para o detalhe', async () => {
    const mock = buildMock();
    const fixture = await createFixture(mock);
    const navigateSpy = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);

    await abrirECriar(fixture, 'Turma nova', 'Preparatório');

    expect(mock.create).toHaveBeenCalledExactlyOnceWith({
      nome: 'Turma nova',
      descricao: 'Preparatório',
    });
    expect(navigateSpy).toHaveBeenCalledExactlyOnceWith(['/turmas', 'turma-9']);
  });

  it('descrição vazia vira undefined no payload', async () => {
    const mock = buildMock();
    const fixture = await createFixture(mock);
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    await abrirECriar(fixture, 'Só nome');

    expect(mock.create).toHaveBeenCalledExactlyOnceWith({
      nome: 'Só nome',
      descricao: undefined,
    });
  });

  it('nome vazio não chama a API e mostra erro de campo', async () => {
    const mock = buildMock();
    const fixture = await createFixture(mock);

    await abrirECriar(fixture, '');

    expect(mock.create).not.toHaveBeenCalled();
    expect(el(fixture).querySelector('.turmas__create .field__error')?.textContent).toContain(
      'Campo obrigatório',
    );
  });

  it('422 de validação aplica o detail como erro do campo, sem alerta global', async () => {
    const mock = buildMock();
    mock.create.mockReturnValue(
      throwError(() =>
        apiError(422, 'VALIDATION_ERROR', 'Verifique os dados informados.', [
          { field: 'nome', issue: 'já existe uma turma com este nome' },
        ]),
      ),
    );
    const fixture = await createFixture(mock);
    const navigateSpy = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    await abrirECriar(fixture, 'Duplicada');

    expect(el(fixture).querySelector('.turmas__create .field__error')?.textContent).toContain(
      'já existe uma turma com este nome',
    );
    // todos os details casaram com campos → sem alerta genérico duplicado
    expect(el(fixture).querySelector('.turmas__create .alert--error')).toBeNull();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('403 → mensagem de permissão no alerta do formulário', async () => {
    const mock = buildMock();
    mock.create.mockReturnValue(
      throwError(() => apiError(403, 'FORBIDDEN', 'Você não tem permissão.')),
    );
    const fixture = await createFixture(mock);

    await abrirECriar(fixture, 'Sem permissão');

    expect(el(fixture).querySelector('.turmas__create .alert--error')?.textContent).toContain(
      'Você não tem permissão para criar turmas.',
    );
  });
});

describe('TurmasList — glassmorphism §6', () => {
  it('itens da lista usam card--flat (sem camada de blur por item)', async () => {
    const fixture = await createFixture(buildMock());

    const itens = el(fixture).querySelectorAll('.turmas__item');
    expect(itens.length).toBeGreaterThan(0);
    for (const item of itens) {
      expect(item.classList).toContain('card--flat');
    }
  });
});

describe('TurmasList — filtros', () => {
  it('carga inicial lista sem filtro de situação', async () => {
    const mock = buildMock();
    await createFixture(mock);

    expect(mock.list).toHaveBeenCalledExactlyOnceWith({
      page: 1,
      pageSize: 12,
      sort: '-createdAt',
      ativa: undefined,
    });
  });

  it('filtro "Inativas" envia ativa=false e reseta a página', async () => {
    const mock = buildMock();
    mock.list.mockReturnValue(of(paginated([buildTurma()], 30))); // 3 páginas
    const fixture = await createFixture(mock);

    botao(fixture, 'Próxima').click();
    await fixture.whenStable();
    expect(mock.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2, ativa: undefined }),
    );

    const select = el(fixture).querySelector<HTMLSelectElement>('#ativa')!;
    select.value = 'false';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(mock.list).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 12,
      sort: '-createdAt',
      ativa: false,
    });
  });

  it('filtro "Ativas" envia ativa=true', async () => {
    const mock = buildMock();
    const fixture = await createFixture(mock);

    const select = el(fixture).querySelector<HTMLSelectElement>('#ativa')!;
    select.value = 'true';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(mock.list).toHaveBeenLastCalledWith(expect.objectContaining({ ativa: true }));
  });
});
