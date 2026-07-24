import { DOCUMENT, DestroyRef, Injectable, computed, inject, signal } from '@angular/core';

export const THEME_NAMES = ['azul', 'verde', 'claro', 'escuro'] as const;
export type ThemeName = (typeof THEME_NAMES)[number];
export type ThemePreference = ThemeName | 'system';

const STORAGE_KEY = 'guia.theme';

// Migração dos valores persistidos pelo modelo antigo claro/escuro
// (glassmorphism-ui.md); espelhada no script inline de index.html.
const LEGACY_VALUES: Record<string, ThemeName> = { light: 'claro', dark: 'escuro' };

// Mesmos valores das metas theme-color de index.html (fallback pré-boot):
// stop mais escuro do --bg-gradient de cada tema (mais claro no tema claro).
const THEME_COLORS: Record<ThemeName, string> = {
  azul: '#0a1836',
  verde: '#052e21',
  claro: '#f4f7fb',
  escuro: '#0b0f16',
};

/**
 * Preferência de tema (azul/verde/claro/escuro/system) aplicada via atributo
 * `data-theme` no <html>. O script inline em index.html aplica o valor
 * persistido antes do primeiro render para evitar flash.
 *
 * "system" segue prefers-color-scheme reativamente (dark→escuro, claro caso
 * contrário) e não persiste chave; escolher um dos 4 temas persiste e para de
 * seguir o sistema (glassmorphism-ui.md §4).
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly systemDark = signal(this.matchesSystemDark());
  private readonly preferenceSignal = signal<ThemePreference>(this.restore());

  readonly preference = this.preferenceSignal.asReadonly();

  /** Tema efetivamente aplicado (resolve "system" para claro/escuro). */
  readonly effective = computed<ThemeName>(() => {
    const preference = this.preferenceSignal();
    if (preference === 'system') return this.systemDark() ? 'escuro' : 'claro';
    return preference;
  });

  readonly label = computed(() =>
    this.preferenceSignal() === 'system' ? 'sistema' : this.preferenceSignal(),
  );

  constructor() {
    this.apply();
    this.listenToSystemScheme();
  }

  setPreference(preference: ThemePreference): void {
    this.preferenceSignal.set(preference);
    try {
      if (preference === 'system') {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, preference);
      }
    } catch {
      // storage indisponível (ex.: modo privado); só não persiste
    }
    this.apply();
  }

  private apply(): void {
    this.document.documentElement.setAttribute('data-theme', this.effective());
    this.updateThemeColorMetas();
  }

  /**
   * Reage a mudanças do esquema do SO enquanto a preferência for "system"
   * (sem chave salva). jsdom não implementa matchMedia → guarda defensiva.
   */
  private listenToSystemScheme(): void {
    const query = this.systemDarkQuery();
    if (!query) return;
    const onChange = (event: MediaQueryListEvent): void => {
      this.systemDark.set(event.matches);
      if (this.preferenceSignal() === 'system') this.apply();
    };
    query.addEventListener('change', onChange);
    this.destroyRef.onDestroy(() => query.removeEventListener('change', onChange));
  }

  /**
   * Mantém as metas theme-color coerentes com o tema efetivo: escolha manual
   * força a mesma cor nas duas; "system" restaura os valores por media query
   * de index.html (que continuam como fallback antes do boot).
   */
  private updateThemeColorMetas(): void {
    const preference = this.preferenceSignal();
    const metas = this.document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
    metas.forEach((meta) => {
      if (preference === 'system') {
        const media = meta.getAttribute('media') ?? '';
        meta.setAttribute(
          'content',
          media.includes('dark') ? THEME_COLORS.escuro : THEME_COLORS.claro,
        );
      } else {
        meta.setAttribute('content', THEME_COLORS[preference]);
      }
    });
  }

  private restore(): ThemePreference {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === null) return 'system';
      if ((THEME_NAMES as readonly string[]).includes(stored)) return stored as ThemeName;
      // Object.hasOwn evita lookup na cadeia de protótipos ('constructor'…)
      if (Object.hasOwn(LEGACY_VALUES, stored)) {
        const migrated = LEGACY_VALUES[stored];
        if ((THEME_NAMES as readonly string[]).includes(migrated)) {
          localStorage.setItem(STORAGE_KEY, migrated);
          return migrated;
        }
      }
      // 'system' antigo ou valor inválido: sem chave = seguir o sistema
      localStorage.removeItem(STORAGE_KEY);
      return 'system';
    } catch {
      return 'system';
    }
  }

  private matchesSystemDark(): boolean {
    return this.systemDarkQuery()?.matches === true;
  }

  private systemDarkQuery(): MediaQueryList | undefined {
    return this.document.defaultView?.matchMedia?.('(prefers-color-scheme: dark)');
  }
}
