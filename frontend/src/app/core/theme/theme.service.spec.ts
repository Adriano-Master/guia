import { TestBed } from '@angular/core/testing';

import { ThemeService } from './theme.service';
import type { ThemeName } from './theme.service';

/**
 * Testes do ThemeService (glassmorphism-ui.md §3–§4, estende pwa-frontend §2):
 * 4 temas (azul/verde/claro/escuro) + "system" seguindo prefers-color-scheme
 * reativamente, persistência em localStorage ('guia.theme'), migração dos
 * valores legados light/dark, aplicação via data-theme no <html>, metas
 * theme-color por tema e robustez com storage indisponível (modo privado).
 */

const STORAGE_KEY = 'guia.theme';

// stop mais escuro (mais claro no tema claro) do --bg-gradient de cada tema
const THEME_COLORS: Record<ThemeName, string> = {
  azul: '#0a1836',
  verde: '#052e21',
  claro: '#f4f7fb',
  escuro: '#0b0f16',
};

function createService(): ThemeService {
  return TestBed.inject(ThemeService);
}

function dataTheme(): string | null {
  return document.documentElement.getAttribute('data-theme');
}

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

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('ThemeService — default e boot', () => {
  it('sem chave no localStorage → "system"; sem matchMedia (jsdom) resolve para claro', () => {
    const service = createService();

    expect(service.preference()).toBe('system');
    expect(service.label()).toBe('sistema');
    expect(service.effective()).toBe('claro');
    // system agora resolve e aplica o tema efetivo no <html> (antes ficava
    // sem data-theme e a media query do CSS decidia)
    expect(dataTheme()).toBe('claro');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('sem chave e sistema em dark → resolve para escuro', () => {
    const media = stubMatchMedia(true);
    try {
      const service = createService();

      expect(service.preference()).toBe('system');
      expect(service.effective()).toBe('escuro');
      expect(dataTheme()).toBe('escuro');
    } finally {
      media.restore();
    }
  });

  it.each(['azul', 'verde', 'claro', 'escuro'] as const)(
    'restaura "%s" persistido no boot e aplica data-theme',
    (stored) => {
      localStorage.setItem(STORAGE_KEY, stored);

      const service = createService();

      expect(service.preference()).toBe(stored);
      expect(service.effective()).toBe(stored);
      expect(dataTheme()).toBe(stored);
    },
  );

  it('valor inválido persistido → cai para "system" e remove a chave', () => {
    localStorage.setItem(STORAGE_KEY, 'roxo');

    const service = createService();

    expect(service.preference()).toBe('system');
    expect(dataTheme()).toBe('claro');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe('ThemeService — migração dos valores legados (light/dark/system)', () => {
  it.each([
    ['light', 'claro'],
    ['dark', 'escuro'],
  ] as const)('"%s" persistido migra para "%s" e regrava o storage', (legacy, migrated) => {
    localStorage.setItem(STORAGE_KEY, legacy);

    const service = createService();

    expect(service.preference()).toBe(migrated);
    expect(dataTheme()).toBe(migrated);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(migrated);
  });

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'chave herdada do protótipo "%s" NÃO migra (Object.hasOwn) → system e chave removida',
    (valor) => {
      localStorage.setItem(STORAGE_KEY, valor);

      const service = createService();

      expect(service.preference()).toBe('system');
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
      expect(dataTheme()).toBe('claro');
    },
  );

  it('"system" legado persistido → remove a chave e segue o sistema', () => {
    localStorage.setItem(STORAGE_KEY, 'system');

    const service = createService();

    expect(service.preference()).toBe('system');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe('ThemeService — setPreference() e persistência', () => {
  it.each(['azul', 'verde', 'claro', 'escuro'] as const)(
    'escolher "%s" aplica data-theme e persiste em guia.theme',
    (theme) => {
      const service = createService();

      service.setPreference(theme);

      expect(service.preference()).toBe(theme);
      expect(service.label()).toBe(theme);
      expect(dataTheme()).toBe(theme);
      expect(localStorage.getItem(STORAGE_KEY)).toBe(theme);
    },
  );

  it('voltar para "system" remove a chave e volta a seguir o sistema', () => {
    const service = createService();
    service.setPreference('verde');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('verde');

    service.setPreference('system');

    expect(service.preference()).toBe('system');
    expect(service.label()).toBe('sistema');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(dataTheme()).toBe('claro');
  });
});

describe('ThemeService — reatividade a prefers-color-scheme', () => {
  it('em "system", mudança do esquema do SO troca o tema efetivo em runtime', () => {
    const media = stubMatchMedia(false);
    try {
      const service = createService();
      expect(dataTheme()).toBe('claro');

      media.emitChange(true);

      expect(service.effective()).toBe('escuro');
      expect(dataTheme()).toBe('escuro');
    } finally {
      media.restore();
    }
  });

  it('com tema escolhido, mudança do esquema do SO não interfere', () => {
    const media = stubMatchMedia(false);
    try {
      const service = createService();
      service.setPreference('azul');

      media.emitChange(true);

      expect(service.effective()).toBe('azul');
      expect(dataTheme()).toBe('azul');
    } finally {
      media.restore();
    }
  });
});

describe('ThemeService — localStorage indisponível (modo privado)', () => {
  it('getItem lança no boot → assume "system" sem quebrar', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage bloqueado');
    });

    const service = createService();

    expect(service.preference()).toBe('system');
    expect(dataTheme()).toBe('claro');
  });

  it('setItem lança → tema ainda é aplicado na sessão atual, sem persistir', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage bloqueado');
    });
    const service = createService();

    expect(() => service.setPreference('escuro')).not.toThrow();
    expect(service.preference()).toBe('escuro');
    expect(dataTheme()).toBe('escuro');
  });

  it('removeItem lança ao voltar para "system" → não quebra e resolve o tema do sistema', () => {
    const service = createService();
    service.setPreference('escuro');

    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage bloqueado');
    });

    expect(() => service.setPreference('system')).not.toThrow();
    expect(service.preference()).toBe('system');
    expect(dataTheme()).toBe('claro');
  });
});

describe('ThemeService — metas theme-color (regressão do code review)', () => {
  const LIGHT = THEME_COLORS.claro;
  const DARK = THEME_COLORS.escuro;
  let metaLight: HTMLMetaElement;
  let metaDark: HTMLMetaElement;

  beforeEach(() => {
    // replica as metas de index.html (fallback pré-boot)
    metaLight = document.createElement('meta');
    metaLight.name = 'theme-color';
    metaLight.content = LIGHT;
    metaDark = document.createElement('meta');
    metaDark.name = 'theme-color';
    metaDark.content = DARK;
    metaDark.setAttribute('media', '(prefers-color-scheme: dark)');
    document.head.append(metaLight, metaDark);
  });

  afterEach(() => {
    metaLight.remove();
    metaDark.remove();
  });

  it.each(['azul', 'verde', 'claro', 'escuro'] as const)(
    'escolha manual de "%s" → as duas metas recebem a cor do tema',
    (theme) => {
      const service = createService();

      service.setPreference(theme);

      expect(metaLight.getAttribute('content')).toBe(THEME_COLORS[theme]);
      expect(metaDark.getAttribute('content')).toBe(THEME_COLORS[theme]);
    },
  );

  it('voltar para system restaura as cores por media query de index.html', () => {
    const service = createService();
    service.setPreference('escuro');
    expect(metaLight.getAttribute('content')).toBe(DARK);

    service.setPreference('system');

    expect(metaLight.getAttribute('content')).toBe(LIGHT);
    expect(metaDark.getAttribute('content')).toBe(DARK);
  });

  it('boot com preferência persistida já ajusta as metas', () => {
    localStorage.setItem(STORAGE_KEY, 'azul');

    createService();

    expect(metaLight.getAttribute('content')).toBe(THEME_COLORS.azul);
    expect(metaDark.getAttribute('content')).toBe(THEME_COLORS.azul);
  });

  it('sem metas theme-color no documento → não quebra', () => {
    metaLight.remove();
    metaDark.remove();

    const service = createService();
    expect(() => service.setPreference('escuro')).not.toThrow();
    expect(document.documentElement.getAttribute('data-theme')).toBe('escuro');
  });
});
