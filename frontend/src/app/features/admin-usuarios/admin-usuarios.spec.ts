import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { NEVER, of, throwError } from 'rxjs';

import type { Paginated, Role, User } from '../../core/auth/auth.models';
import { AuthService } from '../../core/auth/auth.service';
import { ImpersonationService } from '../../core/auth/impersonation.service';
import { UsersService } from '../../core/auth/users.service';
import AdminUsuarios from './admin-usuarios';

/**
 * Ação "Ver como aluno" na tela de usuários do admin: só aparece em linhas
 * de ALUNO, chama ImpersonationService.entrar e exibe a mensagem do envelope
 * de erro quando a API recusa.
 */

function buildUser(role: Role, id: string, nome: string): User {
  return {
    id,
    nome,
    email: `${id}@example.com`,
    role,
    status: 'ATIVO',
    origem: 'PROPRIO',
    ultimoLoginAt: null,
    createdAt: '2026-07-01T12:00:00.000Z',
    updatedAt: '2026-07-01T12:00:00.000Z',
  };
}

const admin = buildUser('ADMIN', 'admin-1', 'Ana Admin');
const aluno = buildUser('ALUNO', 'aluno-1', 'João Aluno');
const professor = buildUser('PROFESSOR', 'prof-1', 'Paulo Professor');

function buildPage(): Paginated<User> {
  return { data: [admin, aluno, professor], page: 1, pageSize: 20, total: 3 };
}

interface Mocks {
  entrar: ReturnType<typeof vi.fn>;
}

async function createFixture(
  entrar: Mocks['entrar'] = vi.fn(() => of(undefined)),
): Promise<{ fixture: ComponentFixture<AdminUsuarios>; entrar: Mocks['entrar'] }> {
  TestBed.configureTestingModule({
    imports: [AdminUsuarios],
    providers: [
      { provide: UsersService, useValue: { list: vi.fn(() => of(buildPage())) } },
      { provide: AuthService, useValue: { currentUser: signal<User | null>(admin) } },
      { provide: ImpersonationService, useValue: { entrar } },
    ],
  });
  const fixture = TestBed.createComponent(AdminUsuarios);
  await fixture.whenStable();
  return { fixture, entrar };
}

function botoesVerComoAluno(fixture: ComponentFixture<AdminUsuarios>): HTMLButtonElement[] {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
      'tbody button[aria-label^="Ver como aluno"]',
    ),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AdminUsuarios — Ver como aluno', () => {
  it('mostra o botão apenas nas linhas com role ALUNO', async () => {
    const { fixture } = await createFixture();

    const botoes = botoesVerComoAluno(fixture);
    expect(botoes).toHaveLength(1);
    expect(botoes[0].getAttribute('aria-label')).toBe('Ver como aluno: João Aluno');

    const linhaAluno = botoes[0].closest('tr')!;
    expect(linhaAluno.textContent).toContain('João Aluno');
  });

  it('clique chama ImpersonationService.entrar com o usuário da linha', async () => {
    const { fixture, entrar } = await createFixture();

    botoesVerComoAluno(fixture)[0].click();
    await fixture.whenStable();

    expect(entrar).toHaveBeenCalledTimes(1);
    expect(entrar).toHaveBeenCalledWith(expect.objectContaining({ id: 'aluno-1' }));
  });

  it('exibe loading enquanto abre e desabilita o botão', async () => {
    // entrar "pendente": observable que nunca emite
    const { fixture } = await createFixture(vi.fn(() => NEVER));

    const botao = botoesVerComoAluno(fixture)[0];
    botao.click();
    await fixture.whenStable();

    const atualizado = botoesVerComoAluno(fixture)[0];
    expect(atualizado.textContent).toContain('Abrindo…');
    expect(atualizado.disabled).toBe(true);
  });

  it('erro da API (422) mostra a mensagem do envelope no alerta da tela', async () => {
    const entrar = vi.fn(() =>
      throwError(
        () =>
          new HttpErrorResponse({
            status: 422,
            error: {
              error: { code: 'VALIDATION_ERROR', message: 'Só é possível visualizar alunos.' },
            },
          }),
      ),
    );
    const { fixture } = await createFixture(entrar);

    botoesVerComoAluno(fixture)[0].click();
    await fixture.whenStable();

    const alerta = (fixture.nativeElement as HTMLElement).querySelector('.alert--error');
    expect(alerta).not.toBeNull();
    expect(alerta!.textContent).toContain('Só é possível visualizar alunos.');
  });
});
