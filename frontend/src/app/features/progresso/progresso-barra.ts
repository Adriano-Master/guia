import { Component, input } from '@angular/core';

/** Barra de progresso acessível reutilizada nos níveis plano/disciplina/tema. */
@Component({
  selector: 'app-progresso-barra',
  template: `
    <div
      class="pbar"
      role="progressbar"
      aria-valuemin="0"
      aria-valuemax="100"
      [attr.aria-valuenow]="valor()"
      [attr.aria-label]="label()"
    >
      <div class="pbar__fill" [style.width.%]="valor()"></div>
    </div>
  `,
  styles: `
    .pbar {
      height: 0.5rem;
      border-radius: 999px;
      background: var(--color-border);
      overflow: hidden;
    }
    .pbar__fill {
      height: 100%;
      border-radius: inherit;
      background: var(--color-primary);
      transition: width 0.2s ease;

      @media (prefers-reduced-motion: reduce) {
        transition: none;
      }
    }
  `,
})
export class ProgressoBarra {
  /** Percentual 0–100. */
  readonly valor = input.required<number>();
  /** Nome acessível, ex.: "Progresso da disciplina Português: 3 de 4 subtemas". */
  readonly label = input.required<string>();
}
