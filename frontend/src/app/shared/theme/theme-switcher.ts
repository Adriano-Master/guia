import { Component, inject, input } from '@angular/core';

import { ThemeService } from '../../core/theme/theme.service';
import type { ThemePreference } from '../../core/theme/theme.service';

interface ThemeOption {
  value: ThemePreference;
  label: string;
}

const OPTIONS: readonly ThemeOption[] = [
  { value: 'azul', label: 'Azul' },
  { value: 'verde', label: 'Verde' },
  { value: 'claro', label: 'Claro' },
  { value: 'escuro', label: 'Escuro' },
  { value: 'system', label: 'Sistema' },
];

/**
 * Seletor dos 4 temas + "Sistema" (glassmorphism-ui.md §4) com swatch de
 * pré-visualização (círculo com o gradiente do tema). Grupo de botões com
 * aria-pressed (em vez de radiogroup: cada botão fica alcançável por Tab sem
 * roving tabindex). Usado no rodapé da sidebar (compact) e no perfil
 * (expanded, com rótulos visíveis).
 */
@Component({
  selector: 'app-theme-switcher',
  template: `
    <div
      class="switcher"
      [class.switcher--expanded]="variant() === 'expanded'"
      role="group"
      aria-label="Tema de cor"
    >
      @for (option of options; track option.value) {
        <button
          type="button"
          class="switcher__option"
          [class.switcher__option--active]="theme.preference() === option.value"
          [attr.aria-pressed]="theme.preference() === option.value"
          [attr.aria-label]="variant() === 'compact' ? 'Tema ' + option.label : null"
          [attr.title]="variant() === 'compact' ? option.label : null"
          (click)="theme.setPreference(option.value)"
        >
          <span class="switcher__swatch switcher__swatch--{{ option.value }}" aria-hidden="true">
            @if (theme.preference() === option.value) {
              <svg class="switcher__check" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12.5 10 17.5 19 7" />
              </svg>
            }
          </span>
          @if (variant() === 'expanded') {
            <span class="switcher__label">{{ option.label }}</span>
          }
        </button>
      }
    </div>
  `,
  styles: `
    .switcher {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
    }

    .switcher--expanded {
      gap: 0.5rem;
    }

    .switcher__option {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      min-width: 32px;
      min-height: 32px;
      padding: 0.25rem;
      border: 1px solid transparent;
      border-radius: 0.5rem;
      background: transparent;
      color: var(--text-secondary);
      font-size: 0.875rem;
      font-family: inherit;
      cursor: pointer;

      &:hover {
        background: var(--surface-inset);
        color: var(--text-primary);
      }

      &:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
      }
    }

    // estado ativo marcado por borda + check no swatch (não só por cor, §5)
    .switcher__option--active {
      border-color: var(--accent);
      color: var(--text-primary);
      font-weight: 600;
    }

    .switcher--expanded .switcher__option {
      min-height: 44px;
      padding: 0.375rem 0.875rem 0.375rem 0.5rem;
      border-color: var(--glass-border);

      &.switcher__option--active {
        border-color: var(--accent);
      }
    }

    .switcher__swatch {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      border: 1px solid var(--glass-border);
      flex-shrink: 0;
    }

    // pré-visualização: tokens --theme-gradient-* (styles.scss), os mesmos
    // que cada tema usa como --bg-gradient — definidos uma única vez lá
    .switcher__swatch--azul {
      background: var(--theme-gradient-azul);
    }

    .switcher__swatch--verde {
      background: var(--theme-gradient-verde);
    }

    .switcher__swatch--claro {
      background: var(--theme-gradient-claro);
    }

    .switcher__swatch--escuro {
      background: var(--theme-gradient-escuro);
    }

    // "Sistema": metade claro / metade escuro
    .switcher__swatch--system {
      background: linear-gradient(90deg, #f4f7fb 0 50%, #0b0f16 50% 100%);
    }

    .switcher__check {
      width: 14px;
      height: 14px;
      fill: none;
      stroke: #fff;
      stroke-width: 3;
      stroke-linecap: round;
      stroke-linejoin: round;
      // legível sobre swatches claros e escuros
      filter: drop-shadow(0 0 2px rgb(0 0 0 / 85%));
    }
  `,
})
export class ThemeSwitcher {
  protected readonly theme = inject(ThemeService);
  protected readonly options = OPTIONS;

  readonly variant = input<'compact' | 'expanded'>('compact');
}
