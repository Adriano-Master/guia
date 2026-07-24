import { DecimalPipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';

import type { HorasDisciplina } from './estatisticas.models';

/**
 * Barras horizontais de horas por disciplina (US-02). Medida única de
 * magnitude → cor ÚNICA (--chart-1) em todas as barras; a identidade da
 * disciplina fica no rótulo em texto ao lado de cada barra (nunca só na cor).
 */
@Component({
  selector: 'app-grafico-barras-horas',
  imports: [DecimalPipe],
  template: `
    @if (data().length === 0) {
      <p class="gbar__state">Nenhuma sessão de estudo finalizada ainda.</p>
    } @else {
      <ul class="gbar">
        @for (item of view(); track item.disciplinaId) {
          <li class="gbar__row">
            <span class="gbar__nome">{{ item.disciplina }}</span>
            <svg class="gbar__svg" aria-hidden="true">
              <rect
                class="gbar__barra"
                x="0"
                y="0"
                rx="3"
                ry="3"
                height="100%"
                [attr.width]="item.largura + '%'"
              />
            </svg>
            <span class="gbar__valor">{{ item.horas | number: '1.0-1' }} h</span>
          </li>
        }
      </ul>
    }
  `,
  styles: `
    .gbar {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 0.625rem;
    }
    .gbar__row {
      display: grid;
      grid-template-columns: minmax(5.5rem, 11rem) 1fr auto;
      align-items: center;
      gap: 0.75rem;
    }
    .gbar__nome {
      min-width: 0;
      overflow-wrap: anywhere;
      font-size: 0.875rem;
      color: var(--text-primary);
    }
    .gbar__svg {
      display: block;
      width: 100%;
      height: 0.875rem;
    }
    /* Medida única → série monocromática; base alinhada no zero (x=0). */
    .gbar__barra {
      fill: var(--chart-1);
    }
    .gbar__valor {
      font-size: 0.875rem;
      font-variant-numeric: tabular-nums;
      color: var(--text-primary);
      white-space: nowrap;
    }
    .gbar__state {
      margin: 0;
      padding: 1.5rem 0;
      text-align: center;
      color: var(--text-secondary);
    }
  `,
})
export class GraficoBarrasHoras {
  readonly data = input.required<HorasDisciplina[]>();

  /** Larguras relativas ao maior valor (barra cheia = disciplina com mais horas). */
  readonly view = computed(() => {
    const data = this.data();
    const max = Math.max(...data.map((item) => item.horas), 0);
    return data.map((item) => ({
      ...item,
      largura: max > 0 ? round2((item.horas / max) * 100) : 0,
    }));
  });
}

function round2(valor: number): number {
  return Math.round(valor * 100) / 100;
}
