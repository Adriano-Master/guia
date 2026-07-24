import { DecimalPipe } from '@angular/common';
import { Component, input } from '@angular/core';

import type { MinhaPontuacao } from './gamificacao.models';

/**
 * Card "Minha pontuação" (US-03): total, posição global e a composição da
 * fórmula (subtemas, horas e bônus de consistência) — sempre em texto.
 */
@Component({
  selector: 'app-minha-pontuacao-card',
  imports: [DecimalPipe],
  template: `
    <div class="card mpont">
      <div class="mpont__resumo">
        <h2>Minha pontuação</h2>
        <p class="mpont__hero">{{ me().pontos | number: '1.0-0' }} pts</p>
        <p class="mpont__sub">
          Posição global:
          @if (me().posicaoGlobal !== null) {
            {{ me().posicaoGlobal }}º
          } @else {
            —
          }
        </p>
      </div>

      <dl class="mpont__composicao">
        <div class="mpont__parcela">
          <dt>Subtemas concluídos</dt>
          <dd>
            <span class="mpont__detalhe">{{ me().subtemasConcluidos }} subtemas</span>
            <span class="mpont__pts"
              >{{ me().composicao.pontosSubtemas | number: '1.0-0' }} pts</span
            >
          </dd>
        </div>
        <div class="mpont__parcela">
          <dt>Horas de estudo</dt>
          <dd>
            <span class="mpont__detalhe">{{ me().horasEstudadas | number: '1.0-1' }} h</span>
            <span class="mpont__pts">{{ me().composicao.pontosHoras | number: '1.0-0' }} pts</span>
          </dd>
        </div>
        <div class="mpont__parcela">
          <dt>Bônus de consistência</dt>
          <dd>
            <span class="mpont__detalhe">
              {{ me().semanasConsistentes }}
              {{ me().semanasConsistentes === 1 ? 'semana consistente' : 'semanas consistentes' }}
            </span>
            <span class="mpont__pts">{{ me().composicao.pontosBonus | number: '1.0-0' }} pts</span>
          </dd>
        </div>
      </dl>
    </div>
  `,
  styles: `
    .mpont {
      display: grid;
      gap: 1rem;

      @media (min-width: 640px) {
        grid-template-columns: auto 1fr;
        gap: 2rem;
      }
    }
    .mpont__resumo {
      display: grid;
      gap: 0.375rem;
      align-content: start;

      h2 {
        margin: 0;
        font-size: 0.9375rem;
        font-weight: 600;
        color: var(--text-secondary);
      }
    }
    .mpont__hero {
      margin: 0;
      font-size: 2rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      color: var(--text-primary);
    }
    .mpont__sub {
      margin: 0;
      font-size: 0.875rem;
      color: var(--text-secondary);
    }
    .mpont__composicao {
      margin: 0;
      display: grid;
      gap: 0.5rem;
      align-content: start;
    }
    .mpont__parcela {
      display: grid;
      gap: 0.125rem;

      dt {
        font-size: 0.8125rem;
        font-weight: 500;
        color: var(--text-secondary);
      }

      dd {
        margin: 0;
        display: flex;
        justify-content: space-between;
        gap: 1rem;
        align-items: baseline;
      }
    }
    .mpont__detalhe {
      font-size: 0.9375rem;
      color: var(--text-primary);
    }
    .mpont__pts {
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      color: var(--text-primary);
    }
  `,
})
export class MinhaPontuacaoCard {
  readonly me = input.required<MinhaPontuacao>();
}
