import { DecimalPipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';

const RAIO = 52;
const CIRCUNFERENCIA = 2 * Math.PI * RAIO;

/**
 * Anel de progresso em SVG: arco em --accent sobre trilha recessiva, com o
 * percentual central sempre em texto (a cor nunca é o único canal).
 */
@Component({
  selector: 'app-anel-progresso',
  imports: [DecimalPipe],
  template: `
    <div class="anel" role="img" [attr.aria-label]="label()">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle class="anel__trilha" cx="60" cy="60" r="52" />
        <circle
          class="anel__arco"
          cx="60"
          cy="60"
          r="52"
          transform="rotate(-90 60 60)"
          [attr.stroke-dasharray]="dasharray()"
        />
      </svg>
      <span class="anel__valor">{{ valor() | number: '1.0-1' }}%</span>
    </div>
  `,
  styles: `
    .anel {
      display: grid;
      place-items: center;
      width: 7.5rem;

      svg,
      .anel__valor {
        grid-area: 1 / 1;
      }

      svg {
        width: 100%;
        height: auto;
      }
    }
    .anel__trilha {
      fill: none;
      stroke: var(--glass-border);
      stroke-width: 10;
    }
    .anel__arco {
      fill: none;
      stroke: var(--accent);
      stroke-width: 10;
      stroke-linecap: round;
    }
    .anel__valor {
      font-size: 1.375rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      color: var(--text-primary);
    }
  `,
})
export class AnelProgresso {
  /** Percentual 0–100 (valores fora da faixa são grampeados no desenho). */
  readonly percentual = input.required<number>();
  /** Nome acessível, ex.: "Progresso do plano: 3 de 12 subtemas concluídos". */
  readonly label = input.required<string>();

  readonly valor = computed(() => clamp(this.percentual()));

  readonly dasharray = computed(() => {
    const arco = (clamp(this.percentual()) / 100) * CIRCUNFERENCIA;
    return `${arco.toFixed(2)} ${CIRCUNFERENCIA.toFixed(2)}`;
  });
}

function clamp(valor: number): number {
  return Math.max(0, Math.min(100, valor));
}
