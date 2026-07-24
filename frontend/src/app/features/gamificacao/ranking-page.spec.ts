import { HttpErrorResponse } from '@angular/common/http';
import { computed, signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import type { Paginated, Role, User } from '../../core/auth/auth.models';
import { TurmasService } from '../turmas/turmas.service';
import type { MinhaPontuacao, RankingEntry } from './gamificacao.models';
import RankingPage from './ranking-page';
import { RankingService } from './ranking.service';

/**
 * Página de ranking adaptada por papel: ALUNO vê o card "Minha pontuação" e
 * abas vindas de /ranking/me (turmas + Global, com a própria posição fixa);
 * PROFESSOR não chama /ranking/me e monta as abas pelas suas turmas. Estados
 * de vazio, carregamento e erros 403/404 amigáveis.
 */

function buildUser(role: Role): User {
  return {
    id: 'user-1',
    nome: 'Maria Silva',
    email: 'maria@example.com',
    role,
    status: 'ATIVO',
    origem: 'PROPRIO',
    ultimoLoginAt: null,
    createdAt: '2026-07-06T12:00:00.000Z',
    updatedAt: '2026-07-06T12:00:00.000Z',
  };
}

function buildAuthMock(role: Role): Pick<AuthService, 'currentUser' | 'role'> {
  const userSignal = signal<User>(buildUser(role));
  return {
    currentUser: userSignal.asReadonly(),
    role: computed(() => userSignal().role),
  } as Pick<AuthService, 'currentUser' | 'role'>;
}

function buildMe(overrides: Partial<MinhaPontuacao> = {}): MinhaPontuacao {
  return {
    posicaoGlobal: 12,
    pontos: 700,
    subtemasConcluidos: 30,
    horasEstudadas: 40,
    semanasConsistentes: 4,
    composicao: { pontosSubtemas: 300, pontosHoras: 200, pontosBonus: 200 },
    turmas: [
      { turmaId: 't1', nome: 'Turma A', posicao: 3 },
      { turmaId: 't2', nome: 'Turma B', posicao: 7 },
    ],
    ...overrides,
  };
}

function buildEntry(posicao: number, overrides: Partial<RankingEntry> = {}): RankingEntry {
  return {
    posicao,
    alunoId: `a${posicao}`,
    nome: `Aluno ${posicao}`,
    pontos: 1000 - posicao * 10,
    subtemasConcluidos: 20,
    horasEstudadas: 12.5,
    ...overrides,
  };
}

function buildPage(overrides: Partial<Paginated<RankingEntry>> = {}): Paginated<RankingEntry> {
  return {
    data: [buildEntry(1), buildEntry(2)],
    page: 1,
    pageSize: 20,
    total: 2,
    ...overrides,
  };
}

interface RankingMock {
  global: ReturnType<typeof vi.fn>;
  porTurma: ReturnType<typeof vi.fn>;
  me: ReturnType<typeof vi.fn>;
}

interface TurmasMock {
  list: ReturnType<typeof vi.fn>;
}

function buildRankingMock(): RankingMock {
  return {
    global: vi.fn(() => of(buildPage())),
    porTurma: vi.fn(() => of(buildPage())),
    me: vi.fn(() => of(buildMe())),
  };
}

function buildTurmasMock(): TurmasMock {
  return {
    list: vi.fn(() =>
      of({
        data: [
          { id: 't1', nome: 'Turma A' },
          { id: 't2', nome: 'Turma B' },
        ],
        page: 1,
        pageSize: 100,
        total: 2,
      }),
    ),
  };
}

async function createFixture(
  role: Role,
  ranking: RankingMock,
  turmas: TurmasMock = buildTurmasMock(),
): Promise<ComponentFixture<RankingPage>> {
  TestBed.configureTestingModule({
    imports: [RankingPage],
    providers: [
      { provide: RankingService, useValue: ranking },
      { provide: TurmasService, useValue: turmas },
      { provide: AuthService, useValue: buildAuthMock(role) },
    ],
  });
  const fixture = TestBed.createComponent(RankingPage);
  await fixture.whenStable();
  return fixture;
}

function el(fixture: ComponentFixture<RankingPage>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function abas(fixture: ComponentFixture<RankingPage>): HTMLButtonElement[] {
  return Array.from(el(fixture).querySelectorAll<HTMLButtonElement>('.ranking__abas button'));
}

function forbidden(): HttpErrorResponse {
  return new HttpErrorResponse({
    status: 403,
    error: { error: { code: 'FORBIDDEN', message: 'Sem permissão.' } },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RankingPage — ALUNO', () => {
  it('carrega /ranking/me, mostra o card e monta abas turmas + Global (sem TurmasService)', async () => {
    const ranking = buildRankingMock();
    const turmas = buildTurmasMock();
    const fixture = await createFixture('ALUNO', ranking, turmas);

    expect(ranking.me).toHaveBeenCalledTimes(1);
    expect(turmas.list).not.toHaveBeenCalled();

    expect(el(fixture).querySelector('app-minha-pontuacao-card')).not.toBeNull();
    expect(el(fixture).textContent).toContain('700 pts');

    expect(abas(fixture).map((b) => b.textContent?.trim())).toEqual([
      'Turma A',
      'Turma B',
      'Global',
    ]);
  });

  it('abre na primeira turma com a posição fixa vinda de /ranking/me', async () => {
    const ranking = buildRankingMock();
    const fixture = await createFixture('ALUNO', ranking);

    expect(ranking.porTurma).toHaveBeenCalledExactlyOnceWith('t1', { page: 1, pageSize: 20 });
    expect(ranking.global).not.toHaveBeenCalled();
    expect(abas(fixture)[0].getAttribute('aria-pressed')).toBe('true');
    expect(el(fixture).querySelector('.ranking__minha-posicao')?.textContent).toContain('3º');
  });

  it('aba Global consulta /ranking/global e mostra a posição global', async () => {
    const ranking = buildRankingMock();
    const fixture = await createFixture('ALUNO', ranking);

    abas(fixture)[2].click();
    await fixture.whenStable();

    expect(ranking.global).toHaveBeenCalledExactlyOnceWith({ page: 1, pageSize: 20 });
    expect(el(fixture).querySelector('.ranking__minha-posicao')?.textContent).toContain('12º');
  });

  it('destaca a própria linha quando o aluno aparece na página', async () => {
    const ranking = buildRankingMock();
    ranking.porTurma.mockReturnValue(
      of(buildPage({ data: [buildEntry(1), buildEntry(2, { alunoId: 'user-1' })] })),
    );
    const fixture = await createFixture('ALUNO', ranking);

    const me = el(fixture).querySelector('.rlista__item--me');
    expect(me).not.toBeNull();
    expect(me!.textContent).toContain('Você');
  });

  it('sem turmas: só a aba Global, já ativa', async () => {
    const ranking = buildRankingMock();
    ranking.me.mockReturnValue(of(buildMe({ turmas: [] })));
    const fixture = await createFixture('ALUNO', ranking);

    expect(abas(fixture).map((b) => b.textContent?.trim())).toEqual(['Global']);
    expect(ranking.global).toHaveBeenCalledExactlyOnceWith({ page: 1, pageSize: 20 });
  });

  it('falha em /ranking/me: alerta amigável, mas o ranking global ainda carrega', async () => {
    const ranking = buildRankingMock();
    ranking.me.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 500,
            error: { error: { code: 'INTERNAL', message: 'Erro inesperado no servidor.' } },
          }),
      ),
    );
    const fixture = await createFixture('ALUNO', ranking);

    expect(el(fixture).textContent).toContain('Erro inesperado no servidor.');
    expect(el(fixture).querySelector('app-minha-pontuacao-card')).toBeNull();
    expect(ranking.global).toHaveBeenCalledTimes(1);
    expect(el(fixture).querySelector('app-ranking-lista')).not.toBeNull();
  });
});

describe('RankingPage — PROFESSOR', () => {
  it('não chama /ranking/me nem mostra card pessoal; abas vêm das suas turmas', async () => {
    const ranking = buildRankingMock();
    const turmas = buildTurmasMock();
    const fixture = await createFixture('PROFESSOR', ranking, turmas);

    expect(ranking.me).not.toHaveBeenCalled();
    expect(turmas.list).toHaveBeenCalledExactlyOnceWith({ page: 1, pageSize: 100, sort: 'nome' });
    expect(el(fixture).querySelector('app-minha-pontuacao-card')).toBeNull();
    expect(el(fixture).querySelector('.ranking__minha-posicao')).toBeNull();

    expect(abas(fixture).map((b) => b.textContent?.trim())).toEqual([
      'Turma A',
      'Turma B',
      'Global',
    ]);
    expect(ranking.porTurma).toHaveBeenCalledExactlyOnceWith('t1', { page: 1, pageSize: 20 });
  });

  it('nenhuma linha ganha o badge "Você" (professor não está no ranking)', async () => {
    const ranking = buildRankingMock();
    ranking.porTurma.mockReturnValue(
      of(buildPage({ data: [buildEntry(1, { alunoId: 'user-1' })] })),
    );
    const fixture = await createFixture('PROFESSOR', ranking);

    expect(el(fixture).querySelector('.rlista__item--me')).toBeNull();
  });

  it('falha ao listar turmas: alerta, mas resta a aba Global funcionando', async () => {
    const ranking = buildRankingMock();
    const turmas: TurmasMock = { list: vi.fn(() => throwError(() => forbidden())) };
    const fixture = await createFixture('PROFESSOR', ranking, turmas);

    expect(el(fixture).querySelector('[role="alert"]')).not.toBeNull();
    expect(abas(fixture).map((b) => b.textContent?.trim())).toEqual(['Global']);
    expect(ranking.global).toHaveBeenCalledTimes(1);
  });
});

describe('RankingPage — estados e erros do ranking', () => {
  it('turma sem alunos: mensagem de vazio no lugar da lista', async () => {
    const ranking = buildRankingMock();
    ranking.porTurma.mockReturnValue(of(buildPage({ data: [], total: 0 })));
    const fixture = await createFixture('ALUNO', ranking);

    expect(el(fixture).textContent).toContain('Esta turma ainda não tem alunos no ranking.');
    expect(el(fixture).querySelector('app-ranking-lista')).toBeNull();
  });

  it('global vazio: mensagem própria', async () => {
    const ranking = buildRankingMock();
    ranking.me.mockReturnValue(of(buildMe({ turmas: [] })));
    ranking.global.mockReturnValue(of(buildPage({ data: [], total: 0 })));
    const fixture = await createFixture('ALUNO', ranking);

    expect(el(fixture).textContent).toContain('Ainda não há alunos no ranking.');
  });

  it('mostra o carregamento enquanto o ranking não chega', async () => {
    const ranking = buildRankingMock();
    ranking.porTurma.mockReturnValue(new Subject());
    const fixture = await createFixture('ALUNO', ranking);

    expect(el(fixture).textContent).toContain('Carregando ranking…');
    expect(el(fixture).querySelector('app-ranking-lista')).toBeNull();
  });

  it('403 na turma vira mensagem amigável específica', async () => {
    const ranking = buildRankingMock();
    ranking.porTurma.mockReturnValue(throwError(() => forbidden()));
    const fixture = await createFixture('ALUNO', ranking);

    expect(el(fixture).querySelector('[role="alert"]')?.textContent).toContain(
      'Você não tem acesso ao ranking desta turma.',
    );
  });

  it('404 na turma vira "Turma não encontrada."', async () => {
    const ranking = buildRankingMock();
    ranking.porTurma.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 404,
            error: { error: { code: 'NOT_FOUND', message: 'Turma não existe.' } },
          }),
      ),
    );
    const fixture = await createFixture('ALUNO', ranking);

    expect(el(fixture).querySelector('[role="alert"]')?.textContent).toContain(
      'Turma não encontrada.',
    );
  });

  it('trocar de aba reseta a página; paginação pede a página seguinte do mesmo escopo', async () => {
    const ranking = buildRankingMock();
    ranking.porTurma.mockReturnValue(of(buildPage({ total: 45 })));
    const fixture = await createFixture('ALUNO', ranking);

    const proxima = Array.from(
      el(fixture).querySelectorAll<HTMLButtonElement>('.rlista__pagination button'),
    ).find((b) => b.textContent?.includes('Próxima'))!;
    proxima.click();
    await fixture.whenStable();

    expect(ranking.porTurma).toHaveBeenLastCalledWith('t1', { page: 2, pageSize: 20 });

    abas(fixture)[1].click();
    await fixture.whenStable();
    expect(ranking.porTurma).toHaveBeenLastCalledWith('t2', { page: 1, pageSize: 20 });
  });
});
