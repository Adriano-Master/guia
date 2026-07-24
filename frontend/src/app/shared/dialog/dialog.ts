import { Component, ElementRef, afterNextRender, input, output, viewChild } from '@angular/core';

/**
 * Diálogo modal reutilizável sobre <dialog> nativo: showModal() dá foco preso,
 * Escape (evento cancel → close), fundo inert e ::backdrop nativos; ao fechar,
 * o foco volta ao elemento que abriu. O pai controla a exibição com @if e
 * remove o componente da árvore ao receber o output `fechado` (disparado por
 * Escape, clique no overlay ou no botão Fechar).
 *
 * Superfície .glass (token global): o blur fica no nível do modal, nunca nos
 * itens internos (orçamento do §6 do glassmorphism-ui).
 */
@Component({
  selector: 'app-dialog',
  template: `
    <dialog
      #dlg
      class="dialog glass"
      aria-modal="true"
      [attr.aria-label]="titulo()"
      (click)="onClick($event)"
      (close)="fechado.emit()"
    >
      <div class="dialog__inner">
        <header class="dialog__header">
          <h2 class="dialog__title">{{ titulo() }}</h2>
          <button class="dialog__close" type="button" aria-label="Fechar" (click)="fechar()">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>
        <ng-content />
      </div>
    </dialog>
  `,
  styles: `
    .dialog {
      width: min(92vw, 32rem);
      max-height: min(85dvh, 100%);
      padding: 0;
      border: 1px solid var(--glass-border);
      color: var(--text-primary);
      overflow: auto;

      &::backdrop {
        background: rgb(15 23 42 / 55%);
      }
    }

    .dialog__inner {
      display: grid;
      gap: 0.75rem;
      padding: 1rem 1.25rem 1.25rem;
    }

    .dialog__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
    }

    .dialog__title {
      margin: 0;
      font-size: 1.25rem;
    }

    .dialog__close {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 44px;
      min-height: 44px;
      padding: 0;
      border: none;
      border-radius: 0.5rem;
      background: transparent;
      color: var(--text-secondary);
      cursor: pointer;

      &:hover {
        background: var(--surface-inset);
        color: var(--text-primary);
      }

      svg {
        width: 20px;
        height: 20px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
      }
    }
  `,
})
export class Dialog {
  readonly titulo = input.required<string>();
  readonly fechado = output<void>();

  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  constructor() {
    afterNextRender(() => this.dlg().nativeElement.showModal());
  }

  fechar(): void {
    this.dlg().nativeElement.close();
  }

  /** Clique no ::backdrop tem o próprio <dialog> como alvo (padding 0). */
  onClick(event: MouseEvent): void {
    if (event.target === this.dlg().nativeElement) this.fechar();
  }
}
