import { signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { UsersService } from '../../core/auth/users.service';
import type { User } from '../../core/auth/auth.models';
import { ThemeSwitcher } from './theme-switcher';

/**
 * Seletor de tema (glassmorphism-ui.md §4): 4 temas + "Sistema" com
 * aria-pressed, aplicação global via data-theme + persistência em guia.theme,
 * "Sistema" removendo a chave e voltando a seguir prefers-color-scheme
 * reativamente; variantes compact (sidebar) e expanded (perfil).
 */

const STORAGE_KEY = 'guia.theme';
const ORDEM = ['Azul', 'Verde', 'Claro', 'Escuro', 'Sistema'];

interface FakeMediaQueryList {
  matches: boolean;
  addEventListener: (type: string, listener: (event: { matches: boolean }) => void) => void;
  removeEventListener: (type: string, listener: (event: { matches: boolean }) => void) => void;
}

/** jsdom não implementa matchMedia; instala um fake controlável (com
 * removeEventListener: o service remove o listener no DestroyRef). */
function stubMatchMedia(dark: boolean): {
  emitChange: (matches: boolean) => void;
  restore: () => void;
} {
  const listeners: Array<(event: { matches: boolean }) => void> = [];
  const query: FakeMediaQueryList = {
    matches: dark,
    addEventListener: (_type, listener) => listeners.push(listener),
    removeEventListener: (_type, listener) => {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    },
  };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockReturnValue(query),
  });
  return {
    emitChange: (matches) => {
      query.matches = matches;
      listeners.forEach((listener) => listener({ matches }));
    },
    restore: () => {
      delete (window as unknown as Record<string, unknown>)['matchMedia'];
    },
  };
}

async function createFixture(
  variant: 'compact' | 'expanded' = 'compact',
): Promise<ComponentFixture<ThemeSwitcher>> {
  TestBed.configureTestingModule({ imports: [ThemeSwitcher] });
  const fixture = TestBed.createComponent(ThemeSwitcher);
  fixture.componentRef.setInput('variant', variant);
  await fixture.whenStable();
  return fixture;
}

function botoes(fixture: ComponentFixture<ThemeSwitcher>): HTMLButtonElement[] {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
      'button[aria-pressed]',
    ),
  );
}

function botaoDoTema(fixture: ComponentFixture<ThemeSwitcher>, nome: string): HTMLButtonElement {
  const btn = botoes(fixture).find(
    (b) => b.getAttribute('aria-label') === `Tema ${nome}` || b.textContent?.includes(nome),
  );
  if (!btn) throw new Error(`Opção "${nome}" não encontrada`);
  return btn;
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('ThemeSwitcher — estrutura e a11y', () => {
  it('expõe grupo com 5 opções na ordem Azul/Verde/Claro/Escuro/Sistema', async () => {
    const fixture = await createFixture();

    const grupo = (fixture.nativeElement as HTMLElement).querySelector(
      '[role="group"][aria-label="Tema de cor"]',
    );
    expect(grupo).not.toBeNull();

    const opcoes = botoes(fixture);
    expect(opcoes).toHaveLength(5);
    expect(opcoes.map((b) => b.getAttribute('aria-label'))).toEqual(
      ORDEM.map((nome) => `Tema ${nome}`),
    );
    // swatches decorativos fora da árvore de acessibilidade
    for (const btn of opcoes) {
      expect(btn.querySelector('.switcher__swatch')?.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('sem escolha salva, apenas "Sistema" está com aria-pressed=true (com check visível)', async () => {
    const fixture = await createFixture();

    expect(botoes(fixture).map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'false',
      'false',
      'false',
      'false',
      'true',
    ]);
    // ativo marcado também por ícone, não só por cor (§5)
    expect(botaoDoTema(fixture, 'Sistema').querySelector('.switcher__check')).not.toBeNull();
    expect(botaoDoTema(fixture, 'Azul').querySelector('.switcher__check')).toBeNull();
  });

  it('variante expanded mostra os rótulos visíveis (sem aria-label redundante)', async () => {
    const fixture = await createFixture('expanded');

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.switcher--expanded')).not.toBeNull();
    const labels = Array.from(host.querySelectorAll('.switcher__label')).map((l) =>
      l.textContent?.trim(),
    );
    expect(labels).toEqual(ORDEM);
    for (const btn of botoes(fixture)) {
      expect(btn.getAttribute('aria-label')).toBeNull();
      // [attr.title] com null OMITE o atributo (antes [title]="" emitia
      // title vazio — comportamento incorreto apontado no code review)
      expect(btn.getAttribute('title')).toBeNull();
    }
  });

  it('variante compact não mostra rótulos visíveis; nome acessível via aria-label/title', async () => {
    const fixture = await createFixture('compact');

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.switcher--expanded')).toBeNull();
    expect(host.querySelectorAll('.switcher__label')).toHaveLength(0);
    expect(botaoDoTema(fixture, 'Verde').getAttribute('title')).toBe('Verde');
  });
});

describe('ThemeSwitcher — aplicar e persistir', () => {
  it.each(['azul', 'verde', 'claro', 'escuro'] as const)(
    'clicar em "%s" aplica data-theme global, persiste e move o aria-pressed',
    async (tema) => {
      const fixture = await createFixture();
      const nome = tema.charAt(0).toUpperCase() + tema.slice(1);

      botaoDoTema(fixture, nome).click();
      await fixture.whenStable();

      expect(document.documentElement.getAttribute('data-theme')).toBe(tema);
      expect(localStorage.getItem(STORAGE_KEY)).toBe(tema);
      expect(botaoDoTema(fixture, nome).getAttribute('aria-pressed')).toBe('true');
      expect(botaoDoTema(fixture, 'Sistema').getAttribute('aria-pressed')).toBe('false');
      expect(botaoDoTema(fixture, nome).querySelector('.switcher__check')).not.toBeNull();
    },
  );

  it('"Sistema" remove a chave e volta a seguir prefers-color-scheme reativamente', async () => {
    const media = stubMatchMedia(true); // SO em dark
    try {
      const fixture = await createFixture();

      botaoDoTema(fixture, 'Verde').click();
      await fixture.whenStable();
      expect(localStorage.getItem(STORAGE_KEY)).toBe('verde');

      botaoDoTema(fixture, 'Sistema').click();
      await fixture.whenStable();

      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
      expect(document.documentElement.getAttribute('data-theme')).toBe('escuro');

      // segue mudanças do SO em runtime enquanto for "Sistema"
      media.emitChange(false);
      await fixture.whenStable();
      expect(document.documentElement.getAttribute('data-theme')).toBe('claro');
    } finally {
      media.restore();
    }
  });
});

describe('Perfil — card Aparência', () => {
  it('renderiza o switcher na variante expanded dentro do card Aparência', async () => {
    const user: User = {
      id: 'user-1',
      nome: 'Maria Silva',
      email: 'maria@example.com',
      role: 'ALUNO',
      status: 'ATIVO',
      origem: 'PROPRIO',
      ultimoLoginAt: null,
      createdAt: '2026-07-07T12:00:00.000Z',
      updatedAt: '2026-07-07T12:00:00.000Z',
    };
    const { default: Perfil } = await import('../../features/perfil/perfil');
    TestBed.configureTestingModule({
      imports: [Perfil],
      providers: [
        { provide: AuthService, useValue: { currentUser: signal(user), setUser: vi.fn() } },
        { provide: UsersService, useValue: { getMe: vi.fn(() => of(user)) } },
      ],
    });
    const fixture = TestBed.createComponent(Perfil);
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    const cardAparencia = Array.from(host.querySelectorAll('.card')).find((c) =>
      c.querySelector('h2')?.textContent?.includes('Aparência'),
    );
    expect(cardAparencia).toBeTruthy();
    const switcher = cardAparencia!.querySelector('app-theme-switcher .switcher--expanded');
    expect(switcher).not.toBeNull();
    expect(switcher!.querySelectorAll('button[aria-pressed]')).toHaveLength(5);
  });
});
