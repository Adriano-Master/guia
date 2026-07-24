import { HttpErrorResponse } from '@angular/common/http';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';

import type { Paginated } from '../../core/auth/auth.models';
import { MatriculasService } from './matriculas.service';
import MinhasTurmas from './minhas-turmas';
import { TurmaPlanosService } from './turma-planos.service';
import type { Matricula, TurmaPlano } from './turmas.models';

/**
 * Área do aluno (minhas turmas): entrada por código com uppercase automático,
 * 201/200 tratados como o mesmo sucesso, 404/409 com mensagens corretas,
 * sair da turma (com confirmação) removendo da lista e expansão "Ver planos"
 * com guarda de staleness.
 */

const NOW = '2026-07-07T12:00:00.000Z';

function buildMatricula(
  id: string,
  turmaId: string,
  nome: string,
  overrides: Partial<Matricula> = {},
): Matricula {
  return {
    id,
    turmaId,
    alunoId: 'user-1',
    status: 'ATIVA',
    createdAt: NOW,
    updatedAt: NOW,
    turma: { id: turmaId, nome, descricao: null, ativa: true },
    ...overrides,
  };
}

function paginated(data: Matricula[]): Paginated<Matricula> {
  return { data, page: 1, pageSize: 10, total: data.length };
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

function pagVinculos(data: TurmaPlano[]): Paginated<TurmaPlano> {
  return { data, page: 1, pageSize: 100, total: data.length };
}

function apiError(status: number, code: string, message: string): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: { error: { code, message } } });
}

interface Mocks {
  matriculas: {
    matricular: ReturnType<typeof vi.fn>;
    listMe: ReturnType<typeof vi.fn>;
    listByTurma: ReturnType<typeof vi.fn>;
    updateStatus: ReturnType<typeof vi.fn>;
  };
  turmaPlanos: { list: ReturnType<typeof vi.fn> };
}

function buildMocks(): Mocks {
  return {
    matriculas: {
      matricular: vi.fn(() => of(buildMatricula('mat-1', 'turma-1', 'Turma TRT 2026'))),
      listMe: vi.fn(() => of(paginated([buildMatricula('mat-1', 'turma-1', 'Turma TRT 2026')]))),
      listByTurma: vi.fn(() => of(paginated([]))),
      updateStatus: vi.fn(() =>
        of(buildMatricula('mat-1', 'turma-1', 'Turma TRT 2026', { status: 'INATIVA' })),
      ),
    },
    turmaPlanos: { list: vi.fn(() => of(pagVinculos([]))) },
  };
}

async function createFixture(mocks: Mocks): Promise<ComponentFixture<MinhasTurmas>> {
  TestBed.configureTestingModule({
    imports: [MinhasTurmas],
    providers: [
      provideRouter([]),
      { provide: MatriculasService, useValue: mocks.matriculas },
      { provide: TurmaPlanosService, useValue: mocks.turmaPlanos },
    ],
  });
  const fixture = TestBed.createComponent(MinhasTurmas);
  await fixture.whenStable();
  return fixture;
}

function el(fixture: ComponentFixture<MinhasTurmas>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function codigoInput(fixture: ComponentFixture<MinhasTurmas>): HTMLInputElement {
  return el(fixture).querySelector<HTMLInputElement>('#codigo')!;
}

async function digitarCodigo(
  fixture: ComponentFixture<MinhasTurmas>,
  valor: string,
): Promise<void> {
  const input = codigoInput(fixture);
  input.value = valor;
  input.dispatchEvent(new Event('input'));
  await fixture.whenStable();
}

async function submeter(fixture: ComponentFixture<MinhasTurmas>): Promise<void> {
  el(fixture)
    .querySelector('form.mturmas__form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await fixture.whenStable();
}

function botaoDoItem(
  fixture: ComponentFixture<MinhasTurmas>,
  turmaNome: string,
  texto: string,
): HTMLButtonElement {
  const item = Array.from(el(fixture).querySelectorAll<HTMLElement>('.mturmas__item')).find(
    (li) => li.querySelector('.mturmas__item-titulo')?.textContent?.trim() === turmaNome,
  );
  if (!item) throw new Error(`Item da turma "${turmaNome}" não encontrado`);
  const btn = Array.from(item.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
    b.textContent?.trim().startsWith(texto),
  );
  if (!btn) throw new Error(`Botão "${texto}" não encontrado na turma "${turmaNome}"`);
  return btn;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MinhasTurmas — código de convite', () => {
  it('input converte para MAIÚSCULAS automaticamente (control e DOM)', async () => {
    const fixture = await createFixture(buildMocks());

    await digitarCodigo(fixture, 'abcd2345');

    expect(fixture.componentInstance.codigoControl.value).toBe('ABCD2345');
    expect(codigoInput(fixture).value).toBe('ABCD2345');
  });

  it('submit vazio não chama a API e mostra erro de campo', async () => {
    const mocks = buildMocks();
    const fixture = await createFixture(mocks);

    await submeter(fixture);

    expect(mocks.matriculas.matricular).not.toHaveBeenCalled();
    expect(el(fixture).querySelector('.field__error')?.textContent).toContain(
      'Campo obrigatório',
    );
  });

  it('matrícula com sucesso mostra o nome da turma e recarrega a lista', async () => {
    const mocks = buildMocks();
    mocks.matriculas.matricular.mockReturnValue(
      of(buildMatricula('mat-2', 'turma-2', 'Turma INSS')),
    );
    const fixture = await createFixture(mocks);

    await digitarCodigo(fixture, 'abcd2345');
    await submeter(fixture);

    // o service abstrai o status HTTP: 201 (nova) e 200 (reativada) entregam
    // o mesmo corpo — qualquer next é o mesmo sucesso para o componente
    expect(mocks.matriculas.matricular).toHaveBeenCalledExactlyOnceWith('ABCD2345');
    const sucesso = el(fixture).querySelector('.alert--success');
    expect(sucesso?.getAttribute('role')).toBe('status');
    expect(sucesso?.textContent).toContain('Você entrou na turma "Turma INSS".');
    // lista recarregada (constructor + pós-matrícula) e campo limpo
    expect(mocks.matriculas.listMe).toHaveBeenCalledTimes(2);
    expect(codigoInput(fixture).value).toBe('');
  });

  it('404 → "Código de convite inválido."', async () => {
    const mocks = buildMocks();
    mocks.matriculas.matricular.mockReturnValue(
      throwError(() => apiError(404, 'NOT_FOUND', 'Recurso não encontrado.')),
    );
    const fixture = await createFixture(mocks);

    await digitarCodigo(fixture, 'XXXX0000');
    await submeter(fixture);

    const alerta = el(fixture).querySelector('.alert--error');
    expect(alerta?.getAttribute('role')).toBe('alert');
    expect(alerta?.textContent).toContain('Código de convite inválido.');
  });

  it('409 → mensagem do envelope (já matriculado / turma inativa)', async () => {
    const mocks = buildMocks();
    mocks.matriculas.matricular.mockReturnValue(
      throwError(() => apiError(409, 'CONFLICT', 'Você já está matriculado nesta turma.')),
    );
    const fixture = await createFixture(mocks);

    await digitarCodigo(fixture, 'ABCD2345');
    await submeter(fixture);

    expect(el(fixture).querySelector('.alert--error')?.textContent).toContain(
      'Você já está matriculado nesta turma.',
    );
  });
});

describe('MinhasTurmas — glassmorphism §6', () => {
  it('itens da lista usam card--flat (sem camada de blur por item)', async () => {
    const fixture = await createFixture(buildMocks());

    const itens = el(fixture).querySelectorAll('.mturmas__item');
    expect(itens.length).toBeGreaterThan(0);
    for (const item of itens) {
      expect(item.classList).toContain('card--flat');
    }
  });
});

describe('MinhasTurmas — sair da turma', () => {
  it('confirma, envia INATIVA e remove o item da lista recarregada', async () => {
    const mocks = buildMocks();
    mocks.matriculas.listMe
      .mockReturnValueOnce(
        of(
          paginated([
            buildMatricula('mat-1', 'turma-1', 'Turma TRT 2026'),
            buildMatricula('mat-2', 'turma-2', 'Turma INSS'),
          ]),
        ),
      )
      .mockReturnValue(of(paginated([buildMatricula('mat-2', 'turma-2', 'Turma INSS')])));
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fixture = await createFixture(mocks);

    botaoDoItem(fixture, 'Turma TRT 2026', 'Sair da turma').click();
    await fixture.whenStable();

    expect(confirmSpy.mock.calls[0][0]).toContain('Turma TRT 2026');
    expect(mocks.matriculas.updateStatus).toHaveBeenCalledExactlyOnceWith('mat-1', 'INATIVA');
    // lista recarregada sem a turma
    expect(el(fixture).textContent).not.toContain('Turma TRT 2026');
    expect(el(fixture).textContent).toContain('Turma INSS');
  });

  it('confirmação negada → não chama a API', async () => {
    const mocks = buildMocks();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const fixture = await createFixture(mocks);

    botaoDoItem(fixture, 'Turma TRT 2026', 'Sair da turma').click();
    await fixture.whenStable();

    expect(mocks.matriculas.updateStatus).not.toHaveBeenCalled();
    expect(el(fixture).textContent).toContain('Turma TRT 2026');
  });
});

describe('MinhasTurmas — expansão "Ver planos"', () => {
  it('expande, carrega e lista os planos da turma (aria-expanded/controls)', async () => {
    const mocks = buildMocks();
    mocks.turmaPlanos.list.mockReturnValue(
      of(pagVinculos([buildVinculo('tp-1', 'plano-1', 'Plano Oficial TRT')])),
    );
    const fixture = await createFixture(mocks);

    const verPlanos = botaoDoItem(fixture, 'Turma TRT 2026', 'Ver planos');
    expect(verPlanos.getAttribute('aria-expanded')).toBe('false');
    expect(verPlanos.hasAttribute('aria-controls')).toBe(false);

    verPlanos.click();
    await fixture.whenStable();

    expect(mocks.turmaPlanos.list).toHaveBeenCalledWith('turma-1', { page: 1, pageSize: 100 });
    const btn = botaoDoItem(fixture, 'Turma TRT 2026', 'Ocultar planos');
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(btn.getAttribute('aria-controls')).toBe('mturmas-planos-turma-1');
    const painel = el(fixture).querySelector('#mturmas-planos-turma-1');
    expect(painel?.textContent).toContain('Plano Oficial TRT');
    const link = painel?.querySelector('a.mturmas__plano-link');
    expect(link?.getAttribute('href')).toBe('/planos/plano-1');
  });

  it('staleness: resposta atrasada da turma anterior é descartada ao expandir outra', async () => {
    const mocks = buildMocks();
    mocks.matriculas.listMe.mockReturnValue(
      of(
        paginated([
          buildMatricula('mat-1', 'turma-1', 'Turma TRT 2026'),
          buildMatricula('mat-2', 'turma-2', 'Turma INSS'),
        ]),
      ),
    );
    const planos1$ = new Subject<Paginated<TurmaPlano>>();
    mocks.turmaPlanos.list.mockImplementation((turmaId: string) =>
      turmaId === 'turma-1'
        ? planos1$
        : of(pagVinculos([buildVinculo('tp-2', 'plano-2', 'Plano Oficial INSS')])),
    );
    const fixture = await createFixture(mocks);

    // expande turma-1 (resposta segurada) e troca rápido para turma-2
    botaoDoItem(fixture, 'Turma TRT 2026', 'Ver planos').click();
    await fixture.whenStable();
    expect(el(fixture).textContent).toContain('Carregando planos');

    botaoDoItem(fixture, 'Turma INSS', 'Ver planos').click();
    await fixture.whenStable();
    expect(el(fixture).textContent).toContain('Plano Oficial INSS');

    // resposta atrasada da turma-1 chega — não pode sobrescrever o painel
    planos1$.next(pagVinculos([buildVinculo('tp-1', 'plano-1', 'Plano Oficial TRT')]));
    planos1$.complete();
    await fixture.whenStable();

    expect(el(fixture).textContent).toContain('Plano Oficial INSS');
    expect(el(fixture).textContent).not.toContain('Plano Oficial TRT');
    expect(fixture.componentInstance.expandedId()).toBe('turma-2');
    expect(el(fixture).textContent).not.toContain('Carregando planos');
  });

  it('recolher antes da resposta também descarta (sem painel fantasma)', async () => {
    const mocks = buildMocks();
    const planos$ = new Subject<Paginated<TurmaPlano>>();
    mocks.turmaPlanos.list.mockReturnValue(planos$);
    const fixture = await createFixture(mocks);

    botaoDoItem(fixture, 'Turma TRT 2026', 'Ver planos').click();
    await fixture.whenStable();
    botaoDoItem(fixture, 'Turma TRT 2026', 'Ocultar planos').click();
    await fixture.whenStable();

    planos$.next(pagVinculos([buildVinculo('tp-1', 'plano-1', 'Plano Oficial TRT')]));
    planos$.complete();
    await fixture.whenStable();

    expect(fixture.componentInstance.expandedId()).toBeNull();
    expect(el(fixture).querySelector('.mturmas__planos')).toBeNull();
  });
});
