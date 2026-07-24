import { HttpErrorResponse } from '@angular/common/http';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import type { Paginated } from '../../core/auth/auth.models';
import { MatriculasService } from './matriculas.service';
import { TurmaAlunos } from './turma-alunos';
import type { Matricula } from './turmas.models';

/**
 * Painel de alunos matriculados (visão do professor): tabela com nome/email/
 * status, filtro por status refazendo a busca com page=1 e inativar/reativar
 * matrícula com confirmação + recarga da lista.
 */

const NOW = '2026-07-07T12:00:00.000Z';

function buildMatricula(
  id: string,
  nome: string,
  email: string,
  status: 'ATIVA' | 'INATIVA' = 'ATIVA',
): Matricula {
  return {
    id,
    turmaId: 'turma-1',
    alunoId: `user-${id}`,
    status,
    createdAt: NOW,
    updatedAt: NOW,
    aluno: { id: `user-${id}`, nome, email },
  };
}

function paginated(data: Matricula[], total = data.length): Paginated<Matricula> {
  return { data, page: 1, pageSize: 10, total };
}

function apiError(status: number, code: string, message: string): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: { error: { code, message } } });
}

interface MatriculasServiceMock {
  listByTurma: ReturnType<typeof vi.fn>;
  updateStatus: ReturnType<typeof vi.fn>;
}

function buildMock(): MatriculasServiceMock {
  return {
    listByTurma: vi.fn(() =>
      of(
        paginated([
          buildMatricula('mat-1', 'Maria Silva', 'maria@example.com', 'ATIVA'),
          buildMatricula('mat-2', 'João Souza', 'joao@example.com', 'INATIVA'),
        ]),
      ),
    ),
    updateStatus: vi.fn((id: string, status: 'ATIVA' | 'INATIVA') =>
      of(buildMatricula(id, 'Maria Silva', 'maria@example.com', status)),
    ),
  };
}

async function createFixture(mock: MatriculasServiceMock): Promise<ComponentFixture<TurmaAlunos>> {
  TestBed.configureTestingModule({
    imports: [TurmaAlunos],
    providers: [{ provide: MatriculasService, useValue: mock }],
  });
  const fixture = TestBed.createComponent(TurmaAlunos);
  fixture.componentRef.setInput('turmaId', 'turma-1');
  await fixture.whenStable();
  return fixture;
}

function el(fixture: ComponentFixture<TurmaAlunos>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function linhas(fixture: ComponentFixture<TurmaAlunos>): HTMLTableRowElement[] {
  return Array.from(el(fixture).querySelectorAll<HTMLTableRowElement>('tbody tr'));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TurmaAlunos — listagem', () => {
  it('carrega pela turma do input e renderiza nome/email/status', async () => {
    const mock = buildMock();
    const fixture = await createFixture(mock);

    expect(mock.listByTurma).toHaveBeenCalledWith('turma-1', {
      page: 1,
      pageSize: 10,
      sort: '-createdAt',
      status: undefined,
    });

    const rows = linhas(fixture);
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Maria Silva');
    expect(rows[0].textContent).toContain('maria@example.com');
    expect(rows[0].querySelector('.badge--ativo')?.textContent?.trim()).toBe('ATIVA');
    expect(rows[1].textContent).toContain('João Souza');
    expect(rows[1].querySelector('.badge--inativo')?.textContent?.trim()).toBe('INATIVA');
  });

  it('sem matrículas → estado vazio orientando o código de convite', async () => {
    const mock = buildMock();
    mock.listByTurma.mockReturnValue(of(paginated([])));
    const fixture = await createFixture(mock);

    expect(el(fixture).querySelector('.alunos__state')?.textContent).toContain(
      'Compartilhe o código de convite',
    );
  });

  it('erro da API → alerta com a mensagem', async () => {
    const mock = buildMock();
    mock.listByTurma.mockReturnValue(
      throwError(() => apiError(403, 'FORBIDDEN', 'Você não tem permissão.')),
    );
    const fixture = await createFixture(mock);

    expect(el(fixture).querySelector('.alert--error')?.textContent).toContain(
      'Você não tem permissão.',
    );
  });
});

describe('TurmaAlunos — filtro de status', () => {
  it('mudar o filtro refaz a busca com o status e reseta a página', async () => {
    const mock = buildMock();
    // 25 matrículas → 3 páginas
    mock.listByTurma.mockReturnValue(
      of(paginated([buildMatricula('mat-1', 'Maria Silva', 'maria@example.com')], 25)),
    );
    const fixture = await createFixture(mock);

    // avança para a página 2…
    Array.from(el(fixture).querySelectorAll<HTMLButtonElement>('button'))
      .find((b) => b.textContent?.trim() === 'Próxima')!
      .click();
    await fixture.whenStable();
    expect(mock.listByTurma).toHaveBeenLastCalledWith('turma-1', {
      page: 2,
      pageSize: 10,
      sort: '-createdAt',
      status: undefined,
    });

    // …e o filtro volta para page 1 com o status aplicado
    const select = el(fixture).querySelector<HTMLSelectElement>('#alunos-status')!;
    select.value = 'INATIVA';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(mock.listByTurma).toHaveBeenLastCalledWith('turma-1', {
      page: 1,
      pageSize: 10,
      sort: '-createdAt',
      status: 'INATIVA',
    });
  });

  it('estado vazio com filtro ativo tem mensagem específica', async () => {
    const mock = buildMock();
    mock.listByTurma.mockReturnValue(of(paginated([])));
    const fixture = await createFixture(mock);

    const select = el(fixture).querySelector<HTMLSelectElement>('#alunos-status')!;
    select.value = 'INATIVA';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(el(fixture).querySelector('.alunos__state')?.textContent).toContain(
      'Nenhuma matrícula com este status.',
    );
  });
});

describe('TurmaAlunos — inativar/reativar', () => {
  it('Inativar (matrícula ATIVA) confirma, envia INATIVA e recarrega', async () => {
    const mock = buildMock();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fixture = await createFixture(mock);
    const chamadasIniciais = mock.listByTurma.mock.calls.length;

    const botaoInativar = linhas(fixture)[0].querySelector<HTMLButtonElement>('button')!;
    expect(botaoInativar.textContent?.trim()).toBe('Inativar');
    expect(botaoInativar.getAttribute('aria-label')).toBe('Inativar matrícula de Maria Silva');
    botaoInativar.click();
    await fixture.whenStable();

    expect(confirmSpy.mock.calls[0][0]).toContain('Maria Silva');
    expect(mock.updateStatus).toHaveBeenCalledExactlyOnceWith('mat-1', 'INATIVA');
    // recarrega em vez de editar a linha (o filtro pode tirá-la da página)
    expect(mock.listByTurma.mock.calls.length).toBe(chamadasIniciais + 1);
  });

  it('Reativar (matrícula INATIVA) confirma e envia ATIVA', async () => {
    const mock = buildMock();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fixture = await createFixture(mock);

    const botaoReativar = linhas(fixture)[1].querySelector<HTMLButtonElement>('button')!;
    expect(botaoReativar.textContent?.trim()).toBe('Reativar');
    botaoReativar.click();
    await fixture.whenStable();

    expect(mock.updateStatus).toHaveBeenCalledExactlyOnceWith('mat-2', 'ATIVA');
  });

  it('confirmação negada → não chama a API nem recarrega', async () => {
    const mock = buildMock();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const fixture = await createFixture(mock);
    const chamadasIniciais = mock.listByTurma.mock.calls.length;

    linhas(fixture)[0].querySelector<HTMLButtonElement>('button')!.click();
    await fixture.whenStable();

    expect(mock.updateStatus).not.toHaveBeenCalled();
    expect(mock.listByTurma.mock.calls.length).toBe(chamadasIniciais);
  });
});
