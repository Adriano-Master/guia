import { HttpErrorResponse } from '@angular/common/http';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import type { Paginated, Role, User, UsersListParams } from '../../core/auth/auth.models';
import { UsersService } from '../../core/auth/users.service';
import { PlanosService } from '../planos/planos.service';
import { TurmasService } from '../turmas/turmas.service';
import AdminDashboard from './admin-dashboard';

/**
 * Dashboard do admin: tiles de contagem (Usuários/Alunos/Professores/Turmas/
 * Planos publicados) derivadas do `total` das listagens paginadas, e painel
 * "Últimos cadastros" com os 5 usuários mais recentes. Falha em users.list é
 * fatal (alert); falha em turmas/planos degrada para 0 sem derrubar a página.
 */

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u1',
    nome: 'Maria Souza',
    email: 'maria@x.com',
    role: 'ALUNO',
    status: 'ATIVO',
    origem: 'PROPRIO',
    ultimoLoginAt: null,
    createdAt: '2026-07-20T12:00:00.000Z',
    updatedAt: '2026-07-20T12:00:00.000Z',
    ...overrides,
  };
}

function buildPage<T>(data: T[], total: number): Paginated<T> {
  return { data, page: 1, pageSize: data.length || 1, total };
}

function http500() {
  return throwError(
    () =>
      new HttpErrorResponse({
        status: 500,
        error: { error: { code: 'INTERNAL', message: 'Erro inesperado no servidor.' } },
      }),
  );
}

interface Mocks {
  users: { list: ReturnType<typeof vi.fn> };
  turmas: { list: ReturnType<typeof vi.fn> };
  planos: { list: ReturnType<typeof vi.fn> };
}

/**
 * Cenário padrão: 12 usuários no total (2 recentes na primeira página),
 * 8 alunos, 2 professores, 4 turmas e 6 planos publicados.
 * users.list despacha pelo filtro `role` — mesma função atende as 3 chamadas.
 */
function buildMocks(): Mocks {
  const recentes = [
    buildUser({ id: 'u1', nome: 'Maria Souza', email: 'maria@x.com' }),
    buildUser({
      id: 'u2',
      nome: 'João Lima',
      email: 'joao@x.com',
      role: 'PROFESSOR',
      status: 'INATIVO',
      createdAt: '2026-07-18T12:00:00.000Z',
    }),
  ];
  const porRole: Partial<Record<Role, Paginated<User>>> = {
    ALUNO: buildPage([buildUser()], 8),
    PROFESSOR: buildPage([buildUser({ role: 'PROFESSOR' })], 2),
  };
  return {
    users: {
      list: vi.fn((params: UsersListParams) =>
        of(params.role ? porRole[params.role]! : buildPage(recentes, 12)),
      ),
    },
    turmas: { list: vi.fn(() => of(buildPage([{ id: 't1' }], 4))) },
    planos: { list: vi.fn(() => of(buildPage([{ id: 'p1' }], 6))) },
  };
}

async function createFixture(mocks: Mocks): Promise<ComponentFixture<AdminDashboard>> {
  TestBed.configureTestingModule({
    imports: [AdminDashboard],
    providers: [
      provideRouter([]),
      { provide: UsersService, useValue: mocks.users },
      { provide: TurmasService, useValue: mocks.turmas },
      { provide: PlanosService, useValue: mocks.planos },
    ],
  });
  const fixture = TestBed.createComponent(AdminDashboard);
  await fixture.whenStable();
  return fixture;
}

function el(fixture: ComponentFixture<AdminDashboard>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

/** Mapa "label do tile" → "valor exibido". */
function tiles(fixture: ComponentFixture<AdminDashboard>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tile of el(fixture).querySelectorAll('.adash__tile')) {
    const label = tile.querySelector('.adash__tile-label')?.textContent?.trim() ?? '';
    out[label] = tile.querySelector('.adash__tile-value')?.textContent?.trim() ?? '';
  }
  return out;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AdminDashboard — tiles de contagem', () => {
  it('exibe os totais vindos do campo `total` de cada listagem', async () => {
    const mocks = buildMocks();
    const fixture = await createFixture(mocks);

    expect(tiles(fixture)).toEqual({
      Usuários: '12',
      Alunos: '8',
      Professores: '2',
      Turmas: '4',
      'Planos publicados': '6',
    });
    expect(el(fixture).querySelector('[role="alert"]')).toBeNull();
  });

  it('consulta as listagens com os params esperados (pageSize mínimo e filtros)', async () => {
    const mocks = buildMocks();
    await createFixture(mocks);

    expect(mocks.users.list).toHaveBeenCalledTimes(3);
    expect(mocks.users.list).toHaveBeenCalledWith({ page: 1, pageSize: 5, sort: '-createdAt' });
    expect(mocks.users.list).toHaveBeenCalledWith({ page: 1, pageSize: 1, role: 'ALUNO' });
    expect(mocks.users.list).toHaveBeenCalledWith({ page: 1, pageSize: 1, role: 'PROFESSOR' });
    expect(mocks.turmas.list).toHaveBeenCalledExactlyOnceWith({ page: 1, pageSize: 1 });
    expect(mocks.planos.list).toHaveBeenCalledExactlyOnceWith({
      page: 1,
      pageSize: 1,
      publicado: true,
    });
  });
});

describe('AdminDashboard — erro e resiliência', () => {
  it('users.list falhando (500) → alerta com a mensagem do envelope e nenhum tile', async () => {
    const mocks = buildMocks();
    mocks.users.list.mockImplementation(() => http500());
    const fixture = await createFixture(mocks);

    const alerta = el(fixture).querySelector('[role="alert"]')!;
    expect(alerta).not.toBeNull();
    expect(alerta.textContent).toContain('Erro inesperado no servidor.');
    expect(el(fixture).querySelector('.adash__tiles')).toBeNull();
    expect(el(fixture).querySelector('.adash__panel')).toBeNull();
  });

  it('turmas e planos falhando NÃO derruba a página — tiles degradam para 0', async () => {
    const mocks = buildMocks();
    mocks.turmas.list.mockReturnValue(http500());
    mocks.planos.list.mockReturnValue(http500());
    const fixture = await createFixture(mocks);

    expect(el(fixture).querySelector('[role="alert"]')).toBeNull();
    expect(tiles(fixture)).toEqual({
      Usuários: '12',
      Alunos: '8',
      Professores: '2',
      Turmas: '0',
      'Planos publicados': '0',
    });
    // painel de recentes segue funcionando
    expect(el(fixture).textContent).toContain('Maria Souza');
  });
});

describe('AdminDashboard — últimos cadastros', () => {
  it('renderiza nome, email, label de role em pt, badge de status e data dd/MM/yyyy', async () => {
    const mocks = buildMocks();
    const fixture = await createFixture(mocks);

    const linhas = Array.from(el(fixture).querySelectorAll('.adash__recente'));
    expect(linhas).toHaveLength(2);

    const [maria, joao] = linhas;
    expect(maria.querySelector('.adash__recente-nome')?.textContent?.trim()).toBe('Maria Souza');
    expect(maria.querySelector('.adash__recente-email')?.textContent?.trim()).toBe('maria@x.com');
    expect(joao.querySelector('.adash__recente-nome')?.textContent?.trim()).toBe('João Lima');
    expect(joao.querySelector('.adash__recente-email')?.textContent?.trim()).toBe('joao@x.com');

    // badges: [0] = role (label pt), [1] = status (com classe de cor)
    const badgesMaria = maria.querySelectorAll('.badge');
    expect(badgesMaria[0].textContent?.trim()).toBe('Aluno');
    expect(badgesMaria[1].textContent?.trim()).toBe('ATIVO');
    expect(badgesMaria[1].classList.contains('badge--ativo')).toBe(true);
    expect(badgesMaria[1].classList.contains('badge--inativo')).toBe(false);

    const badgesJoao = joao.querySelectorAll('.badge');
    expect(badgesJoao[0].textContent?.trim()).toBe('Professor');
    expect(badgesJoao[1].textContent?.trim()).toBe('INATIVO');
    expect(badgesJoao[1].classList.contains('badge--inativo')).toBe(true);
    expect(badgesJoao[1].classList.contains('badge--ativo')).toBe(false);

    // datas em dd/MM/yyyy (DatePipe reexibe o ISO em horário local; meio-dia UTC
    // mantém o mesmo dia em qualquer fuso plausível de CI)
    expect(maria.querySelector('.adash__recente-data')?.textContent?.trim()).toBe('20/07/2026');
    expect(joao.querySelector('.adash__recente-data')?.textContent?.trim()).toBe('18/07/2026');
  });

  it('labels de role cobrem Admin e Moderador', async () => {
    const mocks = buildMocks();
    mocks.users.list.mockImplementation((params: UsersListParams) =>
      of(
        params.role
          ? buildPage([buildUser({ role: params.role })], 1)
          : buildPage(
              [
                buildUser({ id: 'u1', role: 'ADMIN' }),
                buildUser({ id: 'u2', role: 'MODERADOR' }),
              ],
              2,
            ),
      ),
    );
    const fixture = await createFixture(mocks);

    const roles = Array.from(el(fixture).querySelectorAll('.adash__recente')).map(
      (li) => li.querySelectorAll('.badge')[0].textContent?.trim(),
    );
    expect(roles).toEqual(['Admin', 'Moderador']);
  });

  it('nenhum usuário cadastrado → mensagem de vazio, sem lista nem CTA', async () => {
    const mocks = buildMocks();
    mocks.users.list.mockImplementation(() => of(buildPage<User>([], 0)));
    const fixture = await createFixture(mocks);

    expect(el(fixture).textContent).toContain('Nenhum usuário cadastrado ainda.');
    expect(el(fixture).querySelector('.adash__recentes')).toBeNull();
    expect(el(fixture).querySelector('.adash__panel-cta')).toBeNull();
    expect(tiles(fixture)['Usuários']).toBe('0');
  });
});
