import { HttpErrorResponse } from '@angular/common/http';
import { computed, signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { throwError } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import type { Role, User } from '../../core/auth/auth.models';
import type { ImpersonationState } from '../../core/auth/impersonation.service';
import { ImpersonationService } from '../../core/auth/impersonation.service';
import { SessaoService } from '../../features/sessoes/sessoes.service';
import { Shell } from './shell';

/**
 * Testes do Shell (pwa-frontend.md §3 e §5): links do menu por role (sem
 * links para features inexistentes), drawer com hambúrguer/Escape/overlay
 * e devolução de foco, colapso persistido em 'guia.sidebar-collapsed' e
 * skip-link apontando para o conteúdo principal.
 */

const SIDEBAR_KEY = 'guia.sidebar-collapsed';

// Rotas que existem hoje em app.routes.ts (nav não pode apontar para fora disso)
const ROTAS_EXISTENTES = [
  '/',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/perfil',
  '/planos',
  '/cronograma',
  '/sessoes',
  '/progresso',
  '/questoes',
  '/estatisticas',
  '/ranking',
  '/turmas',
  '/minhas-turmas',
  '/admin/usuarios',
];

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

interface AuthMock {
  currentUser: () => User | null;
  isAuthenticated: () => boolean;
  role: () => Role | null;
  isAdmin: () => boolean;
  logout: ReturnType<typeof vi.fn>;
}

function buildAuthMock(user: User | null): AuthMock {
  const userSignal = signal<User | null>(user);
  return {
    currentUser: userSignal.asReadonly(),
    isAuthenticated: computed(() => userSignal() !== null),
    role: computed(() => userSignal()?.role ?? null),
    isAdmin: computed(() => userSignal()?.role === 'ADMIN'),
    logout: vi.fn(),
  };
}

interface ImpersonationMock {
  state: ReturnType<typeof signal<ImpersonationState | null>>;
  ativo: () => boolean;
  aviso: ReturnType<typeof signal<string | null>>;
  sair: ReturnType<typeof vi.fn>;
  limparAviso: ReturnType<typeof vi.fn>;
}

function buildImpersonationMock(state: ImpersonationState | null = null): ImpersonationMock {
  const stateSignal = signal<ImpersonationState | null>(state);
  const avisoSignal = signal<string | null>(null);
  return {
    state: stateSignal,
    ativo: computed(() => stateSignal() !== null),
    aviso: avisoSignal,
    sair: vi.fn(() => stateSignal.set(null)),
    limparAviso: vi.fn(() => avisoSignal.set(null)),
  };
}

async function createFixture(
  user: User | null = null,
  impersonation: ImpersonationMock = buildImpersonationMock(),
): Promise<ComponentFixture<Shell>> {
  TestBed.configureTestingModule({
    imports: [Shell],
    providers: [
      // rota coringa para navegações de teste concluírem com NavigationEnd
      provideRouter([{ path: '**', children: [] }]),
      { provide: AuthService, useValue: buildAuthMock(user) },
      { provide: ImpersonationService, useValue: impersonation },
      // O shell injeta o SessaoAtivaService (widget do cronômetro no aside),
      // que hidrata via GET /sessoes/ativa quando há ALUNO autenticado. Sem
      // sessão ativa nestes testes: 404 = sem cronômetro (widget ausente).
      {
        provide: SessaoService,
        useValue: {
          getAtiva: vi.fn(() =>
            throwError(
              () =>
                new HttpErrorResponse({
                  status: 404,
                  error: { error: { code: 'NOT_FOUND', message: 'Sem cronômetro.' } },
                }),
            ),
          ),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(Shell);
  await fixture.whenStable();
  return fixture;
}

function element(fixture: ComponentFixture<Shell>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function hrefsDaSidebar(fixture: ComponentFixture<Shell>): string[] {
  return Array.from(
    element(fixture).querySelectorAll<HTMLAnchorElement>('.shell__sidebar a[href]'),
  ).map((a) => a.getAttribute('href') ?? '');
}

function textosDoNav(fixture: ComponentFixture<Shell>): string[] {
  return Array.from(element(fixture).querySelectorAll<HTMLAnchorElement>('.shell__nav a')).map(
    (a) => a.textContent?.trim() ?? '',
  );
}

function hamburgerDe(fixture: ComponentFixture<Shell>): HTMLButtonElement {
  const btn = element(fixture).querySelector<HTMLButtonElement>(
    '.shell__topbar button[aria-controls="shell-sidebar"]',
  );
  if (!btn) throw new Error('Botão hambúrguer não encontrado no topbar');
  return btn;
}

function sidebarDe(fixture: ComponentFixture<Shell>): HTMLElement {
  const aside = element(fixture).querySelector<HTMLElement>('#shell-sidebar');
  if (!aside) throw new Error('Sidebar não encontrada');
  return aside;
}

async function abrirDrawer(fixture: ComponentFixture<Shell>): Promise<void> {
  hamburgerDe(fixture).click();
  await fixture.whenStable();
  // flush do setTimeout que move o foco para dentro do drawer
  await new Promise((resolve) => setTimeout(resolve));
}

// data-theme não é mais tocado aqui: o seletor de tema saiu do shell (perfil).
beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.body.style.overflow = '';
});

describe('Shell — links por role', () => {
  it('deslogado: nav só tem Início; footer oferece Entrar e Criar conta', async () => {
    const fixture = await createFixture(null);

    expect(textosDoNav(fixture)).toEqual(['Início']);

    const hrefs = hrefsDaSidebar(fixture);
    expect(hrefs).toContain('/login');
    expect(hrefs).toContain('/register');
    expect(hrefs).not.toContain('/planos');
    expect(hrefs).not.toContain('/perfil');
    expect(hrefs).not.toContain('/cronograma');
    expect(hrefs).not.toContain('/sessoes');
    expect(hrefs).not.toContain('/progresso');
    expect(hrefs).not.toContain('/questoes');
    expect(hrefs).not.toContain('/turmas');
    expect(hrefs).not.toContain('/minhas-turmas');
    expect(hrefs).not.toContain('/admin/usuarios');
    // sem botão Sair
    expect(element(fixture).textContent).not.toContain('Sair');
  });

  it('ALUNO: Início, Calendário, Estudar, Progresso, Questões, Estatísticas, Ranking, Minhas turmas, Planos e Perfil — sem área admin', async () => {
    const fixture = await createFixture(buildUser('ALUNO'));

    expect(textosDoNav(fixture)).toEqual([
      'Início',
      'Calendário',
      'Estudar',
      'Progresso',
      'Questões',
      'Estatísticas',
      'Ranking',
      'Minhas turmas',
      'Planos',
      'Perfil',
    ]);

    const hrefs = hrefsDaSidebar(fixture);
    expect(hrefs).toContain('/cronograma');
    expect(hrefs).toContain('/sessoes');
    expect(hrefs).toContain('/progresso');
    expect(hrefs).toContain('/questoes');
    expect(hrefs).toContain('/estatisticas');
    expect(hrefs).toContain('/ranking');
    expect(hrefs).toContain('/minhas-turmas');
    expect(hrefs).not.toContain('/turmas');
    expect(hrefs).not.toContain('/admin/usuarios');
    expect(hrefs).not.toContain('/login');
    expect(hrefs).not.toContain('/register');
    // usuário logado vê o próprio nome e o Sair
    expect(element(fixture).textContent).toContain('Maria Silva');
    expect(element(fixture).textContent).toContain('Sair');
  });

  it('ADMIN: vê Turmas e Usuários e não vê Calendário/Estudar/Progresso/Questões (rotas de ALUNO) nem Ranking', async () => {
    const fixture = await createFixture(buildUser('ADMIN'));

    expect(textosDoNav(fixture)).toEqual(['Início', 'Turmas', 'Planos', 'Perfil', 'Usuários']);

    const hrefs = hrefsDaSidebar(fixture);
    expect(hrefs).toContain('/admin/usuarios');
    expect(hrefs).toContain('/turmas');
    expect(hrefs).not.toContain('/minhas-turmas');
    expect(hrefs).not.toContain('/cronograma');
    expect(hrefs).not.toContain('/sessoes');
    expect(hrefs).not.toContain('/progresso');
    expect(hrefs).not.toContain('/questoes');
    expect(hrefs).not.toContain('/estatisticas');
    expect(hrefs).not.toContain('/ranking');
  });

  it('PROFESSOR: vê Turmas e Ranking (US-05 de gamificação), sem área admin', async () => {
    const fixture = await createFixture(buildUser('PROFESSOR'));

    expect(textosDoNav(fixture)).toEqual(['Início', 'Turmas', 'Ranking', 'Planos', 'Perfil']);

    const hrefs = hrefsDaSidebar(fixture);
    expect(hrefs).toContain('/turmas');
    expect(hrefs).toContain('/ranking');
    expect(hrefs).not.toContain('/admin/usuarios');
    expect(hrefs).not.toContain('/minhas-turmas');
    expect(hrefs).not.toContain('/estatisticas');
  });

  it('nunca exibe links para rotas inexistentes', async () => {
    for (const role of [null, 'ALUNO', 'PROFESSOR', 'ADMIN'] as const) {
      const fixture = await createFixture(role ? buildUser(role) : null);
      for (const href of hrefsDaSidebar(fixture)) {
        expect(ROTAS_EXISTENTES, `link "${href}" (role=${role ?? 'anônimo'})`).toContain(href);
      }
      TestBed.resetTestingModule();
    }
  });
});

describe('Shell — drawer mobile (hambúrguer, Escape, overlay)', () => {
  it('hambúrguer abre o drawer com aria-expanded=true e overlay visível', async () => {
    const fixture = await createFixture(buildUser('ALUNO'));
    const hamburger = hamburgerDe(fixture);

    expect(hamburger.getAttribute('aria-expanded')).toBe('false');
    expect(element(fixture).querySelector('.shell__overlay')).toBeNull();

    await abrirDrawer(fixture);

    expect(hamburger.getAttribute('aria-expanded')).toBe('true');
    expect(sidebarDe(fixture).classList).toContain('shell__sidebar--open');
    expect(element(fixture).querySelector('.shell__overlay')).not.toBeNull();
    // foco movido para dentro do drawer (a11y)
    expect(sidebarDe(fixture).contains(document.activeElement)).toBe(true);
  });

  it('Escape fecha o drawer e devolve o foco ao hambúrguer', async () => {
    const fixture = await createFixture(buildUser('ALUNO'));
    await abrirDrawer(fixture);

    sidebarDe(fixture).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await fixture.whenStable();

    expect(hamburgerDe(fixture).getAttribute('aria-expanded')).toBe('false');
    expect(sidebarDe(fixture).classList).not.toContain('shell__sidebar--open');
    expect(element(fixture).querySelector('.shell__overlay')).toBeNull();
    expect(document.activeElement).toBe(hamburgerDe(fixture));
  });

  it('clique no overlay fecha o drawer', async () => {
    const fixture = await createFixture(buildUser('ALUNO'));
    await abrirDrawer(fixture);

    const overlay = element(fixture).querySelector<HTMLElement>('.shell__overlay');
    expect(overlay).not.toBeNull();
    overlay!.click();
    await fixture.whenStable();

    expect(hamburgerDe(fixture).getAttribute('aria-expanded')).toBe('false');
    expect(element(fixture).querySelector('.shell__overlay')).toBeNull();
  });

  it('navegação fecha o drawer sem roubar o foco de volta ao hambúrguer', async () => {
    const fixture = await createFixture(buildUser('ALUNO'));
    await abrirDrawer(fixture);

    await TestBed.inject(Router).navigate(['/planos']);
    await fixture.whenStable();

    expect(hamburgerDe(fixture).getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).not.toBe(hamburgerDe(fixture));
  });

  it('Tab no último focável do drawer circula para o primeiro (focus trap)', async () => {
    const fixture = await createFixture(buildUser('ALUNO'));
    await abrirDrawer(fixture);

    const focaveis = Array.from(
      sidebarDe(fixture).querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
    );
    const primeiro = focaveis[0];
    const ultimo = focaveis[focaveis.length - 1];

    ultimo.focus();
    sidebarDe(fixture).dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    await fixture.whenStable();

    expect(document.activeElement).toBe(primeiro);
  });
});

describe('Shell — drawer como diálogo modal (regressão do code review)', () => {
  it('fechado: aside sem role/aria-modal, main sem inert e body com scroll livre', async () => {
    const fixture = await createFixture(buildUser('ALUNO'));

    const aside = sidebarDe(fixture);
    const main = element(fixture).querySelector<HTMLElement>('main#conteudo')!;

    expect(aside.getAttribute('role')).toBeNull();
    expect(aside.getAttribute('aria-modal')).toBeNull();
    expect(main.hasAttribute('inert')).toBe(false);
    expect(document.body.style.overflow).toBe('');
  });

  it('aberto: aside vira role=dialog/aria-modal, main fica inert e body trava o scroll', async () => {
    const fixture = await createFixture(buildUser('ALUNO'));
    await abrirDrawer(fixture);

    const aside = sidebarDe(fixture);
    const main = element(fixture).querySelector<HTMLElement>('main#conteudo')!;

    expect(aside.getAttribute('role')).toBe('dialog');
    expect(aside.getAttribute('aria-modal')).toBe('true');
    expect(main.hasAttribute('inert')).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('fechar (Escape) remove dialog/aria-modal/inert e destrava o scroll do body', async () => {
    const fixture = await createFixture(buildUser('ALUNO'));
    await abrirDrawer(fixture);

    sidebarDe(fixture).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await fixture.whenStable();

    const aside = sidebarDe(fixture);
    const main = element(fixture).querySelector<HTMLElement>('main#conteudo')!;
    expect(aside.getAttribute('role')).toBeNull();
    expect(aside.getAttribute('aria-modal')).toBeNull();
    expect(main.hasAttribute('inert')).toBe(false);
    expect(document.body.style.overflow).toBe('');
  });

  it('destruição do componente com drawer aberto destrava o scroll (onCleanup)', async () => {
    const fixture = await createFixture(buildUser('ALUNO'));
    await abrirDrawer(fixture);
    expect(document.body.style.overflow).toBe('hidden');

    fixture.destroy();

    expect(document.body.style.overflow).toBe('');
  });
});

describe('Shell — colapso persistido', () => {
  it('recolher persiste "1" em guia.sidebar-collapsed; expandir persiste "0"', async () => {
    const fixture = await createFixture(buildUser('ALUNO'));
    const shellDiv = element(fixture).querySelector('.shell')!;
    const collapseBtn = element(fixture).querySelector<HTMLButtonElement>('.shell__collapse')!;

    expect(shellDiv.classList).not.toContain('shell--collapsed');
    expect(collapseBtn.getAttribute('aria-expanded')).toBe('true');

    collapseBtn.click();
    await fixture.whenStable();

    expect(shellDiv.classList).toContain('shell--collapsed');
    expect(collapseBtn.getAttribute('aria-expanded')).toBe('false');
    expect(localStorage.getItem(SIDEBAR_KEY)).toBe('1');

    collapseBtn.click();
    await fixture.whenStable();

    expect(shellDiv.classList).not.toContain('shell--collapsed');
    expect(localStorage.getItem(SIDEBAR_KEY)).toBe('0');
  });

  it('boot com guia.sidebar-collapsed=1 restaura o estado recolhido', async () => {
    localStorage.setItem(SIDEBAR_KEY, '1');

    const fixture = await createFixture(buildUser('ALUNO'));

    expect(element(fixture).querySelector('.shell')!.classList).toContain('shell--collapsed');
  });

  it('localStorage indisponível → colapsa na sessão sem quebrar', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage bloqueado');
    });
    const fixture = await createFixture(buildUser('ALUNO'));

    const collapseBtn = element(fixture).querySelector<HTMLButtonElement>('.shell__collapse')!;
    expect(() => collapseBtn.click()).not.toThrow();
    await fixture.whenStable();

    expect(element(fixture).querySelector('.shell')!.classList).toContain('shell--collapsed');
  });
});

describe('Shell — a11y básicos e ações', () => {
  it('skip-link presente aponta para #conteudo, que existe e é focável', async () => {
    const fixture = await createFixture(null);

    const skip = element(fixture).querySelector<HTMLAnchorElement>('a.skip-link');
    expect(skip).not.toBeNull();
    expect(skip!.getAttribute('href')).toBe('#conteudo');

    const conteudo = element(fixture).querySelector<HTMLElement>('main#conteudo');
    expect(conteudo).not.toBeNull();
    expect(conteudo!.getAttribute('tabindex')).toBe('-1');
  });

  it('clique no skip-link foca o #conteudo sem navegar (preventDefault)', async () => {
    const fixture = await createFixture(null);

    const skip = element(fixture).querySelector<HTMLAnchorElement>('a.skip-link')!;
    const clique = new MouseEvent('click', { bubbles: true, cancelable: true });
    skip.dispatchEvent(clique);
    await fixture.whenStable();

    // preventDefault: com <base href="/">, seguir o href navegaria p/ "/#conteudo"
    expect(clique.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(element(fixture).querySelector('main#conteudo'));
  });

  it('colapsado: labels ficam visually-hidden, presentes na árvore de acessibilidade', async () => {
    localStorage.setItem(SIDEBAR_KEY, '1');
    const fixture = await createFixture(buildUser('ALUNO'));

    const labels = Array.from(
      element(fixture).querySelectorAll<HTMLElement>('.shell__nav .shell__label'),
    );
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      // nome acessível preservado: sem hidden/aria-hidden/display:none inline
      expect(label.textContent?.trim()).not.toBe('');
      expect(label.hasAttribute('hidden')).toBe(false);
      expect(label.getAttribute('aria-hidden')).toBeNull();
      expect(label.style.display).not.toBe('none');
    }
    // cada link do nav mantém nome acessível via conteúdo (não depende de title)
    for (const link of element(fixture).querySelectorAll('.shell__nav a')) {
      expect(link.textContent?.trim()).not.toBe('');
    }
  });

  it('CSS do colapso esconde labels via clip-path (não display:none) e sem !important', async () => {
    await createFixture(buildUser('ALUNO'));

    const css = Array.from(document.querySelectorAll('style'))
      .map((style) => style.textContent ?? '')
      .join('\n');
    // regra compilada do componente (com atributos de escopo _ngcontent-*)
    const regra = css.match(/\.shell--collapsed[^{]*\.shell__label[^{]*\{[^}]*\}/);
    expect(regra, 'regra .shell--collapsed .shell__label não encontrada').not.toBeNull();
    const corpo = regra![0].replace(/\s+/g, '');
    expect(corpo).not.toContain('display:none');
    expect(corpo).toContain('clip-path');
    // shell.scss sem !important (achado do code review)
    const shellCss = css.match(/[^}]*shell[^{]*\{[^}]*\}/g)?.join('') ?? '';
    expect(shellCss).not.toContain('!important');
  });

  it('botão Sair chama AuthService.logout()', async () => {
    const fixture = await createFixture(buildUser('ALUNO'));
    const auth = TestBed.inject(AuthService) as unknown as AuthMock;

    const sair = Array.from(element(fixture).querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Sair'),
    );
    expect(sair).toBeTruthy();
    sair!.click();
    await fixture.whenStable();

    expect(auth.logout).toHaveBeenCalledTimes(1);
  });

  // O seletor de tema saiu do rodapé da sidebar: agora vive apenas no perfil
  // (variante expanded). Os dois testes que cobriam o switcher aqui foram
  // removidos sem perda de cobertura: theme-switcher.spec.ts cobre estrutura,
  // aria-pressed, aplicação de data-theme e persistência em guia.theme
  // (incluindo o card Aparência do perfil), e theme.service.spec.ts cobre o
  // ThemeService.
});

describe('Shell — banner de impersonação (modo de visualização de aluno)', () => {
  function bannerDe(fixture: ComponentFixture<Shell>): HTMLElement | null {
    return element(fixture).querySelector<HTMLElement>('.shell__impersonation');
  }

  it('sem impersonação ativa, o banner não existe', async () => {
    const fixture = await createFixture(buildUser('ADMIN'));

    expect(bannerDe(fixture)).toBeNull();
  });

  it('ativo: banner com role=status, nome do aluno, "(somente leitura)" e botão Voltar ao admin', async () => {
    const mock = buildImpersonationMock({ alunoNome: 'João Aluno', adminNome: 'Ana Admin' });
    const fixture = await createFixture(buildUser('ALUNO'), mock);

    const banner = bannerDe(fixture);
    expect(banner).not.toBeNull();
    expect(banner!.getAttribute('role')).toBe('status');
    const texto = banner!.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(texto).toContain('Visualizando como João Aluno (somente leitura)');
    expect(texto).toContain('Voltar ao admin');
  });

  it('botão "Voltar ao admin" chama sair() e o banner some', async () => {
    const mock = buildImpersonationMock({ alunoNome: 'João Aluno', adminNome: 'Ana Admin' });
    const fixture = await createFixture(buildUser('ALUNO'), mock);

    const botao = Array.from(bannerDe(fixture)!.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Voltar ao admin'),
    );
    expect(botao).toBeTruthy();
    botao!.click();
    await fixture.whenStable();

    expect(mock.sair).toHaveBeenCalledTimes(1);
    expect(bannerDe(fixture)).toBeNull();
  });

  it('aviso de expiração aparece após sair e o botão Ok o dispensa (limparAviso)', async () => {
    const mock = buildImpersonationMock(null);
    mock.aviso.set('A visualização expirou. Você voltou ao seu perfil de admin.');
    const fixture = await createFixture(buildUser('ADMIN'), mock);

    const aviso = element(fixture).querySelector<HTMLElement>('.shell__impersonation--aviso');
    expect(aviso).not.toBeNull();
    expect(aviso!.getAttribute('role')).toBe('status');
    expect(aviso!.textContent).toContain(
      'A visualização expirou. Você voltou ao seu perfil de admin.',
    );

    aviso!.querySelector('button')!.click();
    await fixture.whenStable();

    expect(mock.limparAviso).toHaveBeenCalledTimes(1);
    expect(element(fixture).querySelector('.shell__impersonation--aviso')).toBeNull();
  });

  it('Sair durante impersonação restaura o admin (sair) antes do logout', async () => {
    const mock = buildImpersonationMock({ alunoNome: 'João Aluno', adminNome: 'Ana Admin' });
    const fixture = await createFixture(buildUser('ALUNO'), mock);
    const auth = TestBed.inject(AuthService) as unknown as AuthMock;

    const sairBtn = Array.from(element(fixture).querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Sair',
    );
    expect(sairBtn).toBeTruthy();
    sairBtn!.click();
    await fixture.whenStable();

    expect(mock.sair).toHaveBeenCalledTimes(1);
    expect(auth.logout).toHaveBeenCalledTimes(1);
  });
});
